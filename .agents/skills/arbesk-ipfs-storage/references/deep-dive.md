# Deep Dive — Arbesk IPFS & Storage

Architecture, client libraries, pinning semantics, write/read paths, cache, manifest chain model, and content addressing concepts.

## 1. Architecture Overview

Arbesk uses a **private, isolated Kubo IPFS node** running in Docker. All content is stored via content-addressed CIDs. The manifest version chain is a backward-linked IPFS DAG where each manifest points to its predecessor via `prev_asset_manifest_cid`.

```
┌─────────────────────────────────────────────────┐
│  Docker Compose                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Kubo    │  │ Hardhat  │  │  Backend     │  │
│  │  IPFS    │  │  EVM     │  │  (Express)   │  │
│  │          │  │          │  │              │  │
│  │  API:5001│  │ RPC:8545 │  │  Port:9090   │  │
│  │  GW:8080 │  │          │  │              │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│       ▲              ▲              │           │
│       │              │              ▼           │
│  ┌───────────────────────────────────────────┐  │
│  │  Frontend (Browser — same host)           │  │
│  │  - Writes via fetch → /api/v0/add         │  │
│  │  - Reads via fetch → /api/v0/cat          │  │
│  │  - Cache: in-memory + IndexedDB           │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Node Isolation

The Kubo node is configured for **zero external connectivity**:
- `Routing.Type = none` — no DHT participation
- `bootstrap rm --all` — no bootstrap peers
- `Swarm.DisableNatPortMap = true` — no NAT traversal
- `Swarm.RelayClient.Enabled = false` — no relay client
- `Provide.Enabled = false` — no content providing to the DHT
- `Discovery.MDNS.Enabled = false` — no LAN peer discovery
- Swarm bound to `127.0.0.1:4001` — loopback only
- API bound to `0.0.0.0:5001` (container-internal, mapped to host `127.0.0.1`)
- Gateway bound to `0.0.0.0:8080` (container-internal, mapped to host `127.0.0.1`)

**The node does not connect to or announce content to any public IPFS network.** All content is private to this node.

---

## 2. IPFS Client Libraries

### Backend: `ipfs-http-client` v60 (kubo-rpc-client)

```js
// src/api/index.js L25
import { create } from "ipfs-http-client";
const ipfs = create(new URL(IPFS_API_URL));  // http://127.0.0.1:5001
```

This library wraps the Kubo HTTP RPC API. Every method call translates to an HTTP request to the Docker IPFS container.

Key available methods:
| Method | HTTP API | Purpose |
|--------|----------|---------|
| `ipfs.add(data)` | `POST /api/v0/add` | Add content, returns `{ cid, size }` |
| `ipfs.cat(cid, opts)` | `POST /api/v0/cat` | Stream read content by CID |
| `ipfs.pin.add(cid)` | `POST /api/v0/pin/add` | Pin content (protect from GC) |
| `ipfs.pin.rm(cid)` | `POST /api/v0/pin/rm` | Unpin content (allow GC) |

### Frontend: Direct `fetch` to Kubo HTTP API

```js
// frontend/src/js/ipfs/write-to-ipfs.js
fetch(`${IPFS_API_URL}/api/v0/add`, { method: "POST", body: formData })
fetch(`${IPFS_API_URL}/api/v0/pin/add?arg=${cid}`, { method: "POST" })
```

The frontend does NOT use `ipfs-http-client` — it makes raw `fetch` calls to the same Kubo API, because the browser and IPFS container run on the same host. This only works in the dev Docker setup.

---

## 3. Pinning Semantics (Critical)

### `ipfs.add()` pins by default

The Kubo HTTP API's `/api/v0/add` endpoint has a `pin` query parameter that **defaults to `true`**. This means every `ipfs.add()` call in the codebase automatically pins the content. The codebase does NOT pass `{ pin: false }` anywhere.

**As of this writing, the project also includes explicit `ipfs.pin.add()` calls after every `ipfs.add()` as defense-in-depth** (see section 4).

### `ipfs.pin.rm()` unpins

Content becomes **eligible for garbage collection** after unpinning. GC does not run immediately — it triggers when the node's storage usage exceeds the GC watermark (default: 90% of `StorageMax`).

### GC Watermark

```sh
# docker/entrypoint.sh L41
ipfs config Datastore.StorageMax 100GB
```

With default `Datastore.StorageGCWatermark` at 90%, GC triggers at ~90 GB of pinned + unpinned content. GC only removes unpinned blocks. Pinned content is always protected.

### Unpin-on-Burn Lifecycle

When a token is burned:
1. **Frontend** resolves the manifest CID via `tokenURI(tokenId).call()` **before** burning (after burn, `tokenURI` reverts)
2. **Frontend** calls `unpinAssetCids(manifestCid, { tokenId, chainId, contractAddress, proof })` → `POST /api/v1/ipfs/unpin` — strictly best-effort; any failure (including 403) only logs a warning and never blocks the burn. The backend verifies on-chain that the session wallet owns (or edits, via Merkle proof) the token and that the CID belongs to it, so this must happen **while the token is still live**
3. Contract burns the token on-chain (`burn(tokenId, proof)`)
4. **Backend** walks the full manifest chain, collects all owned CIDs, calls `ipfs.pin.rm()` on each
5. Content is now eligible for GC — it will be evicted when the GC watermark is next hit, or when `ipfs repo gc` is run manually

---

## 4. All IPFS Write Paths (with Pinning)

Every write path includes both `ipfs.add()` (which pins by default) and an explicit `ipfs.pin.add()` for defense-in-depth:

| File | What's written | Pin call |
|------|---------------|----------|
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side binary/JSON writes (manifests, thumbnails, glTF parts) | `POST /api/v0/pin/add?arg=...` |
| `src/api/storage/kubo-adapter.js` | Backend `pin.rm` during unpin | `ipfs.pin.rm(cid)` |

(All manifest, thumbnail, and asset writes are client-side; the backend only unpins and mints upload credentials.)

**Pinning is fire-and-forget safe**: every pin call is wrapped in `try/catch`. A failed pin logs a warning but never blocks the operation, because the underlying `ipfs.add()` already pins by default.

---

## 5. All IPFS Read Paths

### Backend

| Function | File | Purpose |
|----------|------|---------|
| `catManifest(cid, timeoutMs)` | `src/api/ipfs-utils.js` | Read manifest JSON from IPFS with 15s AbortController timeout (used by unpin + comments archive) |

### Frontend

| Module | File | Purpose |
|--------|------|---------|
| `remote-ipfs.js` | `frontend/src/js/ipfs/remote-ipfs.js` | Browser IPFS reads with on-demand in-memory + IndexedDB cache |

---

## 6. Frontend IPFS Cache

The frontend cache (`remote-ipfs.js`) uses a **two-tier runtime cache**:

| Tier | Storage | TTL | Scope |
|------|---------|-----|-------|
| In-memory | `Map<cid, {data, ts}>` | Session | Same tab lifetime |
| IndexedDB | Browser IndexedDB | Persistent | Cross-session, same browser |

**Design rule:** Do NOT add prefetching. The cache is on-demand only — content is cached when first read, not speculatively fetched.

---

## 7. Manifest Chain Storage Model

Every manifest is a standalone JSON document on IPFS. The chain is formed by `prev_asset_manifest_cid` links:

```
Manifest v3 (CID: bafyZZZ...)
  ├── prev_asset_manifest_cid: bafyYYY...
  ├── thumbnail: { cid: bafyTTT... }
  └── scene.nodes[0]:
       ├── source: { cid: bafyAAA... }          ← current source asset
       └── history:
            ├── { src: { cid: bafyBBB... } }     ← v2 source asset
            └── { src: { cid: bafyCCC... } }     ← v1 source asset

Manifest v2 (CID: bafyYYY...)
  ├── prev_asset_manifest_cid: bafyXXX...
  ├── thumbnail: { cid: bafyUUU... }
  └── scene.nodes[0]:
       ├── source: { cid: bafyBBB... }

Manifest v1 (CID: bafyXXX...)
  ├── prev_asset_manifest_cid: null
  └── scene.nodes[0]:
       ├── source: { cid: bafyCCC... }
```

**When unpinning a chain starting from v3:**
- Unpin `bafyZZZ`, `bafyYYY`, `bafyXXX` (manifests)
- Unpin `bafyTTT`, `bafyUUU` (thumbnails)
- Unpin `bafyAAA`, `bafyBBB`, `bafyCCC` (source assets from `source.cid` and `history[].src.cid`)
- Do NOT unpin `child_ref` token CIDs (they belong to other tokens)

### CID Deduplication

The unpin endpoint uses a `Set` to deduplicate CIDs. The same source asset CID may appear in both a history entry and a future version's current source — we only unpin it once.

## 14. Content Addressing vs. Deletion

IPFS is content-addressed — there is no "delete" operation:

- **Identical content = identical CID.** Adding the same file twice produces the same CID and does not duplicate storage.
- **Pinning/unpinning controls GC eligibility**, not immediate deletion.
- **Blocks may remain** in the blockstore after unpinning until GC runs.
- **GC is non-destructive to pinned content.** Only unpinned blocks are removed.
- **Merkle-DAG deduplication** means sub-trees shared between manifests (e.g., same mesh referenced by multiple history entries) are stored once.

This means "deleting" a token's content via unpinning is a **best-effort storage reclamation**, not a guaranteed wipe. Other tokens may still reference some of the same CIDs (e.g., if the same GLTF was generated for multiple tokens via the mock adapter).

---
name: arbesk-ipfs-storage
description: IPFS storage expertise for the Arbesk project. Covers the private Kubo Docker node, pin/unpin semantics, add/pin/rm API flows, manifest chain storage model, garbage collection, browser-side writes, read cache, and the unpin-on-burn lifecycle. Use when asked about IPFS pinning, unpinning, GC, storage limits, CID resolution, or any IPFS read/write operation across backend or frontend.
---

# Arbesk IPFS & Storage Expertise

Use this skill when working with any IPFS-related code in the Arbesk project — reads, writes, pinning, unpinning, garbage collection, Docker configuration, or storage lifecycle questions.

---

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
2. Contract burns the token on-chain (`_burn(tokenId)`)
3. **Frontend** fires `unpinAssetCids(manifestCid)` → `POST /api/v1/ipfs/unpin`
4. **Backend** walks the full manifest chain, collects all owned CIDs, calls `ipfs.pin.rm()` on each
5. Content is now eligible for GC — it will be evicted when the GC watermark is next hit, or when `ipfs repo gc` is run manually

---

## 4. All IPFS Write Paths (with Pinning)

Every write path includes both `ipfs.add()` (which pins by default) and an explicit `ipfs.pin.add()` for defense-in-depth:

| File | Line | What's written | Pin call |
|------|------|---------------|----------|
| `src/api/index.js` | L94 | Thumbnail WebP buffer | `ipfs.pin.add(thumbnailCid)` L99 |
| `src/api/index.js` | L197 | Saved manifest JSON | `ipfs.pin.add(resultCid)` L200 |
| `src/api/index.js` | L249 | Published manifest JSON | `ipfs.pin.add(resultCid)` L252 |
| `src/api/assets/generate-node.js` | L188 | Source GLTF/GLB binary | `ipfs.pin.add(sourceAssetCid)` L195 |
| `src/api/assets/generate-node.js` | L270 | Generation manifest JSON | `ipfs.pin.add(assetManifestCid)` L284 |
| `frontend/src/js/ipfs/write-to-ipfs.js` | L43 | Browser-side binary/JSON | `POST /api/v0/pin/add?arg=...` L60 |

**Pinning is fire-and-forget safe**: every pin call is wrapped in `try/catch`. A failed pin logs a warning but never blocks the operation, because the underlying `ipfs.add()` already pins by default.

---

## 5. All IPFS Read Paths

### Backend

| Function | File | Purpose |
|----------|------|---------|
| `catManifest(ipfs, cid, timeoutMs)` | `src/api/ipfs-utils.js` | Read manifest JSON from IPFS with 15s AbortController timeout |
| `GET /api/v1/manifests/:cid/history` | `src/api/index.js` L256 | Walk `prev_asset_manifest_cid` chain up to 50 entries |
| `GET /api/v1/tokens/:tokenId/manifest` | `src/api/index.js` L318 | Resolve token → manifest CID → IPFS read |

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
Manifest v3 (CID: QmZZZ...)
  ├── prev_asset_manifest_cid: QmYYY...
  ├── thumbnail: { cid: QmTTT... }
  └── scene.nodes[0]:
       ├── source: { cid: QmAAA... }          ← current source asset
       └── history:
            ├── { src: { cid: QmBBB... } }     ← v2 source asset
            └── { src: { cid: QmCCC... } }     ← v1 source asset

Manifest v2 (CID: QmYYY...)
  ├── prev_asset_manifest_cid: QmXXX...
  ├── thumbnail: { cid: QmUUU... }
  └── scene.nodes[0]:
       ├── source: { cid: QmBBB... }

Manifest v1 (CID: QmXXX...)
  ├── prev_asset_manifest_cid: null
  └── scene.nodes[0]:
       ├── source: { cid: QmCCC... }
```

**When unpinning a chain starting from v3:**
- Unpin `QmZZZ`, `QmYYY`, `QmXXX` (manifests)
- Unpin `QmTTT`, `QmUUU` (thumbnails)
- Unpin `QmAAA`, `QmBBB`, `QmCCC` (source assets from `source.cid` and `history[].src.cid`)
- Do NOT unpin `child_ref` token CIDs (they belong to other tokens)

### CID Deduplication

The unpin endpoint uses a `Set` to deduplicate CIDs. The same source asset CID may appear in both a history entry and a future version's current source — we only unpin it once.

---

## 8. The Unpin Endpoint (`POST /api/v1/ipfs/unpin`)

### Request
```json
{
  "cid": "QmManifestCidToStartFrom...",
  "actorAddress": "0x..."  // optional, for ledger audit
}
```

### Response (200)
```json
{
  "unpinned": ["Qm...", "Qm...", ...],
  "count": 42,
  "errors": ["unpin QmBad: some error"]  // optional, only if errors occurred
}
```

### Behavior
- Walks `prev_asset_manifest_cid` up to 100 entries deep
- Handles circular links (stops and logs)
- "not pinned" errors are treated as success (content already eligible for GC)
- All unpin attempts continue even if individual ones fail
- Records to micro-ledger as `opType: "UNPIN"`

---

## 9. Docker IPFS Configuration

| File | Purpose |
|------|---------|
| `docker/Dockerfile` | Base image `ipfs/kubo:latest`, copies entrypoint |
| `docker/entrypoint.sh` | Initializes repo, applies isolation config, starts daemon |
| `docker-compose.yml` | `ipfs` service definition, port mappings, volume mounts |

### Key Config Values (set in entrypoint.sh)

```sh
ipfs config Routing.Type none
ipfs config --json Swarm.DisableNatPortMap true
ipfs config --json Swarm.EnableHolePunching false
ipfs config --json Swarm.RelayClient.Enabled false
ipfs config --json Swarm.RelayService '{"Enabled": false}'
ipfs config --json Provide.Enabled false
ipfs config --json Discovery.MDNS.Enabled false
ipfs config Addresses.Swarm --json '["/ip4/127.0.0.1/tcp/4001"]'
ipfs config Datastore.StorageMax 100GB
```

### Storage Volume

IPFS data is mounted at `./ipfs-data:/data/ipfs` in `docker-compose.yml`. This persists blocks, pins, and repo state across container restarts.

---

## 10. Key Files Reference

| File | Role |
|------|------|
| `src/api/index.js` | Backend routes: save, publish, unpin, manifest chain, token resolver |
| `src/api/ipfs-utils.js` | `catManifest()` — IPFS read with timeout and chunk decoding |
| `src/api/manifest-utils.js` | `getSceneNodes()`, `bumpManifestVersion()` |
| `src/api/assets/generate-node.js` | Generation pipeline: add source asset, build manifest, pin both |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS writer (`writeToIPFS`, `writeJSONToIPFS`) |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS reader with runtime cache |
| `frontend/src/js/gltf/composer.js` | Reads GLTF from IPFS, reconstructs for Babylon.js |
| `frontend/src/js/gltf/decomposer.js` | Decomposes GLTF, stores composite on IPFS |
| `frontend/src/js/services/api.js` | Frontend API client: `saveManifest`, `publishManifest`, `unpinAssetCids` |
| `frontend/src/js/blockchain/wallet.js` | `burn()` — resolves manifest CID, burns token, fires unpin |
| `docker/Dockerfile` | Kubo IPFS container image definition |
| `docker/entrypoint.sh` | IPFS node initialization and isolation configuration |
| `docker-compose.yml` | Orchestration: IPFS + Hardhat containers |

---

## 11. Rules for IPFS Code Changes

1. **Every `ipfs.add()` must be followed by explicit `ipfs.pin.add()`** — defense-in-depth; add pins by default, but explicit pinning documents intent
2. **Pin calls are wrapped in try/catch** — a pin failure is non-fatal; log a warning and continue
3. **Use `catManifest()` for all backend manifest reads** — provides consistent timeout handling and chunk decoding
4. **Never unpin content belonging to other tokens** — `child_ref` CIDs are excluded from unpin-on-burn
5. **Do NOT add prefetching to the frontend cache** — the runtime cache is on-demand by design
6. **Do NOT expose IPFS ports beyond `127.0.0.1`** — the node must remain private
7. **Log IPFS operations with `[IPFS]` tag** — consistent with the project logging conventions documented in `AGENTS.md`
8. **Storage cap is 100 GB** — ensure new features don't risk exceeding this without adjusting `Datastore.StorageMax`
9. **Unpin before running GC** — never run `ipfs repo gc` without first unpinning content you want to evict
10. **Test IPFS changes with the backend running** — `npm start` + `docker-compose up -d ipfs`

---

## 12. Common Operations

### Manually unpin a CID
```bash
# From the host (Kubo HTTP API)
curl -X POST "http://127.0.0.1:5001/api/v0/pin/rm?arg=QmSomeCid..."

# Inside the container
docker-compose exec ipfs ipfs pin rm QmSomeCid...
```

### List all pinned CIDs
```bash
docker-compose exec ipfs ipfs pin ls
```

### Trigger garbage collection manually
```bash
docker-compose exec ipfs ipfs repo gc
```

### Check repo size
```bash
docker-compose exec ipfs ipfs repo stat
```

### Add a file and pin it explicitly
```bash
# Via CLI (auto-pins)
docker-compose exec ipfs ipfs add somefile.gltf

# Via HTTP API
curl -X POST -F "file=@somefile.gltf" "http://127.0.0.1:5001/api/v0/add"
curl -X POST "http://127.0.0.1:5001/api/v0/pin/add?arg=QmReturnedCid..."
```

---

## 13. Troubleshooting

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| `[IPFS] cat <cid> → fetch aborted` | Timeout (15s) — large file or node unresponsive | Check Docker resource limits; increase timeout in `catManifest()` |
| `ipfs.add()` returns but content not found | Node not initialized or corrupted repo | Check `docker-compose logs ipfs` for init errors |
| GC removes content unexpectedly | Content was not pinned, or `StorageMax` too low | Verify `StorageMax` (100 GB); check pin list |
| Frontend IPFS writes fail with CORS | CORS headers not configured | Entrypoint sets `Access-Control-Allow-Origin: *` for API and Gateway |
| Backend `Connection refused` on 5001 | IPFS container not running | `docker-compose up -d ipfs` |
| `ipfs.pin.rm` fails with "not pinned or pinned indirectly" | CID was never explicitly pinned (recursive vs direct pin) | Use `ipfs.pin.rm` with `--recursive` flag if it's a recursive pin |

---

## 14. Content Addressing vs. Deletion

IPFS is content-addressed — there is no "delete" operation:

- **Identical content = identical CID.** Adding the same file twice produces the same CID and does not duplicate storage.
- **Pinning/unpinning controls GC eligibility**, not immediate deletion.
- **Blocks may remain** in the blockstore after unpinning until GC runs.
- **GC is non-destructive to pinned content.** Only unpinned blocks are removed.
- **Merkle-DAG deduplication** means sub-trees shared between manifests (e.g., same mesh referenced by multiple history entries) are stored once.

This means "deleting" a token's content via unpinning is a **best-effort storage reclamation**, not a guaranteed wipe. Other tokens may still reference some of the same CIDs (e.g., if the same GLTF was generated for multiple tokens via the mock adapter).

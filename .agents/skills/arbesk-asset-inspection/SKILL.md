---
name: arbesk-asset-inspection
description: Fetch and inspect Arbesk assets (by token ID, manifest CID, or IPFS CID), walk the manifest version chain, count child nodes, and understand the fractal manifest structure. Use when asked to "get asset X", "inspect token Y", "how many children", "show manifest", or "walk the version chain" for any Arbesk asset.
---

# Arbesk Asset Inspection

Use this skill when you need to:
- Inspect an asset by its **token ID** (numeric, e.g., `172409538`)
- Fetch a manifest by its **IPFS CID** (e.g., `Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg`)
- Walk the **manifest version chain** (backward-linked IPFS history)
- Count or list **child worlds** embedded in a manifest
- Understand the **fractal manifest structure**

## Backend API: Fetching Assets

The backend runs on `http://127.0.0.1:9090`. All asset endpoints are under `/api/v1/`.

### Resolve a token ID to its manifest

```
GET /api/v1/tokens/:tokenId/manifest
```

This calls `tokenURI(tokenId)` on the `ArbeskAsset` contract, fetches the manifest from IPFS, and returns:
- `tokenId` — the token ID
- `manifestCid` — the current IPFS CID
- `manifest` — the full parsed manifest JSON

```bash
curl -s http://127.0.0.1:9090/api/v1/tokens/172409538/manifest
```

**Response example:**

```json
{
  "tokenId": "172409538",
  "manifestCid": "Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg",
  "manifest": {
    "asset_id": "asset_1780583355628",
    "version": 3,
    "timestamp": 1780583355628,
    "prev_asset_manifest_cid": "QmPczH3uYPZqvwRjNDRdF2wyRBCYAuJoqHzvVHDPqGkFPq",
    "scene": { "nodes": [...] },
    "name": "Untitled Asset",
    "thumbnail": { ... }
  }
}
```

**Error conditions:**
- `503 CONTRACT_NOT_CONFIGURED` — `CONTRACT_ADDRESS` not set in root `.env`
- `503 ABI_NOT_FOUND` — contracts not compiled; run `docker-compose run --rm hardhat npx hardhat compile`
- `404 TOKEN_NOT_FOUND` — token exists but has no `tokenURI`
- `500 TOKEN_RESOLUTION_FAILED` — IPFS read or contract call failed

### Walk the manifest version chain

```
GET /api/v1/manifests/:cid/history
```

Walks `prev_asset_manifest_cid` links backward up to 50 entries deep. Returns all versions, oldest first:

```bash
curl -s http://127.0.0.1:9090/api/v1/manifests/Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg/history
```

Returns:

```json
{
  "chain": [
    { "cid": "QmAbc...", "version": 1, "name": "...", "nodeCount": 1, "timestamp": 1780000000 },
    { "cid": "QmDef...", "version": 2, "name": "...", "nodeCount": 1, "timestamp": 1780100000 },
    { "cid": "QmGhi...", "version": 3, "name": "...", "nodeCount": 1, "timestamp": 1780583355628 }
  ]
}
```

### Direct IPFS fetch (via the API test helper)

In a Node.js context (tests or scripts), the API exposes `_getFromIPFS(cid)`:

```js
const raw = await api._getFromIPFS("Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg");
const manifest = JSON.parse(raw);
```

### Manual IPFS `dag get` via CLI

```bash
# If ipfs CLI is available in the container
docker-compose exec ipfs ipfs cat Qmcuae4gCFFJ9Nkyyz7AyxATW1jSK63EvbtgzzXBWxt4gg
```

## Manifest Structure

Every Arbesk manifest is a JSON document stored on the private IPFS node. Key fields:

```json
{
  "asset_id": "asset_<timestamp>",           // Unique asset identifier
  "version": <int>,                          // Monotonically increasing
  "timestamp": <unix ms>,                    // Creation time
  "prev_asset_manifest_cid": "<cid>",        // Backward chain link (null for v1)
  "name": "Untitled Asset",                  // Human-readable name
  "thumbnail": {                             // Optional WebP snapshot
    "type": "snapshot",
    "cid": "Qm...",
    "path": "thumbnail.webp",
    "format": "webp",
    "mime": "image/webp",
    "width": 512,
    "height": 288,
    "bytes": 5248,
    "timestamp": 1780000000
  },
  "scene": {
    "nodes": [ ... ]                         // Array of scene nodes
  }
}
```

## Node Types

Each entry in `scene.nodes` is one of two types:

### 1. Source Asset Node (local GLTF/GLB)

```json
{
  "node_id": "untitled_asset_1780583349541",
  "type": "source_asset",
  "name": "person",
  "source": {
    "cid": "QmavQYrXKWERMEuz9q4viP8UU5rxCFJbpKKeAxvtQg8rT5",
    "path": "asset.gltf",
    "format": "gltf"
  },
  "transform_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "appearance": {
    "color": null,
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "history": [ ... ]                         // Optional version history
}
```

### 2. Token Child Node (dynamic child world reference)

```json
{
  "node_id": "child_token_31415822_0x9fE4_172409538",
  "name": "Untitled Asset",
  "transform_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "child_ref": {
    "type": "token",
    "chainId": 31415822,
    "contractAddress": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "tokenId": "172409538",
    "standard": "ERC721",
    "resolution": "latest"
  }
}
```

**Key rule:** Token child nodes do NOT have `history` or `source` fields. The version history belongs to the referenced token. The parent manifest only owns the `transform_matrix` (placement).

## Counting Children

To determine how many child worlds an asset contains, inspect `manifest.scene.nodes` and count nodes that have a `child_ref` (or legacy `child_manifest_id`) field:

```bash
# Quick count using curl + jq
curl -s http://127.0.0.1:9090/api/v1/tokens/1409751252/manifest \
  | jq '[.manifest.scene.nodes[] | select(.child_ref != null or .child_manifest_id != null)] | length'
```

A node is a **child** if it has `.child_ref` or `.child_manifest_id`. Nodes with only `.source` are self-contained GLTF assets, not children.

## Token Resolution (Frontend)

On the frontend, `child_ref` tokens are resolved at load time by `frontend/src/js/blockchain/token-resolver.js`:

1. **Cache check** — 30-second TTL in-memory cache by `chainId:contractAddress:tokenId`
2. **Contract call** — `tokenURI(tokenId)` on the ERC-721 contract
3. **URI normalization** — `normalizeTokenURI()` extracts the plain IPFS CID from various URI formats (`ipfs://`, `https://`, bare CID)
4. **IPFS fetch** — retrieves the manifest from the private IPFS node

Known RPC endpoints (in `KNOWN_RPC_ENDPOINTS`):
| Chain ID | Name | RPC |
|----------|------|-----|
| 31415822 | Hardhat local | `http://127.0.0.1:8545` |
| 314159 | Filecoin Calibration | `https://api.calibration.node.glif.io/rpc/v1` |
| 314 | Filecoin Mainnet | `https://api.node.glif.io/rpc/v1` |

## Key Files

| File | Purpose |
|------|---------|
| `src/api/index.js` | `GET /api/v1/tokens/:tokenId/manifest`, `GET /api/v1/manifests/:cid/history` |
| `src/api/ipfs-utils.js` | `catManifest(ipfs, cid)` — IPFS read with timeout |
| `src/api/manifest-utils.js` | `getSceneNodes(manifest)`, `bumpManifestVersion()` |
| `frontend/src/js/blockchain/token-resolver.js` | `resolveChildRef()` — frontend token → CID resolution |
| `frontend/src/js/blockchain/uri-utils.js` | `normalizeTokenURI()` — CID extraction from token URIs |
| `blockchain/contracts/ArbeskAsset.sol` | `tokenURI(uint256)` — on-chain manifest CID lookup |

## Common Inspection Patterns

### Pattern 1: "Get asset X" where X is a number
→ Try `GET /api/v1/tokens/X/manifest` first. If the backend isn't running, start it with `npm start`.

### Pattern 2: "How many children in asset X?"
→ Fetch the manifest, count nodes with `child_ref` or `child_manifest_id`. See "Counting Children" above.

### Pattern 3: "Show the version history of asset X"
→ First get the manifest CID (via token resolution or direct), then call `GET /api/v1/manifests/:cid/history`.

### Pattern 4: "What's in the manifest at CID X?"
→ `curl -s http://127.0.0.1:9090/api/v1/tokens/TOKEN_ID/manifest` (if a token), or fetch directly from IPFS via `ipfs cat`.

## Dependency: Backend Must Be Running

**The backend server must be running** for the `/api/v1/tokens/` and `/api/v1/manifests/` endpoints to respond. If `curl` returns `Connection refused`, run:

```bash
npm start
# or with auto-reload:
npm run nodemon
```

Also requires:
- **IPFS container**: `docker-compose up -d ipfs`
- **Hardhat container**: `docker-compose up -d hardhat` (for on-chain `tokenURI` calls)
- **Compiled contracts**: `docker-compose run --rm hardhat npx hardhat compile`
- **CONTRACT_ADDRESS** set in root `.env`

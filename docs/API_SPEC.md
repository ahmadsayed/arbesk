# Arbesk API Specification

> **Version**: 0.3.0 — Aligned with Express backend, Filecoin FEVM, Private IPFS, Mock Adapters, Parametric Versions  
> **Base URL**: `/api`  
> **Content-Type**: `application/json`

---

## Authentication

Most routes are unauthenticated (public read). Generation routes require:
1. A valid on-chain transaction hash (`txHash`) included in the request body
2. The API route verifies the tx on-chain using Glif RPC (Filecoin FEVM)

Parametric version routes do **not** require payment — they are free UI edits.

---

## Endpoints

### `POST /api/generate-asset-node`

Triggers a cloud 3D generation (or mock adapter in dev mode), uploads to private IPFS, and appends a **generation** history entry.

**Request Body:**
```json
{
  "prompt": "A modern minimalist workbench with steel legs, raw wood top",
  "nodeId": "node_table_xyz_01",
  "txHash": "0xabc123...",
  "provider": "meshy",
  "manifestId": "root_universe_world_001",
  "options": {
    "artStyle": "realistic",
    "resolution": 1024,
    "negativePrompt": "blurry, low quality"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "newManifestCid": "QmUpdatedManifest123...",
    "historyEntry": {
      "v": 3,
      "timestamp": 1780001000,
      "src": {
        "cid": "QmTableV3MeshHash...",
        "path": "asset.glb",
        "format": "glb"
      },
      "prompt": "A modern minimalist workbench with steel legs, raw wood top",
      "provider": "meshy",
      "txHash": "0xabc123...",
      "type": "generation"
    },
    "nodeId": "node_table_xyz_01"
  }
}
```

**Errors:**
- `400` — Invalid request body
- `402` — Transaction not found or insufficient payment
- `403` — Transaction not sent to ArbeskWorld contract or missing expected event
- `409` — txHash already used (replay prevention)
- `429` — Rate limit exceeded (10 requests per hour per wallet)
- `500` — Cloud generation failed or IPFS upload failed
- `504` — Cloud generation timeout (> 5 minutes)

---

### `POST /api/parametric-version`

Creates a new **parametric** history entry from UI-driven color/scale edits. No payment required. No SaaS API call.

**Request Body:**
```json
{
  "nodeId": "node_table_xyz_01",
  "manifestId": "root_universe_world_001",
  "color": "#FF5733",
  "scale": {
    "x": 1.5,
    "y": 1.5,
    "z": 1.5
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "newManifestCid": "QmUpdatedManifest456...",
    "historyEntry": {
      "v": 4,
      "timestamp": 1780002000,
      "src": {
        "cid": "QmTableV3MeshHash...",
        "path": "asset.glb",
        "format": "glb"
      },
      "prompt": "Scale 1.5x, Color #FF5733",
      "provider": "parametric",
      "type": "parametric",
      "params": {
        "scale": { "x": 1.5, "y": 1.5, "z": 1.5 },
        "color": "#FF5733"
      }
    },
    "nodeId": "node_table_xyz_01"
  }
}
```

**Errors:**
- `400` — Invalid request body (e.g., invalid hex color)
- `404` — Node or manifest not found
- `500` — IPFS read/write failed

---

### `GET /api/manifest/:id`

Fetches a manifest by its IPFS CID or local ID.

**Path Params:**
- `id` — Manifest CID or local identifier

**Query Params:**
- `depth` (number, optional) — Max recursion depth for nested manifests. Default: `0` (no nesting).
- `includeHistory` (boolean, optional) — Include full history arrays. Default: `true`.

**Response (200 OK):**
```json
{
  "manifest_id": "root_universe_world_001",
  "version": 4,
  "timestamp": 1780000000,
  "prev_manifest_cid": "QmPrevManifest...",
  "nodes": [
    {
      "node_id": "node_table_xyz_01",
      "source": {
        "cid": "QmParentTableFinalMeshHash...",
        "path": "asset.glb",
        "format": "glb"
      },
      "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 5, -2, 1],
      "history": [
        {
          "v": 1,
          "type": "generation",
          "timestamp": 1779900000,
          "src": {
            "cid": "QmTableRoughDraftMeshHash...",
            "path": "asset.gltf",
            "format": "gltf"
          },
          "prompt": "A modern minimalist workbench",
          "provider": "meshy",
          "txHash": "0xabc..."
        },
        {
          "v": 2,
          "type": "parametric",
          "timestamp": 1779950000,
          "src": {
            "cid": "QmTableRoughDraftMeshHash...",
            "path": "asset.gltf",
            "format": "gltf"
          },
          "prompt": "Scale 1.5x, Color #FF5733",
          "provider": "parametric",
          "params": {
            "scale": { "x": 1.5, "y": 1.5, "z": 1.5 },
            "color": "#FF5733"
          }
        }
      ],
      "child_manifest_id": "nested_dollhouse_universe_02"
    }
  ]
}
```

**Errors:**
- `404` — Manifest not found
- `500` — Private IPFS node unreachable

---

### `GET /api/manifest-by-token/:tokenId`

Fetches a manifest by its on-chain Token ID. The backend queries the `ArbeskWorld` contract for `tokenURI`, then retrieves the manifest from private IPFS.

**Path Params:**
- `tokenId` — The NFT token ID (e.g. `0x1234abcd`)

**Response (200 OK):**
```json
{
  "tokenId": "0x1234abcd",
  "manifestCid": "QmManifestHash...",
  "manifest": {
    "manifest_id": "root_universe_world_001",
    "version": 4,
    "nodes": [...]
  }
}
```

**Errors:**
- `400` — tokenId required
- `404` — Token not found or has no manifest URI
- `503` — Contract address not configured or ABI not compiled
- `500` — IPFS read failed

---

### `GET /api/health`

System health check. Returns status of subsystems.

**Response (200 OK):**
```json
{
  "status": "healthy",
  "timestamp": "2026-05-28T14:43:10.466Z",
  "services": {
    "ipfs": "ok",
    "blockchain": "ok",
    "tripo3d": "ok",
    "meshy": "degraded",
    "hunyuan3d": "ok",
    "mock": "active"
  }
}
```

---

### `POST /api/manifest`

Creates a new manifest (used for initializing worlds).

**Request Body:**
```json
{
  "manifest_id": "my_new_world_001",
  "nodes": [
    {
      "node_id": "root_node_01",
      "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      "history": []
    }
  ]
}
```

**Response (201 Created):**
```json
{
  "manifestCid": "QmNewManifest...",
  "manifestId": "my_new_world_001"
}
```

---

### `POST /api/manifest/clone`

Forks an existing manifest, creating a new root with copied node structure but fresh history.

**Request Body:**
```json
{
  "sourceManifestCid": "QmOriginal...",
  "newManifestId": "forked_world_002"
}
```

**Response (201 Created):**
```json
{
  "manifestCid": "QmForkedManifest...",
  "manifestId": "forked_world_002"
}
```

---

## Error Schema

All errors follow this JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "GENERATION_TIMEOUT",
    "message": "Cloud generation exceeded 5 minute timeout",
    "details": { "taskId": "task_abc123", "provider": "tripo3d" }
  }
}
```

**Error Codes:**
| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `PAYMENT_REQUIRED` | 402 | On-chain payment missing or invalid |
| `REPLAY_DETECTED` | 409 | txHash already consumed |
| `RATE_LIMITED` | 429 | Too many generation requests from this wallet |
| `MANIFEST_NOT_FOUND` | 404 | Manifest CID not found on IPFS |
| `NODE_NOT_FOUND` | 404 | Target node_id not found in manifest |
| `GENERATION_FAILED` | 500 | Cloud API returned error |
| `GENERATION_TIMEOUT` | 504 | Cloud API polling exceeded limit |
| `IPFS_UPLOAD_FAILED` | 500 | Private IPFS add failed |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## Rate Limits

| Route | Limit | Window |
|-------|-------|--------|
| `POST /api/generate-asset-node` | 10 | per wallet / hour |
| `POST /api/parametric-version` | 100 | per wallet / hour |
| `GET /api/manifest/*` | 100 | per IP / minute |
| `POST /api/manifest` | 5 | per IP / hour |

Rate limit headers:
- `X-RateLimit-Limit` — Maximum allowed requests in the window
- `X-RateLimit-Remaining` — Remaining requests in the current window
- `Retry-After` — Seconds until the rate limit resets (included in `429` responses)

---

### `GET /abi/ArbeskWorld.json`

Serves the compiled contract ABI JSON to the frontend. The ABI is read from `blockchain/artifacts/contracts/ArbeskWorld.sol/ArbeskWorld.json` after running `npx hardhat compile`.

**Response (200 OK):**
```json
{
  "abi": [ /* full contract ABI */ ],
  "bytecode": "0x...",
  "deployedBytecode": "0x...",
  ...
}
```

**Response (404 Not Found):**
```json
{
  "error": "ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile"
}
```

---

## NFT + Collaboration Flow

Phase 3 introduces on-chain NFT ownership and editor collaboration:

1. **Generation Payment** — User calls `payForGeneration(nodeId, prompt)` on `ArbeskWorld`, paying `costPerGeneration` in native FIL.
2. **Backend Pipeline** — After tx confirmation, backend validates receipt, runs generation, stores asset on IPFS, and returns a `newManifestCid`.
3. **NFT Minting** — Frontend optionally calls `mintWorld(tokenURI, tokenId)` to mint an ERC721 representing the world. The `tokenURI` is the manifest CID.
4. **Collaboration** — The NFT owner can call `addEditor(tokenId, editorAddress)` to grant update rights. Editors can call `updateTokenURI(tokenId, newManifestCID)` after parametric edits or new generations.
5. **Access Control** — `updateTokenURI` is restricted to the token owner or any listed editor.

*End of API Specification.*

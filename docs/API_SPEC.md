# Arbesk API Specification

> Version: 0.4.0 — aligned with the current Express implementation  
> Base URL: `/api`  
> Content-Type: `application/json` unless noted

---

## Implementation Notes

- The backend is mounted from `src/index.js` at `/api`.
- Private IPFS writes use the Kubo API from `IPFS_API_URL` (default `http://127.0.0.1:5001`).
- The browser reads IPFS content through the gateway (`http://127.0.0.1:8080/ipfs/` by default).
- Generation currently supports the mock adapter path. Cloud adapters are planned but return `501` until implemented.
- Error responses are currently simple JSON objects such as `{ "error": "message" }`; they do not yet use a global typed error envelope.

---

## Authentication

`POST /api/generate-asset-node` requires a Bearer token built from the transaction hash signature flow:

```text
Authorization: Bearer <base64(message)>.<base64(signature)>
```

The frontend service signs a message containing the transaction hash. The backend:

1. Recovers the wallet address from the signature.
2. Extracts the tx hash from the message.
3. Verifies the transaction receipt on the configured FEVM/Hardhat RPC.
4. The generation route then validates the receipt target contract and expected `AssetGenerationPaid` event when `CONTRACT_ADDRESS` is configured.

Parametric edits, manifest saves, manifest chain reads, ABI reads, and token manifest reads do not currently require this Bearer auth.

---

## Implemented Endpoints

### `GET /api/contract_address`

Returns the configured `CONTRACT_ADDRESS`.

**Response**

```json
{
  "contract_address": "0x..."
}
```

---

### `POST /api/generate-asset-node`

Validates a paid generation transaction, generates or mocks an asset, uploads it to private IPFS, and writes a new manifest snapshot.

**Current behavior**

- Requires Bearer auth.
- Applies rate limit: 10 requests/hour per recovered wallet.
- Requires `prompt` and `nodeId`.
- Uses `txHash` from the body or authenticated token.
- If `prevManifestCid` is provided, reads and updates the previous manifest.
- In replace mode, keeps only one root node and preserves that node's history chain.
- If `MOCK_3D_GENERATION=true`, uses `src/api/adapters/mock-adapter.js`.
- If mock mode is disabled, responds `501` because production cloud adapters are not implemented yet.

**Request Body**

```json
{
  "prompt": "A modern minimalist workbench",
  "nodeId": "node_table_001",
  "txHash": "0xabc123...",
  "provider": "mock",
  "manifestId": "manifest_001",
  "prevManifestCid": "QmPreviousManifest...",
  "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
```

**Response `200`**

```json
{
  "newManifestCid": "QmNewManifest...",
  "historyEntry": {
    "v": 1,
    "timestamp": 1780001000,
    "src": {
      "cid": "QmAssetCid...",
      "path": "asset.gltf",
      "format": "gltf"
    },
    "prompt": "A modern minimalist workbench",
    "provider": "mock",
    "txHash": "0xabc123...",
    "type": "generation"
  },
  "assetCID": "QmAssetCid..."
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | `prompt` or `nodeId` missing |
| 401 | Missing or malformed Bearer auth |
| 403 | Auth failed, tx missing/failed, wrong contract, or missing payment event |
| 409 | Replay detected (`txHash` already consumed or found in manifest history) |
| 429 | Generation rate limit exceeded |
| 501 | Cloud adapters not implemented and mock mode disabled |
| 500 | Unhandled generation/IPFS error |

---

### `POST /api/parametric-version`

Creates a new free parametric history entry for color/scale edits.

**Current behavior**

- Does not require payment.
- Requires `nodeId` and `prevManifestCid`.
- Reads the previous manifest from private IPFS.
- Finds the target node and copies `node.source` into the history entry.
- Validates optional hex color and positive numeric scale components.
- Writes the updated manifest to private IPFS with `prev_manifest_cid = prevManifestCid`.

**Request Body**

```json
{
  "nodeId": "node_table_001",
  "prevManifestCid": "QmPreviousManifest...",
  "color": "#FF5733",
  "scale": { "x": 1.5, "y": 1.5, "z": 1.5 }
}
```

**Response `200`**

```json
{
  "newManifestCid": "QmNewManifest...",
  "historyEntry": {
    "v": 2,
    "timestamp": 1780002000,
    "src": {
      "cid": "QmAssetCid...",
      "path": "asset.glb",
      "format": "glb"
    },
    "prompt": "Scale 1.5x,1.5x,1.5x, Color #FF5733",
    "provider": "parametric",
    "type": "parametric",
    "params": {
      "scale": { "x": 1.5, "y": 1.5, "z": 1.5 },
      "color": "#FF5733"
    }
  }
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | Missing `nodeId`/`prevManifestCid`, invalid color, invalid scale, or node has no source |
| 404 | Node not found in manifest |
| 500 | IPFS read/write or JSON parsing error |

---

### `POST /api/save-manifest`

Saves a manifest to private IPFS without blockchain interaction.

**Current behavior**

- Ensures `manifest_id` exists.
- Ensures `version` is numeric.
- If `manifest.thumbnail.dataUrl` is present, uploads the thumbnail bytes as a separate IPFS object and replaces the embedded data with CID metadata.

**Request Body**

Any manifest JSON object.

**Response `200`**

```json
{
  "cid": "QmSavedManifest...",
  "manifest_id": "manifest_001",
  "version": 4
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | Body is missing or not an object |
| 500 | IPFS write error |

---

### `POST /api/push-ipfs`

Uploads a JSON payload to private IPFS. The publish flow uses this endpoint to push the final named manifest before minting or updating a token URI.

**Current behavior**

- Accepts a manifest-like JSON object.
- If `thumbnail.dataUrl` exists, uploads it separately to IPFS and replaces it with thumbnail CID metadata.
- Returns the new CID as plain text, not JSON.

**Request Body**

```json
{
  "manifest_id": "manifest_001",
  "version": 4,
  "name": "My World",
  "thumbnail": {
    "type": "snapshot",
    "dataUrl": "data:image/webp;base64,...",
    "mime": "image/webp",
    "format": "webp",
    "path": "thumbnail.webp",
    "width": 512,
    "height": 288,
    "timestamp": 1780000000
  },
  "nodes": []
}
```

**Stored Manifest Thumbnail Shape**

```json
{
  "thumbnail": {
    "type": "snapshot",
    "cid": "QmThumbnailCid...",
    "path": "thumbnail.webp",
    "format": "webp",
    "mime": "image/webp",
    "width": 512,
    "height": 288,
    "bytes": 12345,
    "timestamp": 1780000000
  }
}
```

**Response `200 text/plain`**

```text
QmManifestCid...
```

---

### `GET /api/manifest-chain?cid=<manifestCid>`

Walks the **IPFS content-addressed version chain** (also called the **manifest chain**) — the backward-linked sequence of `prev_manifest_cid` pointers that connects each manifest version to its predecessor. Because every manifest CID is a cryptographic hash of its contents, the chain is tamper-evident: altering any version invalidates all subsequent CIDs.

This endpoint walks backwards through `prev_manifest_cid` links and returns lightweight summaries.

**Query Parameters**

| Param | Required | Description |
|---|---:|---|
| `cid` | Yes | Latest manifest CID to walk from |

**Response `200`**

```json
{
  "chain": [
    {
      "cid": "QmOldManifest...",
      "version": 1,
      "name": "My World",
      "nodeCount": 1,
      "timestamp": 1780000000
    },
    {
      "cid": "QmLatestManifest...",
      "version": 2,
      "name": "My World",
      "nodeCount": 1,
      "timestamp": 1780001000
    }
  ]
}
```

Notes:

- The route stops at 50 entries.
- Circular links are detected and stop traversal.
- `timestamp` currently comes from the first history entry of the first node when available.

---

### `GET /api/manifest-by-token/:tokenId`

Fetches a manifest by on-chain token ID. The backend queries `ArbeskWorld.tokenURI(tokenId)` and then fetches that manifest from private IPFS.

**Response `200`**

```json
{
  "tokenId": "123",
  "manifestCid": "QmManifestCid...",
  "manifest": {
    "manifest_id": "manifest_001",
    "version": 4,
    "name": "My World",
    "thumbnail": {
      "type": "snapshot",
      "cid": "QmThumbnailCid...",
      "format": "webp"
    },
    "nodes": []
  }
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | `tokenId` missing |
| 404 | Token not found or empty token URI |
| 503 | `CONTRACT_ADDRESS` missing or ABI artifact not compiled |
| 500 | Contract/IPFS error |

---

### `GET /api/abi/ArbeskWorld.json`

Serves the compiled contract artifact from:

```text
blockchain/artifacts/contracts/ArbeskWorld.sol/ArbeskWorld.json
```

**Response `200`**

```json
{
  "abi": [],
  "bytecode": "0x..."
}
```

**Response `404`**

```json
{
  "error": "ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile"
}
```

---

## Frontend/Contract Flow Summary

1. User connects wallet.
2. For generation, frontend calls `payForGeneration(nodeId, prompt)` on `ArbeskWorld`.
3. Frontend signs tx hash and calls `POST /api/generate-asset-node`.
4. Backend validates payment, uploads asset, writes manifest, returns new manifest CID.
5. Frontend loads the manifest into Babylon.js and updates `window.activeManifestId` / `window.latestManifestId`.
6. Parametric edits call `POST /api/parametric-version` directly.
7. Save calls `POST /api/save-manifest`.
8. Publish captures an optional WebP thumbnail and calls `POST /api/push-ipfs`.
9. Frontend calls `mintWorld(tokenURI, tokenId)` for new worlds or `updateTokenURI(tokenId, newTokenURI)` for existing worlds.
10. Gallery fetches token URIs from the contract, loads manifests, and displays names/thumbnails.

---

## Planned / Not Yet Implemented API

The following are planned for Phase 5.1 (Token ID-Based Child Worlds) and Phase 5 (Micro-Ledger) or later and are not current backend routes:

### Phase 5.1 — Token Child World Resolution

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /api/resolve-token?chainId=&contract=&tokenId=` | Resolve a token reference to its latest manifest CID (back-end fallback for front-end resolver) | 📋 Planned |

### Phase 5 — Micro-Ledger

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /api/ledger?manifestId=` | Query operation history for a manifest | 📋 Planned |
| `GET /api/ledger/stats` | Aggregate analytics across all manifests | 📋 Planned |

### General

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /api/health` | Health check endpoint | 📋 Planned |
| `GET /api/manifest/:id` | Fetch manifest by internal ID | 📋 Planned |
| `POST /api/manifest` | Create new manifest | 📋 Planned |
| `POST /api/manifest/clone` | Clone manifest with deep copy | 📋 Planned |

---

## Rate Limits

| Route | Limit | Window | Key |
|---|---:|---:|---|
| `POST /api/generate-asset-node` | 10 | 1 hour | recovered wallet address |

The generation route currently emits:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`

`429` responses include:

```json
{
  "error": "RATE_LIMITED",
  "message": "Limit: 10 requests per 3600s",
  "retryAfter": 1234
}
```

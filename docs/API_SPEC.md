# Arbesk API Specification

> Version: 0.6.0 — aligned with the current Express implementation  
> Base URL: `/api`  
> Content-Type: `application/json` unless noted

---

## Implementation Notes

- The backend is mounted from `src/index.js` at `/api`.
- Private IPFS writes use the Kubo API from `IPFS_API_URL` (default `http://127.0.0.1:5001`).
- The browser reads IPFS content through the gateway (`http://127.0.0.1:8080/ipfs/` by default).
- Generation currently supports the mock adapter path. Cloud adapters are planned but return `501` until implemented.
- The default contract is `ArbeskAssetFree` (free tier). `ArbeskAsset` (paid tier) is available via `PAID_CONTRACT_ADDRESS`. The generation route validates the contract configured in `CONTRACT_ADDRESS`.
- Error responses are currently simple JSON objects such as `{ "error": "message" }`; they do not yet use a global typed error envelope.

---

## Authentication

`POST /api/v1/generations` requires a Bearer token built from the transaction hash signature flow when the configured `CONTRACT_ADDRESS` is the paid tier (`ArbeskAsset`):

```text
Authorization: Bearer <base64(message)>.<base64(signature)>
```

The frontend service signs a message containing the transaction hash. The backend:

1. Recovers the wallet address from the signature.
2. Extracts the tx hash from the message.
3. Verifies the transaction receipt on the configured EVM RPC (Hardhat local or Optimism).
4. The generation route then validates the receipt target contract and expected `AssetGenerationPaid` event when `CONTRACT_ADDRESS` is the paid tier.

When the configured `CONTRACT_ADDRESS` is the free tier (`ArbeskAssetFree`), the UI calls `recordGeneration()` for on-chain quota enforcement. The backend validates the `AssetGenerationRecorded` event instead of a payment event.

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

### `POST /api/v1/generations`

Validates a paid generation transaction, generates or mocks an asset, uploads it to private IPFS, and writes a new manifest snapshot.

**Current behavior**

- Paid tier: requires Bearer auth tied to a PayGo transaction.
- Free tier: validates `recordGeneration()` transaction; accepts `AssetGenerationRecorded` event.
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

### `POST /api/parametric-version` — Client-Side Only

> **This backend route does not exist.** Parametric editing (color/scale) is handled entirely in the browser.

**How parametric edits actually work:**

1. User selects a node and changes color/scale in the inspector.
2. `parametric-preview.js` applies the change live to Babylon.js meshes.
3. `asset-save.js` builds a parametric history entry and appends it to the manifest.
4. The browser sends the full updated manifest to `POST /api/v1/manifests` (save draft) or through the publish flow.

The parametric history entry structure stored in the manifest:

```json
{
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
```

---

### `POST /api/v1/manifests`

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

### `POST /api/v1/manifests/:cid/publish`

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

### `GET /api/v1/manifests/:cid/history`

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

Fetches a manifest by on-chain token ID. The backend queries `ArbeskAsset.tokenURI(tokenId)` and then fetches that manifest from private IPFS.

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

### `GET /api/v1/contracts/ArbeskAsset/abi`

Serves the compiled contract artifact from:

```text
blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json
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
2. **Paid tier generation:** frontend calls `payForGeneration(nodeId, prompt)` on `ArbeskAsset`.
   **Free tier generation:** frontend calls `recordGeneration(nodeId, prompt)` on `ArbeskAssetFree`.
3. Frontend signs tx hash and calls `POST /api/v1/generations`.
4. Backend validates payment/event, uploads asset, writes manifest, returns new manifest CID.
5. Frontend loads the manifest into Babylon.js and updates `window.activeManifestId` / `window.latestManifestId`.
6. Parametric edits are applied client-side; the browser sends the updated manifest to `POST /api/v1/manifests`.
7. Save calls `POST /api/v1/manifests`.
8. Publish captures an optional WebP thumbnail and calls `POST /api/v1/manifests/:cid/publish`.
9. Frontend calls `publishAsset(tokenURI, tokenId)` for new worlds or `updateAssetURI(tokenId, newTokenURI)` for existing worlds.
10. Gallery fetches token URIs from the contract, loads manifests, and displays names/thumbnails.
11. Owner adds collaborators via `addEditor(tokenId, address, role)` and manages burn permissions via `setBurnPermission()`.
12. Owner or permitted editors burn tokens via `burn(tokenId)`, which frees `maxTokensPerEditor()` slots.

---

## Collaboration Contract Endpoints (v0.6.0)

These are on-chain functions exposed by both `ArbeskAsset` and `ArbeskAssetFree` through the shared `ArbeskAssetBase` contract. The frontend calls them directly via Web3.js — the backend does NOT proxy these. Documented here for completeness.

### Role-Based Collaboration

| Contract Function | Access | Description |
|---|---|---|
| `addEditor(uint256,address)` | Owner | Add collaborator with default Editor role |
| `addEditor(uint256,address,uint8)` | Owner | Add collaborator with explicit role (1=Viewer, 2=Editor) |
| `addEditor(uint256,address[])` | Owner | Batch add collaborators with Editor role |
| `setCollaboratorRole(uint256,address,uint8)` | Owner | Change role of existing collaborator (1=Viewer, 2=Editor); 0=None removes |
| `getCollaboratorRole(uint256,address)` | Public | Returns 0 (None), 1 (Viewer), or 2 (Editor) |
| `listEditors(uint256)` | Public | Returns all collaborator addresses (Viewers + Editors) |
| `listCollaboratorsByRole(uint256,uint8)` | Public | Returns addresses filtered by role |
| `removeEditor(uint256,address)` | Owner | Remove a collaborator entirely |

**CollaboratorRole enum:**

| Value | Name | Permissions |
|:---:|---|---|
| 0 | None | Not a collaborator |
| 1 | Viewer | Recognized collaborator, read-only |
| 2 | Editor | Can update asset URI via `updateAssetURI()` |

The token **owner** always has implicit full permissions regardless of role.

### Burn

| Contract Function | Access | Description |
|---|---|---|
| `burn(uint256)` | Owner or Editor+Burn | Destroy a token; cleans up all collaborators and frees `maxTokensPerEditor()` slots |
| `setBurnPermission(uint256,address,bool)` | Owner | Grant/revoke burn permission on an Editor-role collaborator |
| `canBurn(uint256,address)` | Public | Returns `true` if address can burn the token |

**Burn permission rules:**
- Token owner can always burn
- Editor-role collaborators need explicit `canBurn` flag
- Viewers can never burn
- Setting `canBurn=true` on a Viewer or non-collaborator reverts
- Burning frees `maxTokensPerEditor()` slots for all collaborators on the token

**New Events:**

| Event | Signature |
|---|---|
| `CollaboratorRoleChanged` | `(uint256 indexed tokenId, address indexed collaborator, uint8 role)` |
| `BurnPermissionChanged` | `(uint256 indexed tokenId, address indexed collaborator, bool canBurn)` |
| `AssetBurned` | `(uint256 indexed tokenId, address indexed burner)` |

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
| `POST /api/v1/generations` | 10 | 1 hour | recovered wallet address |

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

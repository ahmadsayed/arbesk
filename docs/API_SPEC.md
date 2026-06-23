# Arbesk API Specification

> Version: 0.7.0 — aligned with the current Express implementation
> Base URL: `/api`
> Content-Type: `application/json` unless noted

---

## Implementation Notes

- The backend is mounted from `src/index.js` at `/api`.
- Private IPFS writes use the Kubo API from `IPFS_API_URL` (default `http://127.0.0.1:5001`) when `IPFS_BACKEND=kubo`.
- When `IPFS_BACKEND=pinata`, the backend uses the Pinata v3 SDK and serves short-lived presigned upload URLs via `POST /api/v1/ipfs/upload-url`.
- The browser reads IPFS content through the gateway (`http://127.0.0.1:8080/ipfs/` by default for Kubo, or the configured `PINATA_GATEWAY`).
- Generation currently supports the mock adapter path. Cloud adapters are planned but return `501` until implemented.
- The default contract is `ArbeskAssetFree` (free tier). `ArbeskAsset` (paid tier) is available via `PAID_CONTRACT_ADDRESS`. The generation route validates the contract configured in `CONTRACT_ADDRESS`.
- Error responses are simple JSON objects such as `{ "error": { "code": "...", "message": "..." } }`.

---

## Authentication

`POST /api/v1/generations` and `POST /api/v1/ipfs/upload-url` require a valid session token obtained through the SIWE (EIP-4361) sign-in flow:

```text
Authorization: Session <opaque-token>
```

### Creating a session

1. Build a SIWE message (EIP-4361) containing the wallet address, domain, chain ID, nonce, and issued-at timestamp.
2. Sign the message with the wallet (e.g., `personal.sign`).
3. POST the message and signature to `/api/v1/sessions`:

```json
POST /api/v1/sessions
{
  "message": "example.com wants you to sign in...",
  "signature": "0x..."
}
```

The backend verifies the SIWE signature and returns an opaque session token valid for 24 hours:

```json
{
  "token": "<uuid>",
  "expiresAt": 1780001000000
}
```

4. Include the token in subsequent protected requests:

```text
Authorization: Session <uuid>
```

Session tokens are stored in browser `localStorage` under the key `arbesk_session` and are cleared on wallet disconnect.

The generation route validates the transaction receipt and the expected `AssetGenerationPaid`, `AssetGenerationPaidUSDC`, or `AssetGenerationRecorded` event from the configured `CONTRACT_ADDRESS` contract, regardless of whether it is the paid tier (`ArbeskAsset`) or free tier (`ArbeskAssetFree`).

Parametric edits, manifest saves, manifest chain reads, ABI reads, and token manifest reads do not currently require session auth.

---

## Implemented Endpoints

### `GET /api/v1/config`

Returns the configured contract address, network configs, IPFS backend, gateway URL, Hardhat RPC URL, mock-generation flag, and WalletConnect project ID.

**Response**

```json
{
  "contractAddress": "0x...",
  "networkConfigs": {
    "31415822": {
      "name": "Hardhat Local",
      "contractAddress": "0x...",
      "paidContractAddress": "0x...",
      "usdcToken": "0x...",
      "rpcUrl": "http://127.0.0.1:8545"
    },
    "6343": {
      "name": "MegaETH Testnet",
      "contractAddress": "0x...",
      "paidContractAddress": null,
      "usdcToken": null,
      "rpcUrl": "https://carrot.megaeth.com/rpc"
    }
  },
  "ipfsBackend": "kubo",
  "ipfsGatewayUrl": "http://127.0.0.1:8080/ipfs/",
  "hardhatRpcUrl": "http://127.0.0.1:8545",
  "mockGeneration": true,
  "walletConnectProjectId": null
}
```

---

### `POST /api/v1/generations`

Generates or mocks a 3D asset from a text prompt, uploads it to IPFS, and writes a new manifest snapshot.

**Current behavior**

- Requires Session auth (`Authorization: Session <token>`).
- Applies rate limit: 10 requests/hour per wallet (1000/hr in mock mode).
- Requires `prompt` and `nodeId`.
- Accepts optional `providerKey` for BYOK (Bring Your Own Key) cloud providers.
- If `prevAssetManifestCid` is provided, reads and updates the previous manifest.
- In replace mode, keeps only one root node and preserves that node's history chain.
- If `MOCK_3D_GENERATION=true` or provider is `"mock"`, uses `src/api/adapters/mock-adapter.js`.
- If mock mode is disabled and provider is not mock, responds `501` (cloud adapters not implemented yet).
- **No on-chain transaction validation** — the backend does not accept or validate `txHash`. The UI handles contract calls (`recordGeneration()` / `payForGenerationWithUSDC()`) independently.

**Request Body**

```json
{
  "prompt": "A modern minimalist workbench",
  "nodeId": "node_table_001",
  "provider": "mock",
  "assetId": "asset_1700000000000",
  "prevAssetManifestCid": "bafy...",
  "transform_matrix": [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  "tier": 0,
  "providerKey": "sk-..."
}
```

**Response `200`**

```json
{
  "assetManifestCid": "bafy...",
  "sourceAssetCid": "bafy...",
  "tier": 0
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | `prompt` or `nodeId` missing, or `providerKey` required for non-mock provider |
| 401 | Missing, malformed, or invalid Session auth |
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

Saves a manifest to IPFS without blockchain interaction. Accepts both asset manifests and collection manifests.

**Current behavior**

- Ensures `asset_id` exists.
- Ensures `version` is numeric.
- For `type: "collection"`, validates that `assets` is a non-array object.
- For asset manifests, ensures `.scene.nodes` exists via `getSceneNodes()`.
- If `manifest.thumbnail.dataUrl` is present, uploads the thumbnail bytes as a separate IPFS object and replaces the embedded data with CID metadata.
- If the request body includes `publishContext` with a `tokenId`, the backend snapshots the asset's Nostr comment thread from the relay, stores it as a JSON archive on IPFS, and writes the archive CID into the manifest as `comments_archive_cid`. The `publishContext` object is removed before the manifest is stored.

**Request Body — Asset Manifest**

```json
{
  "type": "asset",
  "name": "My World",
  "asset_id": "asset_1700000000000",
  "version": 4,
  "scene": { "nodes": [] },
  "publishContext": {
    "tokenId": "42",
    "chainId": 6343,
    "contractAddress": "0xFdf0DC8c7Fd363de8522cDE9628688A87F2Fd73B"
  }
}
```

**Request Body — Collection Manifest**

```json
{
  "type": "collection",
  "asset_id": "collection_1700000000000",
  "name": "My Collection",
  "version": 3,
  "assets": {
    "asset_1700000000000": "QmAssetManifestA...",
    "asset_1700000001234": "QmAssetManifestB..."
  }
}
```

**Response `201`**

```json
{
  "cid": "QmSavedManifest...",
  "assetId": "asset_1700000000000",
  "version": 4
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | Body is missing or not an object; collection missing `assets` object |
| 500 | IPFS write error |

---

### `POST /api/v1/manifests/:cid/publish`

Uploads a JSON payload to IPFS. The publish flow uses this endpoint to push the final named manifest before minting or updating a token URI.

**Current behavior**

- Accepts a manifest-like JSON object.
- If `thumbnail.dataUrl` exists, uploads it separately to IPFS and replaces it with thumbnail CID metadata.
- Returns the new CID as JSON.

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
  "scene": { "nodes": [] }
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

**Response `200`**

```json
{
  "cid": "QmManifestCid..."
}
```

---

### `GET /api/v1/manifests/:cid/history`

Walks the **IPFS content-addressed version chain** (also called the **manifest chain**) — the backward-linked sequence of `prev_asset_manifest_cid` pointers that connects each manifest version to its predecessor. Because every manifest CID is a cryptographic hash of its contents, the chain is tamper-evident: altering any version invalidates all subsequent CIDs.

This endpoint walks backwards through `prev_asset_manifest_cid` links and returns lightweight summaries.

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
- `timestamp` currently comes from the manifest's top-level `timestamp` field.

---

### `GET /api/v1/tokens/:tokenId/manifest`

Fetches a manifest by on-chain token ID. The backend queries `tokenURI(tokenId)` and then fetches that manifest from IPFS.

**Response `200`**

```json
{
  "tokenId": "123",
  "manifestCid": "QmManifestCid...",
  "manifest": {
    "asset_id": "asset_1700000000000",
    "version": 4,
    "name": "My World",
    "thumbnail": {
      "type": "snapshot",
      "cid": "QmThumbnailCid...",
      "format": "webp"
    },
    "comments_archive_cid": "QmCommentsArchiveCid...",
    "scene": { "nodes": [] }
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

### `POST /api/v1/ipfs/upload-url`

Mints a short-lived client upload credential. Session-gated and rate-limited per wallet.

- In **Pinata** mode, returns a presigned upload URL; the master JWT stays server-side.
- In **Kubo** mode, returns the local Kubo API URL.

**Response `200`**

```json
{
  "backend": "pinata",
  "url": "https://uploads.pinata.cloud/...",
  "expiresAt": 1780001000
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 401 | Missing/invalid session |
| 429 | Upload-url rate limit exceeded |
| 500 | Credential minting failed |

---

### `POST /api/v1/ipfs/bundle`

Uploads multiple files as a single IPFS UnixFS directory and returns the directory root CID. Used to group a glTF + its buffers/textures into one browsable folder.

**Request Body**

```json
{
  "files": [
    { "name": "scene.gltf", "data": "<base64>" },
    { "name": "buffer.bin", "data": "<base64>" }
  ]
}
```

**Response `200`**

```json
{
  "bundleCid": "bafy..."
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | `files` array missing, empty, >200 entries, or invalid file entries |
| 401 | Missing/invalid session |
| 429 | Upload rate limit exceeded |
| 500 | Bundle assembly failed |

---

### `POST /api/v1/ipfs/unpin`

Unpins all IPFS CIDs owned by a manifest chain. Called after token burn.

**Request Body**

```json
{
  "cid": "bafy..."
}
```

**Response `200`**

```json
{
  "unpinned": ["bafy...", "Qm..."],
  "count": 2
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | Missing `cid` |
| 500 | Unpin failed |

---

### `GET /api/v1/contracts/:name/abi`

Serves the compiled contract artifact from:

```text
blockchain/artifacts/contracts/<Name>.sol/<Name>.json
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
  "error": {
    "code": "ABI_NOT_FOUND",
    "message": "ABI not found. Run: docker-compose run --rm hardhat npx hardhat compile"
  }
}
```

---

## Frontend/Contract Flow Summary

1. User connects wallet.
2. **Paid tier generation:** frontend calls `payForGenerationWithUSDC(nodeId, prompt, tier)` on `ArbeskAsset`.
   **Free tier generation:** frontend calls `recordGeneration(nodeId, prompt)` on `ArbeskAssetFree`.
3. Frontend calls `POST /api/v1/generations` (with session auth, prompt, nodeId).
   The backend does **not** validate the on-chain transaction — it only checks session + rate limit and returns a mock asset.
4. Frontend loads the manifest into Babylon.js and updates asset state.
5. Parametric edits are applied client-side; the browser sends the updated manifest to `POST /api/v1/manifests`.
6. Save calls `POST /api/v1/manifests`.
7. Publish captures an optional WebP thumbnail and calls `POST /api/v1/manifests` (asset manifest).
8. The asset CID is merged into the collection manifest, which is also saved to IPFS.
9. Frontend calls `publishAsset(collectionCid, tokenId, editorRoot, editorListUri)` for new collections or `updateAssetURI(tokenId, newCollectionCid, proof)` for existing collections.
10. Gallery fetches token URIs from the contract, loads collection manifests, expands them into individual assets, and displays names/thumbnails.
11. Editors manage the off-chain editor list via `services/team.js`; changes are anchored on-chain with `updateEditors(tokenId, newRoot, newListUri, callerRole, callerProof)`.
12. Owner or editors burn tokens via `burn(tokenId, proof)`, which then triggers non-blocking IPFS unpin.

---

## Collaboration Contract Endpoints (v0.7.0)

These are on-chain functions exposed by both `ArbeskAsset` and `ArbeskAssetFree` through the shared `ArbeskAssetBase` contract. The frontend calls them directly via Web3.js — the backend does NOT proxy these. Documented here for completeness.

### Merkle-Based Editor Authorization

The contract does **not** store per-address roles. It stores a Merkle root of the editor set and a monotonic version. The full editor list lives on IPFS.

| Contract Function | Access | Description |
|---|---|---|
| `publishAsset(string uri, uint256 tokenId, bytes32 editorRoot, string editorListUri)` | Any | Mint a new token with the initial editor Merkle root and the IPFS URI of the editor list |
| `updateEditors(uint256 tokenId, bytes32 newRoot, string newListUri, uint8 callerRole, bytes32[] callerProof)` | Current Editor | Replace the editor set with a new Merkle root and list URI |
| `updateAssetURI(uint256 tokenId, string newURI, bytes32[] proof)` | Owner or Editor with proof | Update the token's URI (collection manifest CID) |
| `burn(uint256 tokenId, bytes32[] proof)` | Owner or Editor with proof | Destroy the token |
| `editorRoot(uint256 tokenId)` | Public | Current editor Merkle root |
| `editorSetVersion(uint256 tokenId)` | Public | Current editor set version |

**CollaboratorRole enum:**

| Value | Name | Permissions |
|:---:|---|---|
| 0 | None | Not a collaborator |
| 1 | Viewer | Recognized collaborator, read-only |
| 2 | Editor | Can call `updateAssetURI`, `updateEditors`, and `burn` with a valid Merkle proof |

The token **owner** always has implicit full permissions regardless of role.

**Merkle leaf format (matches `merkle-editors.js`):**

```solidity
keccak256(abi.encodePacked(address, role, tokenId, editorSetVersion[tokenId]))
```

**Editor set update flow:**

1. Load current editor list from IPFS / localStorage.
2. Build caller's Merkle proof against the current root/version.
3. Compute the new root for the updated editor list at `editorSetVersion + 1`.
4. Upload the new editor list to IPFS.
5. Call `updateEditors(tokenId, newRoot, newListUri, callerRole, callerProof)`.

### Events

| Event | Signature |
|---|---|
| `EditorSetChanged` | `(uint256 indexed tokenId, bytes32 newRoot, uint256 newVersion)` |
| `AssetBurned` | `(uint256 indexed tokenId, address indexed burner)` |
| `AssetURIUpdated` | `(uint256 indexed tokenId, string newURI)` |

---

## Planned / Not Yet Implemented API

The following are planned backend routes not currently implemented. Note that Phase 5.1 (Token ID-Based Child Worlds) is complete — the browser resolver is the current path; a backend fallback is optional:

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
| `POST /api/v1/generations` | 10 (1 000 in mock mode) | 1 hour | recovered wallet address |
| `POST /api/v1/ipfs/upload-url` | 20 | 1 minute | recovered wallet address |
| `POST /api/v1/ipfs/bundle` | 20 | 1 minute | recovered wallet address |

The generation route currently emits:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`

`429` responses include:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Limit: 10 requests per 3600s",
    "retryAfter": 1234
  }
}
```

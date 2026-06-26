# Arbesk API Specification

> Version: 0.8.0 — aligned with the current Express implementation
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

The following routes require a valid SIWE (EIP-4361) session token:

- `POST /api/v1/generations`
- `POST /api/v1/ipfs/upload-url`
- `POST /api/v1/ipfs/unpin`
- `POST /api/v1/assets/snapshot-comments`

The WebSocket chat proxy (`/api/v1/chat/ws`) receives the same session token in the query string.

All other endpoints are public.

Protected routes use this header:

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

The generation route validates session auth and rate limiting. The backend calls the adapter and returns raw asset bytes (base64). The browser uploads the asset to IPFS, constructs the manifest, and writes it to IPFS — no server-side IPFS writes.

Parametric edits, manifest saves, manifest chain reads, ABI reads, and token manifest reads are all client-side and do not use backend routes.

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

Generates or mocks a 3D asset from a text prompt and returns the raw asset bytes. The browser handles IPFS upload and manifest construction.

**Current behavior**

- Requires Session auth (`Authorization: Session <token>`).
- Applies rate limit: 10 requests/hour per wallet (1000/hr in mock mode).
- Requires `prompt` and `nodeId`.
- Accepts optional `providerKey` for BYOK (Bring Your Own Key) cloud providers.
- If `MOCK_3D_GENERATION=true` or provider is `"mock"`, uses `src/api/adapters/mock-adapter.js`.
- If mock mode is disabled and provider is not mock, responds `501` (cloud adapters not implemented yet).
- **No on-chain transaction validation** — the backend does not accept or validate `txHash`. The UI handles contract calls (`recordGeneration()` / `payForGenerationWithUSDC()`) independently.
- **No IPFS writes** — returns raw asset bytes (base64). The browser (`api.js` → `generateAsset()`) uploads the asset to IPFS, constructs the manifest, and uploads the manifest.

**Request Body**

```json
{
  "prompt": "A modern minimalist workbench",
  "nodeId": "node_table_001",
  "provider": "mock",
  "providerKey": "sk-..."
}
```

**Response `200`**

```json
{
  "assetData": "eyJhc3NldCI6eyJnZW5lcmF0b3IiOi...",
  "format": "gltf",
  "path": "asset.gltf",
  "provider": "mock"
}
```

The browser (`api.js` → `generateAsset()`) decodes the base64, uploads the asset to IPFS, constructs the manifest, uploads the manifest, and returns `{ assetManifestCid, sourceAssetCid }` to the UI.

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
3. On save, `services/asset-save/manifest-builder.js` either:
   - bakes color edits into a new composite glTF CID and updates `node.source.cid`, or
   - stores scale/color overlays in `node.post_processor` for monolithic assets.
4. The browser writes the full updated manifest directly to IPFS via `writeJSONToIPFS()`.

The manifest schema reserves an optional `scene.nodes[].history` array for provenance, but current write paths do not populate it.

---

### `POST /api/v1/assets/snapshot-comments`

Snapshots the asset-level Nostr comment thread for a published asset to a content-addressed IPFS archive. Called by the browser before writing a republish manifest so the archive CID can be embedded.

Comments are scoped per asset using the canonical tag `<chainId>:<contractAddress>:<tokenId>:<assetId>`. This tag is derived from the manifest `asset_id`, so no manifest schema change is required. Manifests themselves are written directly to IPFS by the browser — this endpoint only handles the server-side Nostr archive work (requires the service private key).

**Request Body**

```json
{
  "tokenId": "42",
  "chainId": 6343,
  "contractAddress": "0x...",
  "assetId": "asset_1700000000000"
}
```

- `tokenId` and `assetId` are required.
- `chainId` defaults to Hardhat local (`31415822`).
- `contractAddress` defaults to the configured contract for the chain.

**Response `200`**

```json
{
  "cid": "bafyArchiveCid...",
  "eventCount": 3
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | `tokenId` or `assetId` missing |
| 401 | Missing or invalid session |
| 503 | Contract address not configured |
| 500 | Archive creation failed |

---

### Manifests, Thumbnails, History, Tokens — Client-Side

> **These backend routes do not exist.** The browser handles all manifest and thumbnail operations directly:
>
> - **Manifest writes:** `writeJSONToIPFS()` in `services/asset-save/manifest-builder.js` and `asset-delete.js`
> - **Thumbnail upload:** `captureAssetThumbnail()` → `writeToIPFS()` in `scene-graph.js`
> - **History chain walk:** `walkManifestChain()` in `time-travel.js` (IPFS gateway reads)
> - **Token resolution:** `resolveChildRef()` in `token-resolver.js` (Web3 + IPFS gateway)
> - **Bundle directories:** Removed — each file is individually addressable by `ipfs://<cid>`

---

### `POST /api/v1/ipfs/upload-url`

Mints a short-lived client upload credential. Session-gated and rate-limited per wallet. In Pinata mode it returns a presigned URL; in Kubo mode it returns the local API URL. The master Pinata JWT never reaches the browser.

**Request Body**

Empty (`{}`).

**Response `200`**

Pinata:
```json
{
  "backend": "pinata",
  "url": "https://uploads.pinata.cloud/v3/files?signed=...",
  "gateway": "https://gateway.pinata.cloud/ipfs/",
  "reusable": false
}
```

Kubo:
```json
{
  "backend": "kubo",
  "apiUrl": "http://127.0.0.1:5001",
  "gateway": "http://127.0.0.1:8080/ipfs/",
  "reusable": true
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 401 | Missing or invalid session |
| 429 | Rate limit exceeded |
| 500 | Credential minting failed |

---

### `POST /api/v1/ipfs/unpin`

Unpins all IPFS CIDs owned by a manifest chain. Called after token burn or asset removal from a collection.

Walks `prev_asset_manifest_cid` backward, collecting manifest CIDs, source asset CIDs, thumbnail CIDs, comments archive CIDs, and optional `history` entry CIDs, then unpins them all so they become eligible for garbage collection.

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

If individual unpin attempts fail (e.g. CID was already unpinned), the response includes:

```json
{
  "unpinned": ["bafy..."],
  "count": 1,
  "errors": ["unpin Qm...: not pinned"]
}
```

**Errors**

| HTTP | Meaning |
|---:|---|
| 400 | Missing `cid` |
| 401 | Missing or invalid session |
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
4. Frontend uploads the asset bytes to IPFS, constructs the manifest, and writes the manifest to IPFS directly in the browser.
5. Parametric edits are applied client-side; the browser writes the updated manifest directly to IPFS.
6. Save writes the asset manifest directly to IPFS via `writeJSONToIPFS()`.
7. Publish captures an optional WebP thumbnail and writes the asset manifest directly to IPFS.
8. On republish, the browser calls `POST /api/v1/assets/snapshot-comments` (with `assetId`) to archive the asset-level comment thread and embed the archive CID in the manifest.
9. The asset CID is merged into the collection manifest, which is also saved to IPFS.
10. Frontend calls `publishAsset(collectionCid, tokenId, editorRoot, editorListUri)` for new collections or `updateAssetURI(tokenId, newCollectionCid, proof)` for existing collections.
11. Gallery fetches token URIs from the contract, loads collection manifests, expands them into individual assets, and displays names/thumbnails.
12. Editors manage the off-chain editor list via `services/team.js`; changes are anchored on-chain with `updateEditors(tokenId, newRoot, newListUri, callerRole, callerProof)`.
13. Owner or editors burn tokens via `burn(tokenId, proof)`, which then triggers non-blocking IPFS unpin via `POST /api/v1/ipfs/unpin`.
14. Asset-level live comments travel through `/api/v1/chat/ws`; the proxy checks the SIWE session and either owner status or a Merkle editor proof before bridging to the Nostr relay.

---

## Collaboration Contract Endpoints (v0.8.0)

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

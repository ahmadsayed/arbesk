# API Reference — Arbesk Asset Inspection

Full API endpoint documentation for asset inspection.

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

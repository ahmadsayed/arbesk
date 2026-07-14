# API Reference — Arbesk IPFS & Storage

## `POST /api/v1/ipfs/upload-urls`

Session-gated, rate-limited (same budget as `/upload-url`). Mints `count`
upload credentials in one call — see [→ Pinata Mode](./pinata-mode.md) for
why (Pinata signed URLs are single-use, so batch uploads need one credential
per file).

### Request
```json
{ "count": 5 }
```
`count` is optional (default 1), integer, 1–200 (`uploadUrlsSchema` in
`src/api/schemas.js`).

### Response (200)
```json
{
  "credentials": [
    { "backend": "pinata", "url": "https://uploads.pinata.cloud/...", "gateway": "https://.../ipfs/", "reusable": false },
    { "backend": "pinata", "url": "https://uploads.pinata.cloud/...", "gateway": "https://.../ipfs/", "reusable": false }
  ]
}
```
Kubo mode returns `count` copies of the same `{ backend: "kubo", apiUrl, gateway, reusable: true }` credential (no-op — Kubo credentials are already reusable).

### Errors
| HTTP | Meaning |
|---:|---|
| 400 | `count` missing bounds (must be 1–200) |
| 401 | Missing or invalid session |
| 429 | Rate limit exceeded |
| 500 | Mint failed (e.g. Pinata API error) |

## `POST /api/v1/ipfs/unpin`

Session-gated. Unpins all IPFS CIDs owned by a manifest chain. Called after token burn or asset removal from a collection.

### Request
```json
{
  "cid": "bafkreifsk5guke4cc7nzx72gugg5sakgwaqe4zso76vyamwzwadtuqmbri"
}
```

### Response (200)
```json
{
  "unpinned": ["bafkreia7kc...", "bafybeicso2bhrwbry..."],
  "count": 2,
  "errors": []
}
```

### Behavior
- Walks `prev_asset_manifest_cid` up to 100 entries deep
- Handles circular links (stops and logs)
- Collects manifest CIDs, `thumbnail.cid`, `comments_archive_cid`, `source.cid`, `source.bundleCid`, and `history[].src.cid` plus embedded buffer/image CIDs
- "not pinned" errors are treated as success (content already eligible for GC)
- All unpin attempts continue even if individual ones fail

### Errors
| HTTP | Meaning |
|---:|---|
| 400 | Missing `cid` |
| 401 | Missing or invalid session |
| 500 | Unpin failed |

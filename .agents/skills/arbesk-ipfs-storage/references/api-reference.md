# API Reference — Arbesk IPFS & Storage

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

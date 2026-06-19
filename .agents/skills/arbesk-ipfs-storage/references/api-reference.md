# API Reference — Arbesk IPFS & Storage

Unpin endpoint specification.

## 8. The Unpin Endpoint (`POST /api/v1/ipfs/unpin`)

### Request
```json
{
  "cid": "bafkreifsk5guke4cc7nzx72gugg5sakgwaqe4zso76vyamwzwadtuqmbri",
  "actorAddress": "0x..."  // optional, for ledger audit
}
```

### Response (200)
```json
{
  "unpinned": ["bafkreia7kc...", "bafybeicso2bhrwbry...", ...],
  "count": 42,
  "errors": ["unpin bafkreibad...: some error"]  // optional, only if errors occurred
}
```

### Behavior
- Walks `prev_asset_manifest_cid` up to 100 entries deep
- Handles circular links (stops and logs)
- "not pinned" errors are treated as success (content already eligible for GC)
- All unpin attempts continue even if individual ones fail
- Records to micro-ledger as `opType: "UNPIN"`

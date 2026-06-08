# API Reference — Arbesk IPFS & Storage

Unpin endpoint specification.

## 8. The Unpin Endpoint (`POST /api/v1/ipfs/unpin`)

### Request
```json
{
  "cid": "QmManifestCidToStartFrom...",
  "actorAddress": "0x..."  // optional, for ledger audit
}
```

### Response (200)
```json
{
  "unpinned": ["Qm...", "Qm...", ...],
  "count": 42,
  "errors": ["unpin QmBad: some error"]  // optional, only if errors occurred
}
```

### Behavior
- Walks `prev_asset_manifest_cid` up to 100 entries deep
- Handles circular links (stops and logs)
- "not pinned" errors are treated as success (content already eligible for GC)
- All unpin attempts continue even if individual ones fail
- Records to micro-ledger as `opType: "UNPIN"`

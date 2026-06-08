# Manifest Structure — Arbesk Asset Inspection

Full manifest schema and node type reference.

## Manifest Structure

Every Arbesk manifest is a JSON document stored on the private IPFS node. Key fields:

```json
{
  "asset_id": "asset_<timestamp>",           // Unique asset identifier
  "version": <int>,                          // Monotonically increasing
  "timestamp": <unix ms>,                    // Creation time
  "prev_asset_manifest_cid": "<cid>",        // Backward chain link (null for v1)
  "name": "Untitled Asset",                  // Human-readable name
  "thumbnail": {                             // Optional WebP snapshot
    "type": "snapshot",
    "cid": "Qm...",
    "path": "thumbnail.webp",
    "format": "webp",
    "mime": "image/webp",
    "width": 512,
    "height": 288,
    "bytes": 5248,
    "timestamp": 1780000000
  },
  "scene": {
    "nodes": [ ... ]                         // Array of scene nodes
  }
}
```

## Node Types

Each entry in `scene.nodes` is one of two types:

### 1. Source Asset Node (local GLTF/GLB)

```json
{
  "node_id": "untitled_asset_1780583349541",
  "type": "source_asset",
  "name": "person",
  "source": {
    "cid": "QmavQYrXKWERMEuz9q4viP8UU5rxCFJbpKKeAxvtQg8rT5",
    "path": "asset.gltf",
    "format": "gltf"
  },
  "transform_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "appearance": {
    "color": null,
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "history": [ ... ]                         // Optional version history
}
```

### 2. Token Child Node (dynamic child world reference)

```json
{
  "node_id": "child_token_31415822_0x9fE4_172409538",
  "name": "Untitled Asset",
  "transform_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  "child_ref": {
    "type": "token",
    "chainId": 31415822,
    "contractAddress": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "tokenId": "172409538",
    "standard": "ERC721",
    "resolution": "latest"
  }
}
```

**Key rule:** Token child nodes do NOT have `history` or `source` fields. The version history belongs to the referenced token. The parent manifest only owns the `transform_matrix` (placement).

## Counting Children

To determine how many child worlds an asset contains, inspect `manifest.scene.nodes` and count nodes that have a `child_ref` (or legacy `child_manifest_id`) field:

```bash
# Quick count using curl + jq
curl -s http://127.0.0.1:9090/api/v1/tokens/1409751252/manifest \
  | jq '[.manifest.scene.nodes[] | select(.child_ref != null or .child_manifest_id != null)] | length'
```

A node is a **child** if it has `.child_ref` or `.child_manifest_id`. Nodes with only `.source` are self-contained GLTF assets, not children.

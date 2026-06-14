# Child-World Transforms — Anchor Hierarchy & Selection

## The Two-Level Anchor Structure

Every `child_ref` node in a manifest produces **two** Babylon anchors:

```
rootSceneAnchor
  └─ outerAnchor  ("anchor_child_token_...")   ← placement transform lives here
       └─ childAnchor ("child_anchor_child_token_...")  ← child manifest content parented here
            └─ child manifest root nodes
                 └─ meshes (metadata.nodeId = child-internal id)
```

| Anchor | Created by | Purpose | Has `metadata.nodeId`? |
|--------|-----------|---------|----------------------|
| `outerAnchor` | `loadNode` | Holds the parent manifest's `transform_matrix` (placement) | YES — set explicitly |
| `childAnchor` | `loadTokenChildNode` | Root for the child world's own scene graph | YES — fallback for freshly-dropped nodes |

## Critical Rule: `state.nodeAnchors` must point to the outer anchor

`state.nodeAnchors.get("child_token_...")` must return `outerAnchor`, NOT `childAnchor`.

`loadNode` registers the outer anchor first. `loadTokenChildNode` must **not** overwrite it:

```js
// scene-graph.js — loadTokenChildNode
if (!state.nodeAnchors.has(node.node_id)) {
  state.nodeAnchors.set(node.node_id, childAnchor); // only for freshly-dropped (no outer anchor yet)
}
```

If `nodeAnchors` points to `childAnchor`, `captureSelectedTransform` reads the inner anchor's
LOCAL position (relative to outerAnchor), not the world position. On save this local offset
replaces the manifest `transform_matrix`, and on reload the position is wrong.

## Tagging Both Anchors

Both anchors must carry `nodeId` in metadata for the pointer walk to resolve correctly:

```js
// outerAnchor — set in loadNode for child_ref nodes
anchor.metadata = { nodeId: node.node_id };

// childAnchor — set in loadTokenChildNode
childAnchor.metadata = {
  childRef,
  resolvedCid: resolution.manifestCid,
  loaded: true,
  nodeId: node.node_id,  // fallback for freshly-dropped path
};
```

## Pointer Walk: Scan the Full Chain

**Never stop at the first `nodeId` found.** Child-world meshes carry a child-internal `nodeId`
(e.g. `"person_node_0"`). The `childRef` boundary is further up the tree on `childAnchor`.

```
personMesh         metadata.nodeId = "person_node_0"   ← walk CONTINUES (don't stop here)
  ↓ parent
glTF TransformNode metadata.nodeId = "person_node_0"   ← walk CONTINUES
  ↓ parent
personNodeAnchor   metadata.nodeId = "person_node_0"   ← walk CONTINUES
  ↓ parent
childAnchor        metadata.childRef = {...}            ← BOUNDARY FOUND
  ↓ parent
outerAnchor        metadata.nodeId = "child_token_..."  ← USE THIS
```

Correct walk logic (`scene-graph.js` pointer observable):

```js
let firstNodeId = null;
let childWorldNodeId = null;

while (target) {
  if (target.metadata?.childRef) {
    // Prefer the outer anchor's nodeId (manifest-loaded); fall back to
    // childAnchor's own nodeId (freshly-dropped, no outer anchor exists).
    childWorldNodeId =
      target.parent?.metadata?.nodeId ||
      target.metadata?.nodeId ||
      null;
    break;
  }
  if (target.metadata?.nodeId && !firstNodeId) {
    firstNodeId = target.metadata.nodeId;  // save but keep walking
  }
  target = target.parent;
}

const resolvedNodeId = childWorldNodeId || firstNodeId;
const isChildWorldNode = !!childWorldNodeId;
```

## Outliner → Scene Selection Wiring

The outliner emits `OUTLINER_NODE_SELECTED`, not `NODE_SELECTED`. Without a bridge,
`state.highlightedNodeId` is never updated and the gizmo never attaches.

```js
// scene-graph.js — near the bottom with other event handlers
on(EVENTS.OUTLINER_NODE_SELECTED, (e) => {
  const nodeId = e.detail?.nodeId;
  if (nodeId) selectNodeById(nodeId);
});
```

`selectNodeById` → `selectNode` → emits `NODE_SELECTED` → transform gizmo attaches. ✓

## Transform Save Path

When `captureSelectedTransform` runs with `nodeId = "child_token_..."`:

1. `state.nodeAnchors.get("child_token_...")` → `outerAnchor`
2. Reads `outerAnchor.position` (world-space, since parent = `rootSceneAnchor` at origin)
3. `state.pendingTransformEdits.set("child_token_...", matrixArray)`

On save (`prepareManifestForWrite`):

```js
const node = manifest.scene.nodes.find(n => n.node_id === nodeId); // finds "child_token_..."
node.transform_matrix = matrixArray; // updates placement
```

On reload, `applyTransformMatrix(outerAnchor, node.transform_matrix)` positions the outer anchor
at the saved world position. `childAnchor` remains at (0,0,0) relative to it. ✓

## Freshly-Dropped vs Manifest-Loaded

| Path | Outer anchor? | `nodeAnchors` entry | `captureSelectedTransform` reads |
|------|--------------|--------------------|---------------------------------|
| Manifest-loaded | YES (`loadNode`) | `outerAnchor` | `outerAnchor.position` = world pos ✓ |
| Freshly-dropped | NO (`handleLinkedAssetDropped` skips `loadNode`) | `childAnchor` | `childAnchor.position` relative to `rootSceneAnchor` = world pos ✓ (rootSceneAnchor is at origin) |

Both paths produce a correct world-space `transform_matrix` in the saved manifest.

## Common Mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No Changes" on Save after moving child world | `captureSelectedTransform` storing transform under child-internal nodeId (walk stopped at mesh) | Walk full chain; don't break on first `nodeId` |
| Child world jumps to wrong position on reload | `nodeAnchors` points to `childAnchor`; local offset saved instead of world pos | Fix `loadTokenChildNode` to not overwrite outer anchor |
| Moving child world has no effect | Outliner click never set `state.highlightedNodeId`; gizmo not attached | Wire `OUTLINER_NODE_SELECTED` → `selectNodeById` |
| Sub-mesh toggle fires on child world click | `isChildWorldNode` not detected; walk incorrectly stopped at mesh nodeId | Use `isChildWorldNode` flag to suppress sub-mesh toggle |

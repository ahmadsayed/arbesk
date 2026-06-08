# Troubleshooting — Arbesk glTF 2.0 / GLB Pipeline

Common operations, debugging guides, and force re-decomposition.

## 10. Common Operations

### 10.1 Add a New Material Property to the Editor

1. Add the setter function in `material-editor.js` (e.g., `setClearcoatFactor()`)
2. If it should be exposed in the inspector UI, add a control in `parametric-preview.js`
3. Wire it to `state.pendingPostProcessorEdits` or extend the `meshOverrides` schema
4. Update `prepareManifestForWrite()` in `asset-save.js` if the property bakes differently for decomposed vs monolithic

### 10.2 Add Support for a New 3D Format (e.g., OBJ, FBX)

1. Add format detection logic to `detectAssetFormat()` in `transforms.js`
2. Add a loading branch in `loadAsset()` in `scene-graph.js`
3. If the format needs preprocessing (like glTF composition), create a new module in `frontend/src/js/gltf/` or a new directory
4. Decide whether the format should be decomposed or treated monolithically
5. Update `decomposeManifestNodes()` in `asset-save.js` to skip the new format if it shouldn't be decomposed
6. Update the manifest schema documentation in `AGENTS.md` section 7

### 10.3 Debug "glTF Loading Failure"

Check in order:
1. **Is it a composite glTF?** Look for `ipfs://` in buffer/image URIs. If yes, `composeGlTF()` must run. Check gateway is accessible at `http://127.0.0.1:8080/ipfs/<CID>`.
2. **Is it a legacy CID-prefix glTF?** Look for `data:application/cid;base64,`. `composeGlTF()` handles this, but verify the CID is valid.
3. **Is the CID valid?** Try `docker-compose exec ipfs ipfs cat <CID>` to verify the data exists and is pinned.
4. **Does glTF have `asset.version`?** The material editor validates this. A non-glTF JSON stored under a source CID will fail.
5. **Browser console?** Look for `[SCENE]`, `[COMPOSE]`, or `[DECOMPOSE]` prefixed logs.

### 10.4 Debug "Colors Not Applying After Save"

1. Check if the node is decomposed: `node.source.path === "composite.gltf"`
2. If decomposed: colors should be **baked into the composite CID** (node has no `post_processor.color`). Verify `editCompositeColors()` succeeded.
3. If monolithic: colors should be in `node.post_processor.color`. Verify `applyColor()` runs in `loadNode()`.
4. Check the manifest in IPFS: `docker-compose exec ipfs ipfs cat <manifestCid>` and inspect the node's `source` and `post_processor`.

### 10.5 Force Re-decomposition

If a monolithic glTF was saved but decomposition failed silently, it stays monolithic. To force re-decomposition:
1. Delete `node.source.path = "composite.gltf"` constraint — or
2. Manually call `decomposeAndStore(gltf)` in browser console
3. Update `node.source.cid` and `node.source.path`


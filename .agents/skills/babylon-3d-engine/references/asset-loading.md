# Asset Loading — GLTF / GLB in Babylon.js

## The Two Loading Paths

Arbesk loads 3D assets from IPFS into Babylon.js. The path depends on format:

### GLB (Binary)

```js
// 1. Fetch raw binary from IPFS
const blob = await getBlobFromRemoteIPFS(cid);

// 2. Create blob URL
const blobUrl = URL.createObjectURL(blob);

// 3. Import with extension hint
const result = await BABYLON.SceneLoader.ImportMeshAsync(
  "", blobUrl, "", scene, null, ".glb"
);

// 4. Revoke to free memory
URL.revokeObjectURL(blobUrl);
```

### glTF (JSON)

```js
// 1. Fetch JSON from IPFS
const gltfJson = await getFromRemoteIPFS(cid);

// 2. Compose (resolve ipfs:// URIs → base64 data URIs)
const composed = composeGlTF(gltfJson);

// 3. Stringify to blob
const blob = new Blob([JSON.stringify(composed)], { type: "model/gltf+json" });
const blobUrl = URL.createObjectURL(blob);

// 4. Import
const result = await BABYLON.SceneLoader.ImportMeshAsync(
  "", blobUrl, "", scene, null, ".gltf"
);

// 5. Revoke
URL.revokeObjectURL(blobUrl);
```

## Metadata Attachment

After import, every mesh must be tagged so pointer picking works:

```js
function attachMetadata(meshes, importedNodes, parentNode, nodeId) {
  for (const mesh of meshes) {
    mesh.metadata = {
      nodeId: nodeId,
      isNodeRoot: mesh.parent === parentNode,
    };
  }
  // Walk imported nodes and tag transform nodes too
  for (const node of importedNodes) {
    if (node.metadata) node.metadata.nodeId = nodeId;
  }
}
```

The pointer observable walks the parent chain to find `nodeId`:

```js
state.scene.onPointerObservable.add((pointerInfo) => {
  const pickResult = pointerInfo.pickInfo;
  if (pickResult.hit && pickResult.pickedMesh) {
    let target = pickResult.pickedMesh;
    while (target) {
      if (target.metadata?.nodeId) {
        selectNode(target.metadata.nodeId, target);
        return;
      }
      target = target.parent;
    }
  }
  // Clicked empty space → deselect
  if (state.highlightedNodeId) deselectAll();
}, BABYLON.PointerEventTypes.POINTERPICK);
```

## Centering Imported Assets

`centerImportedAsset()` shifts the asset so its bounding-box center sits on the anchor:

```js
function centerImportedAsset(meshes) {
  if (meshes.length === 0) return;
  const bounds = new BABYLON.BoundingInfo(
    BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()
  );
  for (const mesh of meshes) {
    bounds.reconstruct(mesh.getBoundingInfo());
  }
  const center = bounds.boundingBox.center;
  for (const mesh of meshes) {
    mesh.position.subtractInPlace(center);
  }
}
```

## Placeholder on Failure

If loading fails, a box placeholder is created:

```js
const box = BABYLON.MeshBuilder.CreateBox(
  `placeholder_${nodeId}`, { size: 1 }, scene
);
box.material = state.defaultWoodMaterial;
attachMetadata([box], [], parentNode, nodeId);
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Black mesh after import | No light in scene, or missing material | Check `applyDefaultMaterial()`, ensure lights exist |
| Mesh not pickable | Missing `metadata.nodeId` | Call `attachMetadata()` after import |
| GLTF loads but textures missing | `ipfs://` URIs not composed | Ensure `composeGlTF()` runs before import |
| Blob URL shows 404 | URL revoked too early | Revoke **after** `ImportMeshAsync` resolves |
| Imported asset off-center | Not centered on anchor | Call `centerImportedAsset()` after import |
| Memory grows per load | Blob URLs not revoked | Always `URL.revokeObjectURL(blobUrl)` |

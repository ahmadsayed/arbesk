# Deep Dive — Arbesk glTF 2.0 / GLB Pipeline

Full architectural overview: compose/decompose, scene graph loading, post-processor system, material editing, save flow, and golden rules.

## 1. Architecture Overview

Arbesk stores 3D content on a **private Kubo IPFS node** and renders it in the browser with **Babylon.js**. The glTF pipeline has two distinct formats:

```
┌────────────────────────────────────────────────────────────────┐
│  GLB (Binary)                    glTF 2.0 (JSON)               │
│  ─────────────                   ───────────────               │
│  • Stored as raw binary blob     • Stored as JSON on IPFS      │
│  • Loaded via getBlobFrom-       • Two sub-formats:            │
│    RemoteIPFS → blob URL           ─ Monolithic: buffers/      │
│  • BABYLON.SceneLoader.              images are data URIs       │
│    ImportMeshAsync(".glb")         ─ Composite: buffers/       │
│  • No decomposition needed           images are ipfs:// CIDs   │
│  • post_processor overlay           • composeGlTF() resolves   │
│    applied at runtime                 CIDs → data URIs          │
│                                    • decomposeGlTF() stores    │
│                                      components individually   │
│                                    • Material edits bake into  │
│                                      composite JSON only       │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Files Reference

| File | Role | When to touch |
|------|------|---------------|
| `frontend/src/js/gltf/composer.js` | Resolves `ipfs://<CID>` URIs → base64 data URIs for Babylon.js | Fix loading failures, add new URI formats |
| `frontend/src/js/gltf/decomposer.js` | Extracts buffer/image data URIs → stores on IPFS, replaces with `ipfs://<CID>` | Add new glTF component types to decompose |
| `frontend/src/js/gltf/material-editor.js` | Fetches composite glTF, modifies material PBR props, commits new CID | Add material property editors, fix color baking |
| `frontend/src/js/gltf/uri_to_cid.js` | **Legacy** — converts between CID-prefix URIs and base64 data URIs | Legacy compat only; new code uses composer/decomposer |
| `frontend/src/js/engine/transforms.js` | `extractCid()`, `detectAssetFormat()`, `applyDefaultMaterial()` | Add new format detection, change default material |
| `frontend/src/js/engine/scene-graph.js` | `loadAsset()` dispatches GLB vs glTF; `loadNode()` applies `post_processor` | Fix loading, add OBJ/FBX support |
| `frontend/src/js/engine/time-travel.js` | `applyColor()`, `applyScale()` — runtime color/scale overlays | Fix color application, add new post-processor effects |
| `frontend/src/js/engine/parametric-preview.js` | Inspector UI: node color, per-component mesh overrides, scale | Add inspector controls |
| `frontend/src/js/ui/asset-save.js` | `prepareManifestForWrite()` — bakes colors into composite glTF or stores as post_processor | Fix save flow, change edit persistence |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS write via `POST /api/v0/add` | Debug upload failures |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS read via gateway `GET /ipfs/<CID>` | Debug fetch failures |

---

## 3. The Three URI Formats

The codebase handles three stages of buffer/image URI encoding. Understanding these is critical to debugging any glTF pipeline issue.

### 3.1 Legacy CID-Prefix Format (uri_to_cid.js — deprecated)

```
data:application/cid;base64,<CID>
```

Used in early Phase 1. The CID itself was base64-encoded in the URI. `convertToDataURI()` in `uri_to_cid.js` handles this. **Only used for backward compatibility; new code should NOT produce this format.**

### 3.2 Standard Monolithic Format (data URIs)

```
data:application/octet-stream;base64,<binary>
data:image/png;base64,<binary>
```

Standard glTF 2.0 with embedded buffers and images as base64 data URIs. This is what cloud generation APIs return and what Babylon.js consumes directly. This is the **input** to `decomposeGlTF()` and the **output** from `composeGlTF()`.

### 3.3 Composite Format (ipfs:// URIs — production)

```
ipfs://<CID>
```

Each buffer and image is stored as an individual IPFS blob and referenced by CID. The composite glTF JSON (`composite.gltf`) is also stored on IPFS and gets its own CID. **Material edits only change the composite JSON CID — buffer and image CIDs stay the same** (IPFS deduplication).

```
Composite glTF JSON (stored as CID_A)
├── buffers[0].uri = "ipfs://bafkreibuf0cid..."  ← binary .bin stored separately
├── images[0].uri  = "ipfs://bafybeimg0cid..."   ← PNG/JPG stored separately
├── images[1].uri  = "ipfs://bafybeimg1cid..."
├── materials[0].pbrMetallicRoughness.baseColorFactor = [0.8, 0.2, 0.1, 1.0]
├── meshes, nodes, scenes, accessors...       ← kept inline in JSON
```

---

## 4. The Compose/Decompose Pipeline

### 4.1 Decompose (Store → IPFS)

```
Standard glTF with data URIs
        │
        ▼
decomposeGlTF(gltf)
        │
        ├── Extract buffers[].uri  → writeToIPFS(binary) → "ipfs://<CID>"
        ├── Extract images[].uri   → writeToIPFS(binary) → "ipfs://<CID>"
        │
        ▼
Composite glTF JSON with ipfs:// URIs
        │
        ▼
decomposeAndStore(gltf) → writeJSONToIPFS(composite) → compositeCid
```

**When does decomposition happen?** During `prepareManifestForWrite()` in `asset-save.js`, at both Save Draft and Publish time. Every monolithic glTF node in the manifest is decomposed once. Already-composite nodes are skipped (`isComposite()` check).

**Critical details in `decomposer.js`:**
- `isComposite(gltf)` checks if any `buffers[].uri` or `images[].uri` starts with `ipfs://`
- `extractDataURI(uri)` handles `data:<mime>;base64,<payload>` — parses the MIME type and decodes base64
- Images use the actual MIME type for the filename extension (e.g., `texture_0.png`)
- Already-composite URIs are passed through unchanged
- External (non-data-URI) images are skipped and kept as-is

### 4.2 Compose (Load → Babylon.js)

```
Composite glTF with ipfs:// URIs
        │
        ▼
composeGlTF(composite)
        │
        ├── For each buffers[].uri:
        │     ipfs://<CID> → fetch from gateway → arrayBuffer → base64 → "data:application/octet-stream;base64,..."
        │
        ├── For each images[].uri:
        │     ipfs://<CID> → fetch from gateway → arrayBuffer → base64 → "data:<mime>;base64,..."
        │
        ▼
Standard glTF with data URIs → Babylon.js ImportMeshAsync(".gltf")
```

**Critical details in `composer.js`:**
- `resolveURI()` handles three URI types: `ipfs://`, legacy CID-prefix, and already-resolved data URIs
- Deep clones the glTF before modifying (no mutation of cached data)
- MIME type detection for images defaults to `image/png` when MIME is unknown
- Gateway URL: `http://127.0.0.1:8080/ipfs/<CID>` — hardcoded in the module constant
- Fetches use `cache: "no-store"` to avoid stale browser cache

### 4.3 When Each Is Called

| Operation | Function | Trigger |
|-----------|----------|---------|
| **Load into scene** | `composeGlTF()` | `scene-graph.js → loadAsset()` when format is `gltf` |
| **First save/publish** | `decomposeGlTF()` + `decomposeAndStore()` | `asset-save.js → decomposeManifestNodes()` |
| **Material edit** | `editCompositeColors()` | `asset-save.js → prepareManifestForWrite()` for decomposed nodes |

---

## 5. Scene Graph Loading (`scene-graph.js`)

### 5.1 `loadAsset(src, parentNode, nodeId)`

The dispatcher that handles both GLB and glTF:

```javascript
const format = detectAssetFormat(src);  // "glb" or "gltf" (default)

if (format === "glb") {
  // 1. getBlobFromRemoteIPFS(cid) — raw binary
  // 2. URL.createObjectURL(blob) — blob URL
  // 3. ImportMeshAsync("", blobUrl, "", scene, null, ".glb")
  // 4. URL.revokeObjectURL(blobUrl)
} else {
  // 1. getFromRemoteIPFS(cid) — parse JSON
  // 2. composeGlTF(gltfJson) — resolve ipfs:// URIs → data URIs
  // 3. JSON.stringify → Blob → blob URL
  // 4. ImportMeshAsync("", blobUrl, "", scene, null, ".gltf")
  // 5. URL.revokeObjectURL(blobUrl)
}
```

On failure, both paths create a placeholder box (`BABYLON.MeshBuilder.CreateBox`) with default wood material.

### 5.2 `loadNode(node, parentNode, depth, resolvingCids)`

Orchestrates loading a single manifest node:

1. Creates a `BABYLON.TransformNode` anchor, parented under the scene hierarchy
2. Applies `node.transform_matrix` via `applyTransformMatrix()`
3. Dispatches to `loadTokenChildNode()` if `node.child_ref` exists
4. Dispatches to `loadAsset()` if `node.source` exists
5. Applies **post_processor** if the loaded meshes have one:
   ```javascript
   if (meshes.length > 0 && pp) {
     applyColor(meshes, pp.color, pp.meshOverrides || null);
     applyScale(meshes, pp.scale);
   }
   ```

### 5.3 `attachMetadata(meshes, nodeId, parentNode, transformNodes)`

After loading, attaches metadata to every mesh and transform node:
- `mesh.metadata.nodeId` — which manifest node this belongs to
- `mesh.metadata.isNodeRoot` — whether this is a root node (parent === anchor)
- Calls `centerImportedAsset()` to shift the asset so its bounding-box center sits on the anchor

---

## 6. The Post-Processor System

Post-processor edits (color, scale, meshOverrides) are runtime overlays stored on manifest nodes. The system handles decomposed and monolithic glTFs differently.

### 6.1 Pending Edits (Inspector)

The inspector accumulates edits in `state.pendingPostProcessorEdits` (a `Map<nodeId, {color, scale, meshOverrides}>`). These are **live preview only** — they modify Babylon.js materials directly but are not persisted until Save.

### 6.2 Save Flow: Decomposed vs Monolithic

In `asset-save.js → prepareManifestForWrite()`:

**For decomposed glTF nodes** (`node.source.path === "composite.gltf"`):
- Colors **and mesh overrides** are **baked directly into the composite glTF JSON** via `editCompositeColors()`
- A new composite CID is generated (only the JSON changes — buffers/images stay at their original CIDs)
- `node.source.cid` is updated to the new composite CID
- **Scale** still goes to `node.post_processor` (it's a geometry transform, not a material property)
- If only scale was changed, only `post_processor.scale` is set
- Empty `post_processor` objects are cleaned up (deleted)

**For monolithic glTF/GLB nodes**:
- Everything (color, scale, meshOverrides) is stored as `node.post_processor`
- No baking occurs — these are pure runtime overlays applied during `loadNode()`

### 6.3 Runtime Color Application

`time-travel.js → applyColor(meshes, colorHex, meshOverrides)`:

```javascript
for each mesh:
  effectiveColor = meshOverrides[mesh.name]?.color || colorHex (default)
  
  if mesh.material:
    if mesh.material.diffuseColor:      // StandardMaterial
      mesh.material.diffuseColor = effectiveColor
    if mesh.material.albedoColor:       // PBRMaterial
      mesh.material.albedoColor = effectiveColor
    if mesh.material.getSubMeshMaterials:  // MultiMaterial
      // recurse into sub-materials
  // Recurse into child meshes
```

### 6.4 Mesh Overrides (Per-Component Colors)

When a glTF import produces multiple named sub-meshes (e.g., "flowercenter", "Sphere"), the inspector shows a "Components" section. Each sub-mesh gets its own color swatch, stored as:

```javascript
node.post_processor.meshOverrides = {
  "flowercenter": { color: "#FF5733" },
  "Sphere": { color: "#33FF57" }
}
```

- `getNodeSubMeshes(nodeId)` in scene-graph.js enumerates distinct sub-mesh names
- `buildComponentList(nodeId)` in parametric-preview.js renders the color pickers
- `readMeshOverrides()` collects values from DOM inputs
- On save for decomposed nodes: `editCompositeColors()` applies overrides by finding the material via `findMaterialByMeshName()`

---

## 7. Material Editing (`material-editor.js`)

### 7.1 Supported Edits

| Property | Function | glTF field |
|----------|----------|------------|
| Base color | `setBaseColorFactor(mat, "#RRGGBB")` | `materials[].pbrMetallicRoughness.baseColorFactor` |
| Metallic | `setMetallicFactor(mat, 0.5)` | `materials[].pbrMetallicRoughness.metallicFactor` |
| Roughness | `setRoughnessFactor(mat, 0.8)` | `materials[].pbrMetallicRoughness.roughnessFactor` |
| Emissive | `setEmissiveFactor(mat, r, g, b)` | `materials[].emissiveFactor` |
| Alpha mode | `setAlphaMode(mat, "BLEND", 0.5)` | `materials[].alphaMode`, `alphaCutoff` |
| Double-sided | `setDoubleSided(mat, true)` | `materials[].doubleSided` |

### 7.2 Material Lookup by Mesh Name

`findMaterialByMeshName(composite, meshName)` walks `composite.meshes[]` to find a mesh with the given name, then follows its first primitive's `material` index to the materials array. Returns `{ material, meshIndex, primitiveIndex }` or `null`.

### 7.3 Commit Model

```javascript
// Full round-trip for decomposed nodes:
const result = await editCompositeColors(compositeCid, meshOverrides, defaultColor);
// result = { compositeCid: "QmNewCid...", modified: 3, skipped: 0 }
```

Only the composite JSON CID changes. Buffers and images are untouched — IPFS deduplicates automatically.

---

## 8. Save & Publish Flow (GLTF-specific)

`asset-save.js → prepareManifestForWrite()` is the single function that handles all GLTF format concerns during save/publish. The order matters:

```
1. Apply post-processor edits
   ├── Decomposed nodes: bake colors into composite glTF (editCompositeColors)
   └── Monolithic nodes: write post_processor object
   
2. Decompose monolithic glTF nodes
   └── decomposeManifestNodes() — one-time conversion to composite format
   
3. Save to IPFS
   └── saveManifest(manifest) → POST /api/v1/save → backend ipfs.add()
```

Key rules:
- Decomposition happens on **both Save Draft and Publish**
- Already-composite nodes are skipped (`isComposite()` check)
- `decomposeManifestNodes()` fetches each node's glTF from IPFS, checks if it's valid glTF (`gltf.asset.version`), skips if already composite, decomposes and updates `node.source.cid` + `node.source.path = "composite.gltf"`
- GLB nodes are explicitly skipped in decomposition (`node.source.format === "glb"`)

---

## 9. Format Detection

`transforms.js → detectAssetFormat(src)`:
- If `src.format` exists: use it (lowercased) — returns `"glb"` or `"gltf"`
- If `src` is a string (CID): defaults to `"gltf"`
- The scene graph's `loadAsset()` switches between blob (GLB) and JSON (glTF) paths based on this

---

## 11. Golden Rules

1. **GLB is never decomposed.** GLB assets load as raw binary blobs. All edits go through `post_processor` runtime overlays.

2. **glTF is converted to composite on first save.** This is a one-way door — once decomposed, a glTF node stays composite forever.

3. **Material edits = new composite CID.** Changing a color only changes the composite JSON CID. Buffer and image CIDs stay the same. This is the core efficiency of the composite format.

4. **Scale is always post_processor.** Even for decomposed nodes, scale is stored as `node.post_processor.scale` because it's a geometry transform applied to the Babylon.js transform node, not a glTF material property.

5. **The composer deep-clones.** `composeGlTF()` does `JSON.parse(JSON.stringify(gltfJson))` before modifying. No mutation of cached/managed glTF objects.

6. **All IPFS reads go through the gateway.** The browser uses `http://127.0.0.1:8080/ipfs/<CID>`. The backend uses the IPFS HTTP client at `http://127.0.0.1:5001`. Never mix them.

7. **`uri_to_cid.js` is legacy.** New code should use the composer/decomposer. The legacy module only handles buffer URIs (not images) and uses the now-deprecated CID-prefix format.

8. **Token child nodes have no glTF source.** Nodes with `child_ref` skip `loadAsset()` entirely. They never go through compose/decompose.

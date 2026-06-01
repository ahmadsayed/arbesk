# Phase 2: Parametric Versions & Babylon.js Rendering Engine

> **Source System**: SukaVerse (`/home/ahmedh/projects/arbesk/suka-forever`)  
> **Target System**: Arbesk (`/home/ahmedh/projects/arbesk/arabesk`)  
> **Scope**: Frontend Babylon.js engine, scene-graph parser, time-travel versioning, parametric preview  
> **Constraint**: Reuse SukaVerse rendering and IPFS reader patterns verbatim where possible; adapt only where Arbesk's fractal manifest and parametric history diverge.

---

## 1. Scope & Objective

Phase 1 delivered the backend API, private IPFS pipeline, mock adapters, and fractal manifest storage. Phase 2 makes those manifests **visible and interactive** in the browser.

### Already Delivered (Phase 1 Carry-Over)

| File | Status | Role in Phase 2 |
|------|--------|-----------------|
| `src/api/parametric-version.js` | ✅ Implemented | Endpoint that Phase 2 frontend calls when user saves color/scale edits |
| `src/api/generate-asset-node.js` | ✅ Implemented | Endpoint that returns `newManifestCid` after generation |
| `frontend/src/js/gltf/uri_to_cid.js` | ✅ Copied | Backend storage format spec; **render reverse-path** must use `convertToDataURI()` |
| `frontend/src/js/ipfs/remote-ipfs.js` | ✅ Adapted | Gateway-only IPFS reader (`127.0.0.1:8080`) used by engine to fetch manifests and buffer CIDs |

### Phase 2 New Deliverables

| File | Purpose |
|------|---------|
| `frontend/src/js/engine/scene-graph.js` | Recursive manifest → Babylon.js scene parser, mesh loader, transform applier, lazy child loader |
| `frontend/src/js/engine/time-travel.js` | Version history scrubber: swaps mesh geometry or applies parametric overlays per node without re-rendering neighbors |
| `frontend/src/js/engine/parametric-preview.js` | Live color/scale preview before commit; wires Node Inspector inputs to Babylon materials and meshes |
| `frontend/src/pug/studio.pug` | Minimal dual-panel layout: Babylon canvas + Node Inspector sidebar |
| `frontend/src/js/blockchain/wallet.js` | Web3.js + Web3Modal connection for generation payments (Phase 3 contract will consume this) |

---

## 2. Reusable SukaVerse Files — Frontend

### 2.1 glTF Buffer URI Translation (CID ↔ base64)

**Source**: `suka-forever/frontend/src/js/gltf/uri_to_cid.js`  
**Target**: `arabesk/frontend/src/js/gltf/uri_to_cid.js` (already exists from Phase 1)

Phase 2 uses only the **render-path** function:

```javascript
async function convertToDataURI(gltf) {
    let cloned = _.cloneDeep(gltf);
    const base64_prefix = "data:application/octet-stream;base64,";
    const cid_prefix = "data:application/cid;base64,";
    for (const buffer of cloned.buffers) {
        const current_uri = buffer.uri;
        if (current_uri.startsWith("data:application/cid;base64,")) {
            const cid_uri = current_uri.replace(cid_prefix, "");
            // Resolve CID back to base64 via Remote IPFS gateway only
            const base64 = await getBase64FromRemoteIPFS(cid_uri);
            buffer.uri = base64_prefix + base64;
        }
    }
    return cloned;
}
```

**Critical for Phase 2**: Before passing any manifest `gltf_source` to Babylon.js `SceneLoader`, the engine must:
1. Fetch the glTF JSON from the IPFS gateway (`127.0.0.1:8080`).
2. Run `convertToDataURI()` to resolve CID-referenced buffers back to inline base64.
3. Stringify the result and feed it to `BABYLON.SceneLoader.ImportMeshAsync()` via a `data:` URI.

If the manifest stores a raw GLB (Phase 1 pragmatic path), skip CID resolution and load the GLB binary directly from `ipfs://{cid}` via the gateway.

---

### 2.2 Frontend IPFS Reader (Gateway-Only)

**Source**: `suka-forever/frontend/src/js/ipfs/remote-ipfs.js`  
**Target**: `arabesk/frontend/src/js/ipfs/remote-ipfs.js` (already exists from Phase 1)

Phase 2 engine calls these existing helpers:

```javascript
async function getFromRemoteIPFS(cid) {
    const url = `http://127.0.0.1:8080/ipfs/${cid}`;
    const json = await (await fetch(url)).json();
    return json;
}

async function getBase64FromRemoteIPFS(cid) {
    const url = `http://127.0.0.1:8080/ipfs/${cid}`;
    const text = await (await fetch(url)).text();
    return text;
}
```

**Rule**: The engine never writes to IPFS. Writes go through `POST /api/parametric-version` and `POST /api/generate-asset-node`.

---

## 3. Engine Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     STUDIO FRONTEND                          │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │  Babylon.js     │  │  Node Inspector Sidebar         │   │
│  │  Viewport       │  │  ├── Color picker              │   │
│  │  (Canvas)       │  │  ├── Scale sliders (X,Y,Z)     │   │
│  └────────┬────────┘  │  └── Save Parametric Version   │   │
│           │           └─────────────────────────────────┘   │
│           │                           ▲                     │
│           │          parametric-preview.js                  │
│           │           (live material.scaling edits)         │
│           ▼                           │                     │
│  ┌────────────────────────────────────┴──────────────┐     │
│  │           scene-graph.js (parser + loader)         │     │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │     │
│  │  │ Load Manifest│→ │ Resolve CIDs │→ │ Import   │ │     │
│  │  │ from IPFS    │  │ to base64    │  │ to Scene │ │     │
│  │  └──────────────┘  └──────────────┘  └──────────┘ │     │
│  │           ▲                                        │     │
│  │           └────────── time-travel.js               │     │
│  │              (version swap / parametric apply)     │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. New Files to Create

### 4.1 Scene Graph Parser
**File**: `frontend/src/js/engine/scene-graph.js`

Responsibilities:
1. Initialize Babylon.js engine + scene + camera + lighting.
2. Fetch manifest JSON from private IPFS gateway via `getFromRemoteIPFS(manifestCid)`.
3. Iterate `manifest.nodes[]`:
   - For each node, fetch `gltf_source` (IPFS CID).
   - If source is CID-referenced glTF: call `convertToDataURI()` → `BABYLON.SceneLoader.ImportMeshAsync()`.
   - If source is raw GLB: fetch binary from gateway → `BABYLON.SceneLoader.ImportMeshAsync()` with blob URL.
   - Apply `transform_matrix` (4×4 column-major) via ` BABYLON.Matrix.FromValues(...)` → `mesh.setPivotMatrix` or `mesh.transformNode`.
   - Store a reference `mesh.metadata = { nodeId, history, childManifestId }` for later lookup.
4. If `child_manifest_id` exists, create an invisible anchor `TransformNode` at the parent's origin but **do not fetch the child manifest yet** (lazy loading).
5. Dispatch `scenegraph:ready` event when root nodes are loaded.

```javascript
// Pseudocode for transform application
const matrix = BABYLON.Matrix.FromValues(...node.transform_matrix);
mesh.position = new BABYLON.Vector3(matrix.m[12], matrix.m[13], matrix.m[14]);
// Decompose rotation/scale from matrix if needed, or assign matrix directly to mesh.worldMatrix
```

**Lazy Loading Rule (Golden Rule from ARCHITECTURE.md)**:
- Child manifests are never fetched until:
  - User double-clicks the parent node's bounding box, OR
  - Camera target distance to parent origin drops below a threshold (e.g., 2× parent bounding-sphere radius).
- On trigger: call `loadManifest(node.child_manifest_id, parentAnchorNode)` recursively.

---

### 4.2 Time-Travel Engine
**File**: `frontend/src/js/engine/time-travel.js`

Responsibilities:
1. Maintain a map `nodeMeshes = { nodeId: { mesh, currentVersionIndex } }`.
2. Expose `updateNodeToVersion(nodeId, targetVersionIndex)`:
   - Look up the node's `history` array.
   - Find `entry = history[targetVersionIndex]`.
   - If `entry.type === "generation"`:
     - Fetch the GLB/glTF from `entry.src` (IPFS CID).
     - Dispose old mesh geometry (keep TransformNode if possible to preserve world position).
     - Import new geometry and parent it to the same TransformNode.
   - If `entry.type === "parametric"`:
     - Do **not** fetch new geometry.
     - Apply `entry.params.color` to `mesh.material.diffuseColor` (or `albedoColor` for PBR).
     - Apply `entry.params.scale` to `mesh.scaling`.
   - Ensure parent and sibling nodes are completely unaffected.
   - Dispatch custom event `'node:versionChanged'` with detail `{ nodeId, versionIndex, entry }`.
3. Expose `getNodeHistory(nodeId) → history[]` for UI timeline binding.

**Temporal Isolation Guarantee**:
> A version swap mutates only the target node's mesh/material/scaling. No global scene re-render. No parent re-computation. No sibling redraw.

---

### 4.3 Parametric Preview
**File**: `frontend/src/js/engine/parametric-preview.js`

Responsibilities:
1. Bind to Node Inspector DOM inputs:
   - `<input type="color">` → live update `mesh.material.diffuseColor`
   - `<input type="range">` (X, Y, Z) → live update `mesh.scaling`
2. Track "draft" state separately from committed history so the user can cancel.
3. On **"Save Parametric Version"** click:
   - Gather current values from inputs.
   - `POST /api/parametric-version` with `{ nodeId, prevManifestCid: activeManifestId, color, scale }`.
   - On response: update `activeManifestId = newManifestCid`, append the returned `historyEntry` to local `node.history`, reset draft state.
4. On **Cancel**: revert mesh to last committed version (call `updateNodeToVersion(nodeId, lastCommittedIndex)`).

**Why no Web3 call?** Parametric versions are free per the specification.

---

### 4.4 Wallet Connection (Generation Trigger)
**File**: `frontend/src/js/blockchain/wallet.js`

Responsibilities:
1. Initialize Web3Modal (or equivalent) with Filecoin FEVM network config:
   - Local: `http://127.0.0.1:8545`, chainId `31337` (Hardhat)
   - Calibration: `https://api.calibration.node.glif.io/rpc/v1`, chainId `314159`
   - Mainnet: `https://api.node.glif.io/rpc/v1`, chainId `314`
2. Connect wallet → store `window.walletAddress`.
3. For **generation** (not parametric edits):
   - Encode contract call `payForGeneration(nodeId, prompt)`.
   - Request signature via MetaMask/Rabby.
   - Poll for receipt (`web3.eth.getTransactionReceipt`).
   - On confirmation: emit `wallet:generationPaid` event with `{ txHash, nodeId, prompt }`.
   - Studio then calls `POST /api/generate-asset-node` with the `txHash`.
4. For **parametric edits**: do nothing. No wallet flow.

**Note**: The smart contract `ArbeskPayGo.sol` will be authored in Phase 3. This file prepares the Web3 call interface that Phase 3 will satisfy.

---

### 4.5 Studio Layout Shell
**File**: `frontend/src/pug/studio.pug`

Minimal structure so the engine has DOM nodes to attach to.

```pug
doctype html
html
  head
    title Arbesk Studio
    link(rel="stylesheet", href="/css/studio.css")
    script(src="https://cdn.babylonjs.com/babylon.js")
    script(src="https://cdn.jsdelivr.net/npm/web3@latest/dist/web3.min.js")
    script(src="https://unpkg.com/@walletconnect/web3modal")
  body
    #app
      #viewport
        canvas#renderCanvas
      #inspector(hidden)
        h3 Node Inspector
        label Color
          input#nodeColor(type="color")
        label Scale X
          input#nodeScaleX(type="range", min="0.1", max="5", step="0.1")
        label Scale Y
          input#nodeScaleY(type="range", min="0.1", max="5", step="0.1")
        label Scale Z
          input#nodeScaleZ(type="range", min="0.1", max="5", step="0.1")
        button#saveParametric Save Parametric Version
        button#cancelParametric Cancel
      #timeline(hidden)
        input#versionSlider(type="range", min="0", max="0", step="1")
        span#versionLabel v1
    script(type="module", src="/js/engine/scene-graph.js")
    script(type="module", src="/js/engine/time-travel.js")
    script(type="module", src="/js/engine/parametric-preview.js")
    script(type="module", src="/js/blockchain/wallet.js")
```

**Styling**: `frontend/src/scss/studio.scss` — Bootstrap 5 grid with viewport as `col-9` and inspector as `col-3` overlay.

---

## 5. Data Flow: Render Lifecycle

```
User opens Studio
    │
    ▼
┌─────────────────────────────┐
│  1. Fetch root manifest     │
│     getFromRemoteIPFS(cid)  │
│     → manifest JSON         │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  2. Parse manifest.nodes[]  │
│     For each node:          │
│     a. Fetch gltf_source    │
│        from gateway         │
│     b. If CID-referenced    │
│        glTF → convertToDataURI
│     c. ImportMeshAsync()    │
│     d. Apply transform_matrix
│     e. Store mesh.metadata  │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  3. Lazy anchors created    │
│     for child_manifest_id   │
│     (no fetch yet)          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  4. Dispatch scenegraph:ready
│     Studio shows timeline   │
│     bound to history.length │
└─────────────────────────────┘
```

---

## 6. Data Flow: Parametric Edit Lifecycle

```
User clicks mesh in viewport
    │
    ▼
┌─────────────────────────────┐
│  1. Studio reads            │
│     mesh.metadata.nodeId    │
│     → opens Node Inspector  │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  2. Live Preview            │
│     color input →           │
│     material.diffuseColor   │
│     scale input →           │
│     mesh.scaling            │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  3. User clicks Save        │
│     POST /api/parametric-version
│     { nodeId, prevManifestCid,
│       color, scale }         │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  4. Backend appends history │
│     → returns newManifestCid│
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  5. Studio updates          │
│     activeManifestId        │
│     timeline.max += 1       │
│     reset draft state       │
└─────────────────────────────┘
```

---

## 7. Data Flow: Time-Travel Lifecycle

```
User drags timeline slider for selected node
    │
    ▼
┌─────────────────────────────┐
│  1. Slider oninput →        │
│     updateNodeToVersion(    │
│       nodeId,               │
│       slider.value)         │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  2. Lookup history[index]   │
│     If type == generation:  │
│        fetch GLB/glTF       │
│        swap mesh geometry   │
│     If type == parametric:  │
│        apply color + scale  │
│        (no network fetch)   │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  3. Dispatch                │
│     node:versionChanged     │
│     (UI updates badges)     │
└─────────────────────────────┘
```

---

## 8. glTF vs. GLB Decision Matrix

Phase 1 stored assets either as raw GLB (pragmatic) or CID-referenced glTF (architecturally correct). Phase 2 engine must handle both.

| Stored Format | Detect | Render Path |
|---------------|--------|-------------|
| Raw GLB | `gltf_source` ends with implicit `.glb` or gateway returns binary | Fetch blob → `URL.createObjectURL(blob)` → `SceneLoader.ImportMeshAsync()` |
| CID-referenced glTF | `gltf_source` is a CID that returns JSON with `data:application/cid;base64,...` URIs | `getFromRemoteIPFS(cid)` → `convertToDataURI()` → stringify → `data:application/json;base64,...` → `SceneLoader.ImportMeshAsync()` |
| Inline glTF (base64) | `buffers[].uri` starts with `data:application/octet-stream;base64` | Direct stringify → data URI load |

**Recommendation for Phase 2 implementation**: Support raw GLB first (matches current Phase 1 backend output), then add CID-referenced glTF path once the backend switches to full buffer-deduplication storage.

---

## 9. Global State & Event Bus

The engine, inspector, and timeline communicate via `window` globals and `CustomEvent` on `document`:

```javascript
// Globals (set by studio bootstrap or wallet.js)
window.activeManifestId = null;   // current root manifest CID
window.selectedNodeId = null;     // node clicked in viewport
window.walletAddress = null;      // connected FEVM address

// Events dispatched by engine
document.dispatchEvent(new CustomEvent('scenegraph:ready', { detail: { manifest } }));
document.dispatchEvent(new CustomEvent('node:selected', { detail: { nodeId, mesh } }));
document.dispatchEvent(new CustomEvent('node:versionChanged', { detail: { nodeId, versionIndex, entry } }));

// Events consumed by engine
document.addEventListener('parametric:save', (e) => { /* POST to /api/parametric-version */ });
document.addEventListener('wallet:generationPaid', (e) => { /* POST to /api/generate-asset-node */ });
```

---

## 10. Testing Strategy for Phase 2

No automated E2E suite exists yet. Phase 2 testing is manual/browser-based with the following checklist:

### 10.1 Scene Graph Load
1. Start Docker Compose (`docker-compose up -d`).
2. Run backend (`npm start`).
3. Use a test script or curl to create a manifest via `POST /api/generate-asset-node`.
4. Open `studio.pug` (served from `frontend/dist` after build) with `?manifest=<cid>`.
5. **Expect**: Mesh appears in canvas at correct position (default origin if transform is identity).

### 10.2 Parametric Preview
1. Click the mesh → Node Inspector appears.
2. Change color picker → mesh color updates in < 50ms.
3. Change scale sliders → mesh scales in < 50ms.
4. Click Cancel → mesh reverts to pre-edit color/scale.

### 10.3 Parametric Save
1. Edit color + scale.
2. Click Save → network tab shows `POST /api/parametric-version` returning 200.
3. Timeline slider max increases by 1.
4. Drag slider to newest version → mesh shows saved color/scale.
5. Drag slider back to version 1 → mesh shows original generation state.

### 10.4 Time-Travel (Generation Swap)
1. Generate a second asset for the same node (different prompt).
2. Timeline should show 2 generation versions.
3. Drag between v1 and v2 → mesh geometry swaps (not just color/scale).
4. Confirm parent/sibling nodes do not flicker or reload.

### 10.5 Lazy Loading
1. Create a manifest where `node_A.child_manifest_id = manifest_B_cid`.
2. Load root manifest → only `node_A` mesh visible.
3. Double-click `node_A` bounding box → `manifest_B` fetches and renders nested children.
4. Network tab should show a second gateway fetch for `manifest_B` CID.

---

## 11. Files Summary Table

| SukaVerse Path | Arbesk Path | Action | Notes |
|---|---|---|---|
| `frontend/src/js/gltf/uri_to_cid.js` | `frontend/src/js/gltf/uri_to_cid.js` | **Reuse** (already exists) | Phase 2 uses `convertToDataURI()` render path |
| `frontend/src/js/ipfs/remote-ipfs.js` | `frontend/src/js/ipfs/remote-ipfs.js` | **Reuse** (already exists) | Gateway at `127.0.0.1:8080` |
| *new* | `frontend/src/js/engine/scene-graph.js` | **Create** | Manifest → Babylon scene parser |
| *new* | `frontend/src/js/engine/time-travel.js` | **Create** | Version swap / parametric apply per node |
| *new* | `frontend/src/js/engine/parametric-preview.js` | **Create** | Live preview + save POST wiring |
| *new* | `frontend/src/js/blockchain/wallet.js` | **Create** | Web3Modal + generation payment trigger |
| *new* | `frontend/src/pug/studio.pug` | **Create** | Viewport canvas + Node Inspector shell |
| *new* | `frontend/src/scss/studio.scss` | **Create** | Bootstrap 5 dual-panel layout styles |

---

## 12. Phase 2 → Phase 3 Handoff

Phase 3 will author `ArbeskPayGo.sol` and deploy it via the Hardhat container. The handoff contract is:

1. `wallet.js` must expose `payForGeneration(nodeId, prompt)` that encodes the contract ABI call.
2. The ABI and contract address will be injected at build time or fetched from `GET /api/contract_address` (already exists in `src/api/index.js`).
3. `studio.pug` must have a "Generate" button that triggers the Web3 flow before calling `POST /api/generate-asset-node`.
4. Phase 2 leaves a stub or TODO comment in `wallet.js` where the contract ABI will be plugged in.

---

*End of Phase 2 Specification.*

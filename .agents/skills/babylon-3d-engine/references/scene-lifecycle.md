# Scene Lifecycle — Babylon.js Engine & Scene

## Engine Initialization

The Babylon.js engine is created once per page load in `initEngine()`:

```js
state.engine = new BABYLON.Engine(canvas, true, {
  preserveDrawingBuffer: true,  // required for captureAssetThumbnail
  stencil: true,                 // required for HighlightLayer
});
```

**Critical options:**
- `preserveDrawingBuffer: true` — enables `canvas.toDataURL()` for thumbnail capture
- `stencil: true` — HighlightLayer uses stencil buffer for selection glow

## Scene Setup

A single `BABYLON.Scene` is created from the engine:

```js
state.scene = new BABYLON.Scene(state.engine);
state.scene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // transparent for CSS background
```

## Resize Handling

The engine must be resized when the container changes size:

```js
state.resizeEngineHandler = () => state.engine.resize();
window.addEventListener("resize", state.resizeEngineHandler);
```

**Cleanup on destroy:** Remove the listener to prevent leaks:
```js
window.removeEventListener("resize", state.resizeEngineHandler);
```

## Clear Scene (`clearScene()`)

`clearScene()` in `cleanup.js` removes all scene content while preserving viewport chrome:

```js
function clearScene() {
  // 1. Deselect current node
  deselectAll();

  // 2. Dispose all meshes that are NOT viewport chrome
  for (const mesh of state.scene.meshes) {
    if (!mesh.metadata?.isViewportChrome) {
      safeDisposeMesh(mesh);
    }
  }

  // 3. Dispose all transform nodes that are NOT viewport chrome
  for (const node of state.scene.transformNodes) {
    if (!node.metadata?.isViewportChrome) {
      safeDisposeNode(node);
    }
  }

  // 4. Reset state maps
  state.nodeAnchors.clear();
  state.nodeMeshes.clear();
  state.pendingChildRefs = [];

  // 5. Clear highlight layer
  state.highlightLayer.removeAllMeshes();

  // 6. Dispatch event for UI reset
  document.dispatchEvent(new CustomEvent("scene:cleared"));
}
```

## Viewport Chrome Preservation

Any mesh that should survive `clearScene()` must be tagged:

```js
grid.metadata = { isViewportChrome: true };
gizmoRoot.metadata = { isViewportChrome: true };
```

**Chrome elements in Arbesk:**
- Ground grid (40×40 wireframe, α 0.3)
- Viewport gizmo (2D X/Y/Z orientation overlay)

## Engine Disposal

When leaving the studio page or fully resetting:

```js
state.engine.dispose();
state.engine = null;
state.scene = null;
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Grid disappears on asset switch | Not tagged with `isViewportChrome` | Add metadata before adding to scene |
| Canvas stretches instead of resizing | Missing `engine.resize()` call | Call on window resize and after sidebar toggle |
| HighlightLayer stops working | Engine recreated without `stencil: true` | Pass `stencil: true` in engine options |
| Thumbnail capture is black | `preserveDrawingBuffer: false` | Set to `true` in engine options |
| Resize listener leaks | Never removed on cleanup | Store reference and remove in destroy |

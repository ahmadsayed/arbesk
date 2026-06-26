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

**Critical rule:** do not rely only on `window.resize` or `ResizeObserver` callbacks to resize the engine. Those handlers can race with the render loop: the canvas CSS size may change, a frame renders, and only afterwards does the handler call `engine.resize()`. That frame is drawn with the old camera projection matrix stretched to the new canvas size.

The safe pattern is to resize the engine **inside `runRenderLoop`, immediately before `scene.render()`**:

```js
state.engine.runRenderLoop(() => {
  state.engine.resize();
  updateOrthoFrustumOnResize();
  state.scene.render();
});
```

Why this works:
- `engine.resize()` sets the WebGL drawing buffer to the current CSS size and updates the camera aspect ratio.
- `updateOrthoFrustumOnResize()` rebalances `orthoLeft/Right/Top/Bottom` when the camera is in orthographic mode.
- `scene.render()` then uses a projection matrix that matches the canvas exactly.

Keep the window/ResizeObserver handlers as well so non-render-loop code sees the updated size immediately:

```js
function resizeEngine() {
  if (!state.engine || !state.scene) return;
  state.engine.resize();
  updateOrthoFrustumOnResize();
}

state.resizeEngineHandler = resizeEngine;
window.addEventListener("resize", resizeEngine);

state.resizeObserverInstance = new ResizeObserver(() => resizeEngine());
state.resizeObserverInstance.observe(canvas);
```

**Cleanup on destroy:** Remove both the observer and the window listener to prevent leaks:
```js
if (state.resizeObserverInstance) {
  state.resizeObserverInstance.disconnect();
  state.resizeObserverInstance = null;
}
if (state.resizeEngineHandler) {
  window.removeEventListener("resize", state.resizeEngineHandler);
  state.resizeEngineHandler = null;
}
```

**Anti-patterns to avoid:**
- ❌ Throttling the render loop to 60 FPS — delays the corrected frame after a resize.
- ❌ Only `ResizeObserver` without a window listener — misses some window-resize cases.
- ❌ Rendering synchronously inside the resize handler — races with the render loop and can still show one stretched frame.
- ❌ Calling `engine.resize()` only in event handlers — leaves a one-frame race during CSS transitions.

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
| Canvas stretches instead of resizing | `engine.resize()` only in event handlers or throttled loop | Resize inside `runRenderLoop` before every `scene.render()` |
| Model stretches during sidebar collapse | CSS transition changes canvas before event handler updates camera | Resize inside `runRenderLoop` before every `scene.render()` |
| HighlightLayer stops working | Engine recreated without `stencil: true` | Pass `stencil: true` in engine options |
| Thumbnail capture is black | `preserveDrawingBuffer: false` | Set to `true` in engine options |
| Resize listener leaks | Never removed on cleanup | Store reference and remove in destroy |

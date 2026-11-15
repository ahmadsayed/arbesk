---
name: babylon-3d-engine
description: Use for 3D viewport/engine problems in Arbesk Studio — "scene not rendering", "viewport is blank", "mesh disappeared", "tab crashes after load", camera wrong or clipping, black meshes, memory leaks, "clearScene breaks the grid", or scene lifecycle/disposal questions.
---

# Babylon.js Engine — Arbesk Studio

Code: `frontend/src/js/engine/` (`scene-graph.ts`, `scene-loader.ts`, `scene-camera.ts`, `scene-picking.ts`, `cleanup.ts`). `BABYLON` is a CDN global; never import it.

**Order of work:** official docs, API reference and Playground first, then the Babylon forum, then `git log` if it worked before a refactor (restore, don't add). Write custom engine code only after those, and say in a comment why the built-in cannot do it.

## Disposal (the crash-after-a-few-loads bugs)

- `dispose(a, b)` means different things per class. `mesh.dispose(false, true)` = recurse and free the mesh's materials and textures: correct for imported meshes, whose materials are unique. `material.dispose(false, true)` = keep textures but destroy shared shader effects: never call it.
- Plain `mesh.dispose()` leaks the import's materials and textures.
- Meshes using the shared `state.defaultWoodMaterial` get plain `mesh.dispose()`. Capture the reference first and dispose the material once at the end (`cleanup.ts`).
- Never loop over `scene.materials` or `scene.textures` to clean up; the render pipeline owns some of them.
- `isDisposed` is a method on meshes and a getter elsewhere; on textures calling it throws. Wrap `dispose()` in try/catch instead of checking.
- Revoke a blob URL only after `ImportMeshAsync` resolves.

## Scene rules

- Anything that must survive `clearScene()` (grid, gizmos) needs `metadata.isViewportChrome = true`.
- Engine options: `stencil: true` (HighlightLayer) and `preserveDrawingBuffer: true` (thumbnails).
- Call `engine.resize()` inside the render loop, right before `scene.render()`. A resize done only in an event handler renders one stretched frame.
- Every imported mesh carries `metadata.nodeId`; picking walks up the parent chain to find it.

## Camera

- **Perspective only.** Ortho views and the `1/3/7` snaps were removed: Babylon's ortho path has no working wheel zoom and the custom code around it kept clipping. Do not bring them back.
- Clip planes and zoom limits come from the model size (`updateCameraRangeForScene()`), with a fixed 1:1e5 near/far ratio. Fixed values fail: a small `minZ` with a huge `maxZ` z-fights, a large `minZ` slices small models.
- Frame by the largest dimension, not the 3D diagonal, and animate (about 300 ms); never snap.
- Babylon's pan step is a constant world distance per pixel, so `_updatePanSensibility()` rescales it every frame.
- A restored camera pose is re-applied for 90 frames (`camera-persistence.ts`) to beat Babylon's smooth-transition drift. Pointer or wheel input cancels it.

## Child worlds (`child_ref` nodes)

Each one has two anchors: an outer anchor holding the parent's `transform_matrix`, and inside it a child anchor (`metadata.childRef`) holding the child's own scene.

- `state.nodeAnchors.get(nodeId)` must return the **outer** anchor. `loadTokenChildNode()` sets it only if absent. Pointing it at the child anchor saves a local offset, and the child jumps on reload.
- The pick walk must not stop at the first `nodeId`: meshes inside a child carry the child's internal ids. Keep walking to the `childRef` boundary and use the outer anchor's id (`scene-picking.ts`).
- The outliner emits `OUTLINER_NODE_SELECTED`, not `NODE_SELECTED`. Without the bridge to `selectNodeById()` the gizmo never attaches.

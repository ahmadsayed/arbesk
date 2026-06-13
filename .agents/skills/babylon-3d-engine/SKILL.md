---
name: babylon-3d-engine
description: Babylon.js 3D engine expertise for the Arbesk project. Covers scene lifecycle, asset loading (GLTF/GLB), camera setup, memory management, disposal patterns, and common rendering issues. Use whenever working on the 3D viewport or engine — "scene not rendering", "viewport is blank", "mesh disappeared", "browser tab crashes after load", "camera is wrong or clipping", "black mesh", "memory leak", "clearScene breaks the grid", "GLTF loads but nothing shows", "orthographic view is broken", or any 3D engine behavior in the Arbesk Studio. When in doubt about a viewport or rendering problem, invoke this skill.
---

# Babylon.js 3D Engine — Arbesk Studio

Use this skill when working with Babylon.js in the Arbesk project: scene lifecycle, asset loading, camera behavior, memory management, rendering issues, or viewport interactions.

## Quick Decision

| Question | Action |
|----------|--------|
| Browser tab crashes after repeated scene loads? | GPU memory leak. Check disposal patterns. See [→ Memory Leaks](./references/memory-leaks.md) |
| Mesh loads but is completely black? | Missing light, missing material, or normals issue. See [→ Asset Loading](./references/asset-loading.md) |
| Camera view is wrong / too zoomed / clippping? | Check ortho corner values or framing bounds. See [→ Camera & Views](./references/camera-and-views.md) |
| `clearScene()` removes the grid/gizmo? | Missing `metadata.isViewportChrome = true`. See [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| Resize breaks canvas aspect ratio? | Engine resize handler missing or leaking. See [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| GLTF fails to load (no error, just blank)? | Check blob URL lifecycle, CORS, or invalid JSON. See [→ Asset Loading](./references/asset-loading.md) |

## Key Rules

1. **`mesh.dispose(false, true)` is correct for unique import materials** — cascades to material. But `material.dispose(false, true)` destroys shared shaders.
2. **Never iterate `scene.materials` for batch cleanup** — dispose per-mesh during normal teardown.
3. **Always wrap `dispose()` in try-catch** — `isDisposed` is inconsistent across Babylon.js classes.
4. **Viewport chrome must have `metadata.isViewportChrome = true`** — `clearScene()` preserves it.
5. **Engine needs `stencil: true`** for HighlightLayer. Needs `preserveDrawingBuffer: true` for thumbnail capture.
6. **Ortho mode: set `orthoLeft/Right/Top/Bottom` explicitly** — do not rely on `radius`.
7. **GLB loads as blob URL, glTF loads as composed JSON blob URL** — both use `ImportMeshAsync` then `revokeObjectURL`.
8. **Attach `metadata.nodeId` to every imported mesh** — pointer observables walk the parent chain to identify selections.
9. **Camera framing uses 300ms animation** — never snap instantly.
10. **Shared `defaultWoodMaterial` must be captured before mesh disposal** — dispose it once at the end, not per-mesh.

## File Map

| File | Role | Details |
|------|------|---------|
| `frontend/src/js/engine/scene-graph.js` | Engine init, camera, selection, keyboard, asset loading | [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| `frontend/src/js/engine/cleanup.js` | `clearScene()` with chrome preservation | [→ Memory Leaks](./references/memory-leaks.md) |
| `frontend/src/js/engine/state.js` | Shared `state` object (engine, scene, camera, materials) | [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| `frontend/src/js/engine/transforms.js` | `applyDefaultMaterial()`, `centerImportedAsset()` | [→ Asset Loading](./references/asset-loading.md) |
| `frontend/src/js/engine/placeholders.js` | Loading/error placeholders, safe disposal | [→ Memory Leaks](./references/memory-leaks.md) |
| `frontend/src/js/engine/parametric-preview.js` | Inspector color/scale live editing | [→ Asset Loading](./references/asset-loading.md) |
| `frontend/src/js/ui/viewport-gizmo.js` | 2D X/Y/Z orientation overlay | [→ Camera & Views](./references/camera-and-views.md) |

## Deep Reference

| Topic | File |
|-------|------|
| GPU Memory Leaks, Disposal Patterns, Shared Materials | [→ Memory Leaks](./references/memory-leaks.md) |
| Engine Init, Scene Setup, Cleanup, Resize, Chrome | [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| GLTF/GLB Loading, Blob URLs, Metadata, Placeholders | [→ Asset Loading](./references/asset-loading.md) |
| ArcRotateCamera, Ortho Mode, View Presets, Framing | [→ Camera & Views](./references/camera-and-views.md) |

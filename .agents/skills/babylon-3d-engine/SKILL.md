---
name: babylon-3d-engine
description: Use for 3D viewport/engine problems in Arbesk Studio — "scene not rendering", "viewport is blank", "mesh disappeared", "tab crashes after load", camera wrong or clipping, black meshes, memory leaks, "clearScene breaks the grid", "orthographic view is broken", or scene lifecycle/disposal questions.
---

# Babylon.js 3D Engine — Arbesk Studio

## Quick Decision

| Symptom | Cause → read |
|---------|--------------|
| Tab crashes after repeated loads | GPU leak → `references/memory-leaks.md` |
| Mesh renders black | Light/material/normals → `references/asset-loading.md` |
| Camera wrong/zoomed/clipping | Ortho corners or framing → `references/camera-and-views.md` |
| `clearScene()` removes grid/gizmo | Missing `metadata.isViewportChrome = true` → `references/scene-lifecycle.md` |
| Resize breaks aspect / model stretches | Resize inside `runRenderLoop` pre-`scene.render()`; `engine.resize()` in handler or throttled loop → `references/scene-lifecycle.md` |
| Ortho stretches on resize | Frustum not rebalanced → `references/camera-and-views.md` |
| GLTF fails silently | Blob URL lifecycle/CORS/bad JSON → `references/asset-loading.md` |
| Child transform not saved | Pointer walk stops at nodeId, not childRef → `references/child-world-transforms.md` |
| Child world jumps after reload | `nodeAnchors` → inner, not outer anchor → `references/child-world-transforms.md` |
| Outliner won't attach gizmo | `OUTLINER_NODE_SELECTED` ≠ `selectNodeById` → `references/child-world-transforms.md` |

## Key Rules

1. `mesh.dispose(false, true)` cascades to unique import materials; `material.dispose(false, true)` destroys shared shaders.
2. Never iterate `scene.materials` for batch cleanup — dispose per-mesh.
3. Wrap `dispose()` in try-catch (`isDisposed` inconsistent across classes).
4. Viewport chrome needs `metadata.isViewportChrome = true` or `clearScene()` removes it.
5. Engine: `stencil: true` (HighlightLayer), `preserveDrawingBuffer: true` (thumbnails).
6. Resize inside `runRenderLoop` before `scene.render()`; handler-only resize races one frame.
7. Ortho mode: set `orthoLeft/Right/Top/Bottom` explicitly — never `radius`.
8. Rebalance ortho frustum on every resize, else front/right/top views stretch.
9. GLB/glTF load as blob URLs (glTF = composed JSON); `ImportMeshAsync` then `revokeObjectURL`.
10. Attach `metadata.nodeId` to imported meshes — pointer observables walk the parent chain.
11. Camera framing: 300ms animation — never snap instantly.
12. Capture shared `defaultWoodMaterial` pre-disposal; dispose once at end.

## Debugging Order

1. Official docs/API/Playground first → `references/official-resources.md`.
2. Search Babylon.js forum — most issues already solved.
3. "Was working till refactor"? Check git history — restore, don't add.
4. Custom solutions only after 1–3; never improvise workarounds first.

## File Map

| File | Role |
|------|------|
| `frontend/src/js/engine/scene-graph.ts` | Engine init, camera, selection, keyboard, asset loading |
| `frontend/src/js/engine/cleanup.ts` | `clearScene()` with chrome preservation |
| `frontend/src/js/engine/state.ts` | Shared `state` object |
| `frontend/src/js/engine/transforms.ts` | `applyDefaultMaterial()`, `centerImportedAsset()` |
| `frontend/src/js/engine/placeholders.ts` | Loading/error placeholders, safe disposal |
| `frontend/src/js/engine/parametric-preview.ts` | Inspector color/scale live editing |
| `frontend/src/js/engine/camera-persistence.ts` | Per-asset camera pose in localStorage (debounced save; restore on SCENE_READY + 90-frame settle to defeat post-restore camera drift) |
| `frontend/src/js/ui/viewport-gizmo.ts` | 2D X/Y/Z orientation overlay |

## Deep Reference

- Read `references/memory-leaks.md` when GPU leaks/disposal/shared materials.
- Read `references/scene-lifecycle.md` when engine init/cleanup/resize/chrome.
- Read `references/asset-loading.md` when GLTF/GLB/blob URLs/metadata/placeholders.
- Read `references/camera-and-views.md` when ArcRotateCamera/ortho/view presets/framing.
- Read `references/child-world-transforms.md` when anchors/pointer walk/transform persistence.
- Read `references/official-resources.md` for Babylon.js doc/forum links.

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
| Resize breaks canvas aspect ratio? | Engine resize must happen inside `runRenderLoop` before `scene.render()`. See [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| Model stretches during sidebar/window resize? | `engine.resize()` only in event handlers or throttled loop. See [→ Scene Lifecycle](./references/scene-lifecycle.md) |
| Ortho view stretches after window resize? | Ortho frustum not rebalanced on resize. See [→ Camera & Views](./references/camera-and-views.md) |
| GLTF fails to load (no error, just blank)? | Check blob URL lifecycle, CORS, or invalid JSON. See [→ Asset Loading](./references/asset-loading.md) |
| Child world transform not saved / "No Changes" on save? | Pointer walk stopping at mesh nodeId instead of walking to childRef boundary. See [→ Child-World Transforms](./references/child-world-transforms.md) |
| Child world jumps to wrong position after save/reload? | `nodeAnchors` pointing to inner childAnchor instead of outer anchor. See [→ Child-World Transforms](./references/child-world-transforms.md) |
| Clicking child world in outliner doesn't attach gizmo? | `OUTLINER_NODE_SELECTED` not wired to `selectNodeById`. See [→ Child-World Transforms](./references/child-world-transforms.md) |

## Key Rules

1. **`mesh.dispose(false, true)` is correct for unique import materials** — cascades to material. But `material.dispose(false, true)` destroys shared shaders.
2. **Never iterate `scene.materials` for batch cleanup** — dispose per-mesh during normal teardown.
3. **Always wrap `dispose()` in try-catch** — `isDisposed` is inconsistent across Babylon.js classes.
4. **Viewport chrome must have `metadata.isViewportChrome = true`** — `clearScene()` preserves it.
5. **Engine needs `stencil: true`** for HighlightLayer. Needs `preserveDrawingBuffer: true` for thumbnail capture.
6. **Resize inside `runRenderLoop` before `scene.render()`** — event-handler-only resize leaves a one-frame race during CSS transitions.
7. **Ortho mode: set `orthoLeft/Right/Top/Bottom` explicitly** — do not rely on `radius`.
8. **Rebalance ortho frustum on every resize** — otherwise orthographic front/right/top views stretch when the window aspect changes.
9. **GLB loads as blob URL, glTF loads as composed JSON blob URL** — both use `ImportMeshAsync` then `revokeObjectURL`.
10. **Attach `metadata.nodeId` to every imported mesh** — pointer observables walk the parent chain to identify selections.
11. **Camera framing uses 300ms animation** — never snap instantly.
12. **Shared `defaultWoodMaterial` must be captured before mesh disposal** — dispose it once at the end, not per-mesh.

## Troubleshooting Approach

**CRITICAL: Always check official resources before improvising solutions**

When debugging Babylon.js issues, follow this order:

1. **Check official Babylon.js documentation first**
   - [Babylon.js Documentation](https://doc.babylonjs.com/)
   - [Babylon.js API Reference](https://doc.babylonjs.com/typedoc/index)
   - [Babylon.js Playground](https://playground.babylonjs.com/) - working examples for every feature

2. **Search Babylon.js forum for similar issues**
   - [Babylon.js Forum](https://forum.babylonjs.com/)
   - Most common issues have already been solved and documented

3. **Check git history for recent changes**
   - If something "was working till refactor", check what changed in that refactor
   - Often the fix is restoring removed functionality, not adding new code

4. **Only then implement custom solutions**
   - If the issue isn't documented and git history doesn't reveal a simple fix, then implement a solution

**What NOT to do:**
- ❌ Improvise solutions without checking official docs
- ❌ Add complex workarounds when simple fixes exist
- ❌ Skip checking git history when something recently broke

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
| Child-World Anchor Hierarchy, Pointer Walk, Transform Persistence | [→ Child-World Transforms](./references/child-world-transforms.md) |

## Official Babylon.js Resources

**Primary Resources:**
- [Babylon.js Documentation](https://doc.babylonjs.com/) - Official docs and tutorials
- [Babylon.js API Reference](https://doc.babylonjs.com/typedoc/index) - Complete API documentation
- [Babylon.js Playground](https://playground.babylonjs.com/) - Live examples for every feature
- [Babylon.js Forum](https://forum.babylonjs.com/) - Community support and solutions

**Key Documentation Areas:**
- [How to Create a Basic Scene](https://doc.babylonjs.com/features/featuresDeepDive/scene) - Scene setup and lifecycle
- [Cameras](https://doc.babylonjs.com/features/featuresDeepDive/cameras) - Camera types and configuration
- [Engine](https://doc.babylonjs.com/features/featuresDeepDive/gameEngine) - Engine options and resize handling
- [Materials](https://doc.babylonjs.com/features/featuresDeepDive/materials) - Material creation and management
- [Meshes](https://doc.babylonjs.com/features/featuresDeepDive/mesh) - Mesh creation and manipulation

**Common Forum Solutions:**
- [Canvas resize patterns](https://forum.babylonjs.com/t/make-canvas-responsive-and-fill-remaining-space/27488)
- [Engine resize issues](https://forum.babylonjs.com/t/engine-resize-on-html-element-size-change/31005)
- [Memory management](https://forum.babylonjs.com/search?q=memory%20leak)

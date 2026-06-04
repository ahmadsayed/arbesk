---
name: babylon-memory-leaks
description: Diagnose and fix GPU memory leaks in Babylon.js when the browser bloats or crashes after repeated scene loads, asset switching, or dive/ascend navigation. Covers mesh.dispose vs material.dispose parameter traps, isDisposed API inconsistencies, and safe cleanup strategies for GLTF imports.
---

# Babylon.js GPU Memory Leak Diagnosis & Fix

Use this skill when the browser tab bloats, slows, or crashes after repeated:
- Scene loads (`clearScene` → `loadAssetManifest`)
- Asset switching (opening different worlds from the gallery)
- Diving into / ascending from child worlds
- Generating multiple assets in the same session

## Key Insight

**`mesh.dispose()` does NOT dispose materials or textures in Babylon.js.**
The default is `mesh.dispose(doNotRecurse=false, disposeMaterialAndTextures=false)`.
GLTF imports via `ImportMeshAsync` create unique materials and textures per import.
Each `clearScene` + reload cycle leaks all of them unless explicitly handled.

## Diagnostic Indicators

| Symptom | Likely cause |
|---------|-------------|
| Browser tab crashes after 2-3 asset loads | GPU memory exhausted by leaked materials/textures |
| Only happens with large GLTFs (e.g., 52 MB suka.gltf) | Large GLTFs have more materials/textures per load |
| DevTools Memory panel shows unbounded growth | Confirm with heap snapshot comparison |
| `chrome://gpu` or `about:support` shows high GPU memory | Confirm GPU-side leak |

## The `dispose()` Parameter Trap

Babylon.js `dispose()` has **different parameter semantics** on different classes:

| Class | `dispose(a, b)` meaning |
|-------|------------------------|
| `AbstractMesh` | `dispose(doNotRecurse=false, disposeMaterialAndTextures=false)` |
| `TransformNode` / `Node` | `dispose(doNotRecurse=false)` — second param ignored |
| `Material` | `dispose(forceDisposeTextures=false, forceDisposeEffects=false, …)` |

**Critical:** `mesh.dispose(false, true)` means "recurse + free materials" (correct).  
But `material.dispose(false, true)` means "**don't** free textures, **do** free shared shader effects" (wrong!).  
Calling `material.dispose(false, true)` destroys shared shader programs used by the entire render pipeline.

### Correct pattern per class

```js
// Mesh: dispose with material cascade (safe because material is unique per import)
mesh.dispose(false, true);

// Material: dispose WITHOUT texture cascade (textures handled separately)
material.dispose();

// Texture: simple dispose
texture.dispose();

// TransformNode / anchor: no material flag needed
anchor.dispose();
```

## The `isDisposed` API Inconsistency

Not all Babylon.js classes have `isDisposed()` as a callable method:

| Class | `isDisposed` |
|-------|-------------|
| `AbstractMesh` | Method — `.isDisposed()` works |
| `TransformNode` / `Node` | Getter property — `.isDisposed` (no parens) or `.isDisposed()` (both work in practice) |
| `BaseTexture` | Getter property — `.isDisposed()` **THROWS "not a function"** |
| `Material` | Getter or method depending on version — **don't rely on it** |

**Safe approach:** Wrap all `dispose()` calls in try-catch. Babylon.js `dispose()` is internally idempotent (`_isDisposed` check), so double-disposal is a no-op, not an error.

```js
// Safe disposal pattern for any Babylon.js resource
try {
  resource.dispose();
} catch (_) {
  // ignore — may already be disposed or have version-specific quirks
}
```

## Safe Shared-Material Handling

`applyDefaultMaterial()` assigns a single `defaultWoodMaterial` to meshes that have no material from their GLTF. This material is **shared** across all such meshes.

When disposing, **never** cascade-dispose the shared material:

```js
const sharedMat = state.defaultWoodMaterial; // capture reference before disposal

for (const mesh of meshes) {
  if (mesh && !mesh.isDisposed()) {
    if (mesh.material && mesh.material !== sharedMat) {
      mesh.dispose(false, true);  // unique import material — safe to cascade
    } else {
      mesh.dispose();              // shared material — handle separately
    }
  }
}

// Dispose the shared material once at the end
if (state.defaultWoodMaterial) {
  try {
    state.defaultWoodMaterial.dispose();
  } catch (_) {}
  state.defaultWoodMaterial = null;
}
```

## What NOT to Do

1. **Do NOT iterate `scene.materials` or `scene.textures` for batch cleanup** — This disposes materials/textures that the scene or render pipeline may internally depend on, corrupting subsequent renders. Instead, dispose materials per-mesh during normal disposal.

2. **Do NOT call `material.dispose(false, true)`** — This means `forceDisposeTextures=false, forceDisposeEffects=true`, which destroys shared shader programs.

3. **Do NOT call `texture.isDisposed()` or `material.isDisposed()`** without try-catch — These may not exist as callable methods on all Babylon.js classes.

4. **Do NOT use `mesh.dispose(false, true)` on meshes sharing `defaultWoodMaterial`** — The first mesh's disposal would destroy the shared material, breaking other meshes.

## Files in Arbesk

| File | Role |
|------|------|
| `frontend/src/js/engine/cleanup.js` | `clearScene()` — batch scene cleanup with shared-material-aware disposal |
| `frontend/src/js/engine/placeholders.js` | `disposePlaceholder()` — captures material reference before mesh disposal |
| `frontend/src/js/engine/transforms.js` | `applyDefaultMaterial()` — creates/modifies the shared `defaultWoodMaterial` |
| `frontend/src/js/engine/scene-graph.js` | `loadAsset()` — calls `ImportMeshAsync`, `applyDefaultMaterial`, and `attachMetadata` |
| `frontend/src/js/engine/state.js` | `state.defaultWoodMaterial` — the shared material reference |

## Verification Checklist

After applying a memory leak fix, verify:

1. ✅ Scene loads and renders correctly on first load
2. ✅ Switching between assets (clearScene + loadAssetManifest) renders correctly
3. ✅ Multiple switches don't degrade rendering quality
4. ✅ Browser tab memory stays bounded (use DevTools Performance/Memory panel)
5. ✅ No `isDisposed is not a function` errors in console
6. ✅ No `material.dispose(false, true)` parameter traps in the codebase

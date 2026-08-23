---
name: arbesk-gltf-pipeline
description: Use when working with glTF/GLB loading, materials, or the compose/decompose pipeline — "model not showing", "change material colors", "texture not rendering", "mesh is black", buffer/image URI formats, IPFS content-addressing, post_processor overlays, or save/publish persistence. When in doubt whether a rendering problem is Babylon or pipeline, invoke this first.
---

# Arbesk glTF 2.0 / GLB Pipeline

## Quick Decision

| Symptom | Action |
|---------|--------|
| glTF loading failure? | composite → monolithic → legacy CID-prefix → valid CID. → `references/troubleshooting.md` |
| Colors not applying after save? | Check node is decomposed (`source.path === "composite.gltf"`). → `references/troubleshooting.md` |
| New material property? | Setter in `material-editor.js`, wire to inspector, update save flow. → `references/deep-dive.md` |
| OBJ/FBX support? | Update `detectAssetFormat()`, `loadAsset()`, save flow. → `references/deep-dive.md` |

## Key Rules

1. **GLB is decomposed on save, not at load** — loads as a raw blob; runtime edits via `post_processor` overlays; on save/publish `decomposeGLB()` turns it into a composite glTF directly (no `.gltf` conversion step).
2. **glTF → composite on first save** — one-way; stays composite once decomposed.
3. **Material edits = new composite CID only** — buffers/images keep original CIDs.
4. **Scale is always `post_processor`** — geometry transform, not material, even for decomposed nodes.
5. **Composer deep-clones** — `composeGlTF()` clones via `JSON.parse(JSON.stringify())` before modifying.
6. **IPFS reads via gateway** — browser `127.0.0.1:8080`; backend `127.0.0.1:5001`.
7. **Legacy CID-prefix (`data:application/cid;base64,<CID>`) no longer produced** — new code uses composer/decomposer.
8. **Token child nodes have no glTF source** — skip `loadAsset()` entirely.

## File Map

All row details: `references/deep-dive.md`.

| File | Role |
|------|------|
| `frontend/src/js/asset-core/gltf/gltf-core.ts` | **Shared pure transforms** — `isComposite`, dedup-meta helpers, `composeGltfJson`, `decomposeGltfJson` (side effects injected). Single implementation used by composer, decomposer, AND the worker — change compose/decompose behavior here only |
| `frontend/src/js/asset-core/gltf/composer.ts` | Main-thread compose wrapper (IPFS read port + cache injection) |
| `frontend/src/js/asset-core/gltf/decomposer.ts` | Main-thread decompose wrapper (IPFS write port + dedup injection) |
| `frontend/src/js/asset-core/gltf/material-editor.ts` | PBR prop edits, commits new CID |
| `frontend/src/js/engine/scene-graph.ts` | `loadAsset()` dispatcher, `loadNode()` orchestration |
| `frontend/src/js/engine/time-travel.ts` | `applyColor()`, `applyScale()` runtime overlays |
| `frontend/src/js/engine/parametric-preview.ts` | Inspector UI: color/scale/mesh overrides |
| `frontend/src/js/services/asset-save/manifest-builder.ts` | `prepareManifestForWrite()` — save/publish |
| `frontend/src/js/asset-core/gltf/async-gltf.ts` | Worker-pool wrappers: compose, decompose, GLB parse, source-color edits (main-thread fallback) |
| `frontend/src/js/workers/gltf-worker-pool.ts` | `workerpool` of `gltf-worker.js` for off-main-thread glTF work |
| `frontend/src/js/workers/gltf-worker.ts` | Worker entry: `compose`, `composeToBytes`, `decomposeGltf`, `decomposeGlb`, `decomposeAndStore`, `editSourceColors` |
| `frontend/src/js/ipfs/write-to-ipfs.ts` | Browser IPFS write |
| `frontend/src/js/ipfs/remote-ipfs.ts` | Browser IPFS read |

## References

- Read `references/deep-dive.md` when working on architecture, URI formats, compose/decompose, scene graph, post-processor, materials, or the save flow.
- Read `references/troubleshooting.md` when debugging loading/colors, adding properties or formats, or forcing re-decomposition.
- For embedding the glTF pipeline in another host (backend/script/desktop), see `docs/ASSET_CORE_SDK.md`; the pipeline is part of the `frontend/src/js/asset-core/` SDK and is consumed through `createArbeskCore()` ports.

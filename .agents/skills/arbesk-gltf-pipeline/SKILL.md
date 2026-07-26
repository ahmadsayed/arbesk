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

1. **GLB is never decomposed** — raw binary blob; all edits via `post_processor` overlays.
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
| `frontend/src/js/gltf/composer.js` | `ipfs://` URIs → base64 for Babylon.js |
| `frontend/src/js/gltf/decomposer.js` | data URIs → IPFS |
| `frontend/src/js/gltf/material-editor.js` | PBR prop edits, commits new CID |
| `frontend/src/js/engine/scene-graph.js` | `loadAsset()` dispatcher, `loadNode()` orchestration |
| `frontend/src/js/engine/time-travel.js` | `applyColor()`, `applyScale()` runtime overlays |
| `frontend/src/js/engine/parametric-preview.js` | Inspector UI: color/scale/mesh overrides |
| `frontend/src/js/services/asset-save/manifest-builder.js` | `prepareManifestForWrite()` — save/publish |
| `frontend/src/js/gltf/async-gltf.js` | Worker-pool wrappers: compose, decompose, GLB parse, source-color edits (main-thread fallback) |
| `frontend/src/js/workers/gltf-worker-pool.js` | `workerpool` of `gltf-worker.js` for off-main-thread glTF work |
| `frontend/src/js/workers/gltf-worker.js` | Worker entry: `compose`, `composeToBytes`, `decomposeGltf`, `decomposeGlb`, `decomposeAndStore`, `editSourceColors` |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser IPFS write |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser IPFS read |

## References

- Read `references/deep-dive.md` when working on architecture, URI formats, compose/decompose, scene graph, post-processor, materials, or the save flow.
- Read `references/troubleshooting.md` when debugging loading/colors, adding properties or formats, or forcing re-decomposition.

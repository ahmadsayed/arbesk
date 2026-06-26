---
name: arbesk-gltf-pipeline
description: Expert guidance on the Arbesk glTF 2.0 / GLB pipeline — compose/decompose, material editing, IPFS content-addressing, buffer/image URI formats, scene graph loading, post_processor overlays, and save/publish persistence. Use whenever working with 3D model loading, materials, or the pipeline — "fix glTF loading", "change material colors", "3D model not showing", "texture not rendering", "mesh is black after load", "understand the glTF pipeline", "add a mesh override", "debug composite/decompose", "edit glTF buffers/images", "add OBJ/FBX support", or any glTF/GLB question. When in doubt whether a 3D rendering problem is a Babylon.js issue or a pipeline issue, invoke this skill first.
---

# Arbesk glTF 2.0 / GLB Pipeline

Use this skill when working with any glTF or GLB-related code in the Arbesk project — the compose/decompose pipeline, material editing, buffer/image URI formats, scene graph loading, post-processing, or data persistence.

## Quick Decision

| Question | Action |
|----------|--------|
| glTF loading failure? | Check composite → monolithic → legacy CID-prefix → valid CID. See [→ Troubleshooting](./references/troubleshooting.md) |
| Colors not applying after save? | Check if node is decomposed (`source.path === "composite.gltf"`). See [→ Troubleshooting](./references/troubleshooting.md) |
| Need to add a new material property? | Add setter in `material-editor.js`, wire to inspector, update save flow. See [→ Deep Dive](./references/deep-dive.md) |
| Need to add OBJ/FBX support? | Update `detectAssetFormat()`, `loadAsset()`, and save flow. See [→ Deep Dive](./references/deep-dive.md) |

## Key Rules

1. **GLB is never decomposed** — loads as raw binary blob. All edits go through `post_processor` overlays.
2. **glTF converts to composite on first save** — one-way door. Once decomposed, it stays composite.
3. **Material edits = new composite CID only** — buffers and images stay at their original CIDs.
4. **Scale is always `post_processor`** — even for decomposed nodes, it's a geometry transform, not a material property.
5. **The composer deep-clones** — `composeGlTF()` uses `JSON.parse(JSON.stringify())` before modifying.
6. **All IPFS reads go through the gateway** — browser: `127.0.0.1:8080`; backend: `127.0.0.1:5001`.
7. **Legacy CID-prefix format (`data:application/cid;base64,<CID>`) is no longer produced** — new code uses composer/decomposer.
8. **Token child nodes have no glTF source** — they skip `loadAsset()` entirely.

## File Map

| File | Role | Details |
|------|------|---------|
| `frontend/src/js/gltf/composer.js` | Resolves `ipfs://` URIs → base64 for Babylon.js | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/gltf/decomposer.js` | Extracts data URIs → stores on IPFS | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/gltf/material-editor.js` | Modifies PBR props, commits new CID | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/scene-graph.js` | `loadAsset()` dispatcher, `loadNode()` orchestration | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/time-travel.js` | `applyColor()`, `applyScale()` runtime overlays | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/engine/parametric-preview.js` | Inspector UI for color/scale/mesh overrides | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/services/asset-save/manifest-builder.js` | `prepareManifestForWrite()` — save/publish flow | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/gltf/async-gltf.js` | Off-main-thread decompose fallback (`decomposeGlTFAsync`, `decomposeAndStoreAsync`) | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS write | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS read | [→ Deep Dive](./references/deep-dive.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture, URI Formats, Compose/Decompose, Scene Graph, Post-Processor, Materials, Save Flow | [→ Deep Dive](./references/deep-dive.md) |
| Debug Loading, Debug Colors, Add Properties, Add Formats, Force Re-decomposition | [→ Troubleshooting](./references/troubleshooting.md) |

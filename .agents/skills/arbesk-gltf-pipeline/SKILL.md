---
name: arbesk-gltf-pipeline
description: Use when working with glTF/GLB loading, materials, or the compose/decompose pipeline — "model not showing", "change material colors", "texture not rendering", "mesh is black", buffer/image URI formats, IPFS content-addressing, post_processor overlays, or save/publish persistence. When in doubt whether a rendering problem is Babylon or pipeline, invoke this first.
---

# Arbesk glTF / GLB Pipeline

Stored form: a **composite** glTF (`node.source.path === "composite.gltf"`) whose buffers and images are `ipfs://<CID>` blobs. Render form: the same JSON with data URIs. Code lives in `packages/asset-core/src/formats/gltf/`; host-agnostic usage is in `docs/ASSET_CORE_SDK.md`.

## Rules

1. **One implementation.** `gltf-core.ts` (`composeGltfJson`, `decomposeGltfJson`, `isComposite`) holds the transforms. `composer.ts`, `decomposer.ts` and the worker (`frontend/src/js/workers/gltf-worker.ts`) only inject ports. Change behaviour in `gltf-core.ts`.
2. **Decompose happens on save, not at load.** A GLB or monolithic glTF loads as-is and becomes composite at the first Save draft or Publish (`prepareManifestForWrite()` in `frontend/src/js/services/asset-save/manifest-builder.ts`). It never goes back.
3. **One buffer per mesh** (`gltf-buffer-split.ts`). Never assume `buffers[0]` holds all geometry. Small meshes, animation and skin data, and accessors shared by several meshes go to one shared buffer, which comes last. A document with a bufferView extension such as `EXT_meshopt_compression` is not split. Older single-buffer composites still load.
4. **A material edit changes only the composite JSON CID.** Buffer and image CIDs stay, which is the point of the format.
5. **Where an edit is stored depends on the node.** Composite node: colours and mesh overrides are baked into the composite (`editCompositeColors`). Monolithic node: they stay in `node.post_processor` and are applied at load. Scale is always `post_processor.scale`, on every node.
6. **Stored bytes are sniffed, not assumed.** Textures already in a compressed format (PNG, JPEG, WebP, GIF) are stored raw; buffers and the composite JSON are brotli-framed. Readers detect which.
7. **Token child nodes (`child_ref`) have no glTF source** and never enter this pipeline.
8. **Worker calls fall back to the main thread** (`async-gltf.ts`), so a worker bug can hide behind a slow but working save. The worker has no import map: see AGENTS.md §3 for what it may import.

## Debugging

| Symptom | Check |
|---|---|
| Model not showing | Is the source composite (`ipfs://` URIs)? Then compose must run and every referenced CID must resolve: `docker compose exec ipfs ipfs cat <CID>`. Console tags: `[SCENE]`, `[COMPOSE]`, `[DECOMPOSE]`. |
| Colour lost after save | Composite node: the colour should be in the new composite CID and `post_processor.color` absent. Monolithic node: it should be in `post_processor.color`. |
| Geometry loads but is black, clipped or leaks memory | Not this pipeline: see the `babylon-3d-engine` skill. |

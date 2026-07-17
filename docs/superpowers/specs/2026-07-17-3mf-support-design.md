# 3MF Format Support — Design

**Date**: 2026-07-17
**Status**: Approved (design), pending implementation plan

## Goal

Add 3MF as a first-class source format in Arbesk:

1. Ship an open-source 3MF sample file with the repo.
2. Teach the mock generation adapter to return a 3MF model.
3. Implement a 3MF composer and decomposer so 3MF assets round-trip through IPFS in **native 3MF form**.

## Decisions (made with user)

| Question | Decision |
|----------|----------|
| Storage after save/publish | **Native 3MF** — a "composite 3MF" JSON references IPFS-stored package parts; the source never converts to glTF for storage |
| Parametric color/scale edits | **Overlays only** (`post_processor`), like GLB — the 3MF XML is never mutated by edits |
| Rendering | **Convert 3MF → glTF in memory** at load time; render through the existing Babylon glTF importer. Babylon.js has no 3MF loader (verified against official docs — built-ins are glTF/GLB, OBJ, STL, PLY/splat only) |
| Mock trigger | Prompt keyword `3mf` — all existing keyword routes (howdy/suka/intro) untouched |
| Composite marker path | `composite.3mf.json` — mirrors the `composite.gltf` convention |

## Architecture

### New module: `frontend/src/js/3mf/`

Pure functions, no DOM/Babylon/IPFS-client globals where avoidable — written worker-ready (offloading to `gltf-worker.js` is a possible later optimization, not v1).

| File | Role |
|------|------|
| `zip.js` | Thin `fflate` wrappers (`unzipBytes`, `zipBytes`). Nothing else in the app imports fflate directly. |
| `parser.js` | 3MF core XML → neutral `Parsed3mf`: `{ objects: [{ name, vertices, triangles, materialId }], basematerials: [{ name, color }], items: [{ objectId, transform }] }`. Uses `fast-xml-parser` (DOM-free: works in workers and Jest). |
| `to-gltf.js` | `Parsed3mf` → glTF 2.0 JSON with a single base64 data-URI buffer (positions + indices), one primitive per object, one scene node per build item, PBR materials from basematerials `displaycolor` (metallic 0). Applies the 3MF Z-up → glTF Y-up axis correction on a root node. |
| `decomposer.js` | Raw `.3mf` ZIP bytes → extract binary parts (textures, package thumbnail) → store each on IPFS (honoring `ctx.dedupMap`) → write composite 3MF JSON to IPFS → return its CID. Textureless files produce `parts: {}`. |
| `composer.js` | Composite 3MF JSON → fetch `ipfs://` parts via `remote-ipfs.js` → rebuild a valid `.3mf` ZIP. Round-trip preserves geometry exactly (byte-level part preservation; XML carried verbatim as a string). |

**Composite 3MF JSON** (the stored form):

```json
{
  "arbesk_format": "composite-3mf",
  "contentTypes": "<[Content_Types].xml verbatim>",
  "rootRels": "<_rels/.rels verbatim>",
  "modelRels": "<3D/_rels/3dmodel.model.rels verbatim or null>",
  "model": "<3D/3dmodel.model XML verbatim>",
  "parts": { "/3D/Textures/texture1.png": { "cid": "bafy..." } }
}
```

### Format handler: `frontend/src/js/formats/handlers/3mf-handler.js`

Registered alongside glTF/GLB in `frontend/src/js/formats/index.js`.

- `format: "3mf"`, `extensions: [".3mf"]`
- `sniff(bytes)` — ZIP magic `PK\x03\x04` and the entry list contains `3D/3dmodel.model`.
- `load(src, ctx)` — fetch source CID bytes; if ZIP magic → use directly, else parse composite JSON → compose to raw bytes; parse → `to-gltf.js` → Blob → `ctx.importFromBlob(blob, ".gltf")`. The glTF is a render-only representation, never persisted.
- `decomposeForSave(node, ctx)` — raw `.3mf` → decompose → `{ cid, path: "composite.3mf.json", format: "3mf" }`. If already composite, normalize-only.
- `isStoredForm(node)` — `node.source.path === "composite.3mf.json"`.
- `isDedupSource()` — `false` (mirrors GLB handler).
- No `editSourceColors` / `editCompositeColors` — edits stay as `post_processor` overlays.

### Mock service

- Download `examples/core/box.3mf` from the BSD-licensed [`3MFConsortium/3mf-samples`](https://github.com/3MFConsortium/3mf-samples) repo into `mock-gltf-assets/box.3mf`; verify the repo LICENSE at download time and add `mock-gltf-assets/ATTRIBUTION.md` with source + license.
- `src/api/adapters/mock-adapter.js`: one new branch — prompt (lowercased) contains `3mf` → `fs.readFileSync` → `{ buffer, format: "3mf", provider: "mock" }`. Existing keyword routes unchanged.
- `src/api/assets/generate-node.js`: **no change** — `format`/`path` already flow through; the browser uploads `asset.3mf` to IPFS and the manifest node gets `source: { cid, path: "asset.3mf", format: "3mf" }` (`frontend/src/js/services/api.js`).

### Dependencies

Add to `frontend/package.json` (Jest frontend tests resolve through `frontend/node_modules`, same as `workerpool`):

- `fflate` — ZIP read/write (tiny, ESM, no native code)
- `fast-xml-parser` — XML parse/serialize (pure JS, worker-safe)

No backend dependency changes; no worker-build changes (main-thread execution in v1).

## Data flow

**Generation**: prompt containing "3mf" → backend mock adapter returns raw `box.3mf` bytes → browser uploads `asset.3mf` to IPFS → manifest node `source.format = "3mf"` → scene-loader resolves the 3mf handler → load → parse → in-memory glTF → Babylon render.

**Save/publish (first time)**: `decomposeManifestNodes` → 3mf handler `decomposeForSave` → parts stored on IPFS → composite 3MF JSON stored → node source becomes `{ cid: <compositeCid>, path: "composite.3mf.json", format: "3mf" }` (one-way door, same as composite glTF).

**Reload after save**: handler detects composite JSON (not ZIP magic) → composer rebuilds raw `.3mf` → same parse/convert/render path.

## Error handling

- Malformed ZIP / missing `3D/3dmodel.model` / unparseable XML → throw with a `[FORMATS-3mf]`-prefixed message; scene-loader surfaces it like any other load failure.
- Composer: missing `ipfs://` part fetch → propagate the IPFS error with the part path included.
- Parser: unsupported 3MF extension elements (slice, production, beam lattice, `<components>`) are ignored, not fatal — core mesh still renders.
- Decomposer: dedup miss falls back to a fresh IPFS write (same semantics as the glTF decomposer).

## Testing

| Layer | What |
|-------|------|
| Unit (`test/frontend/`) | `parser` (box.3mf → expected vertex/triangle counts, basematerial colors), `to-gltf` (valid glTF 2.0 shape, materials, Y-up root), composer/decomposer round-trip (raw → composite → raw, identical geometry), handler (`isStoredForm`, `decomposeForSave` via `decomposeManifestNodes` — mirror `format-example-handler.test.js`) |
| API (`test/api.test.js`) | Route-level: `MOCK_3D_GENERATION=true`, prompt containing "3mf" → response `format: "3mf"` and non-empty `assetData` |
| E2E (`e2e/specs/16-3mf-generation.spec.js`) | Generate with a "3mf" prompt → viewport renders → save → publish → library card → reload from manifest CID persists. Update `e2e/README.md` per-spec contract. No UI/selector changes expected. |

`npm test` and `npm run test:frontend` must stay green (deployment-integrity suite included).

## Docs to update

- `docs/FORMAT_HANDLERS.md` — add `3mf` to built-in handlers; replace the speculative "A 3MF handler could either…" section with the implemented native approach.
- `AGENTS.md` — layout row for `frontend/src/js/3mf/`; mock-generation note (3mf keyword) in §1.

## Out of scope

- Library "upload file" acceptance of `.3mf` (easy follow-up once the handler exists; not requested)
- 3MF extension specs (slice, production, displacement, beam lattice) and `<components>` object nesting
- Editing textures or baking colors into 3MF XML
- Web-worker offloading of compose/decompose
- Renaming `mock-gltf-assets/` (it now holds a `.3mf` too; name stays to avoid churn in `MOCK_ASSETS_DIR` docs/env)

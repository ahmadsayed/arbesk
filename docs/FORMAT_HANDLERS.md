# Arbesk Format Handlers

Arbesk's 3D asset pipeline is format-agnostic at the dispatch layer. Adding support for a new format means writing a pure engine module in `packages/asset-core/src/formats/<fmt>/` (parser, glTF converter, composer/decomposer over the injected IPFS ports), plus one thin browser handler, and registering the handler.

## Built-in handlers

- `gltf` — loose glTF JSON assets (`frontend/src/js/formats/handlers/gltf-handler.ts`)
- `glb` — binary glTF assets (`frontend/src/js/formats/handlers/glb-handler.ts`)
- `3mf` — 3D Manufacturing Format assets (`frontend/src/js/formats/handlers/3mf-handler.ts`)

All three are registered automatically by `frontend/src/js/formats/index.ts`.

## Handler interface

```ts
interface FormatHandler {
  format: string;                 // canonical lowercase key
  extensions: string[];           // e.g. [".3mf"]
  sniff?: (bytes: Uint8Array) => boolean;
  load: (src, ctx: FormatLoadContext) => Promise<{ meshes, transformNodes? }>;
  decomposeForSave: (node, ctx: FormatSaveContext) => Promise<DecomposeResult | null>;
  isStoredForm: (node) => boolean;
  isDedupSource?: (node) => boolean;
  editSourceColors?: (node, colorMap, ctx) => Promise<EditResult>;
  editCompositeColors?: (node, meshOverrides, color, ctx) => Promise<BakeResult>;
}
```

### Load context

```ts
interface FormatLoadContext {
  scene: BABYLON.Scene;
  cid: string;
  importFromBlob: (blob: Blob, extension: string) => Promise<{ meshes, transformNodes }>;
}
```

Handlers must **not** import `engine/*`. Engine access is injected via `ctx`.

### Save context

```ts
interface FormatSaveContext {
  assetName: string;
  assetId: string;
  dedupMap: Map<string, string>;
}
```

### Decompose result

```ts
interface DecomposeResult {
  cid: string;        // new source CID after storage
  path: string;       // filename/path marker
  format?: string;    // stored format (defaults to handler.format)
  normalizeOnly?: boolean; // true if source was already stored form
}
```

## Stored-form convention

A "stored form" is a source that does not need re-processing on the next save.
The built-in `gltf`/`glb` handlers store decomposed assets as:

```json
{ "format": "gltf", "path": "composite.gltf" }
```

The built-in `3mf` handler keeps the native form: `decomposeForSave`
extracts the OPC package into a composite 3MF JSON — XML parts verbatim, binary
parts referenced by CID — and returns `{ format: "3mf", path: "composite.3mf.json" }`.
Loading parses the package and converts it to glTF in memory for Babylon.js; the
glTF is never persisted. The composer/decomposer/parser live in
`packages/asset-core/src/formats/3mf/` and read/write IPFS through the injected
`ipfsRead`/`ipfsWrite` runtime ports.

## Adding a format

1. Copy the reference engine `packages/asset-core/src/formats/example/` to
   `packages/asset-core/src/formats/<fmt>/` — `format.ts` (constants/types/
   predicates), `parser.ts` (pure parse), `to-gltf.ts` (render conversion), and
   `composer.ts`/`decomposer.ts` (IPFS read/write via the runtime ports). Any
   pure-half dependency goes in `packages/asset-core/package.json`.
2. Copy `test/frontend/fixtures/example-format.js` to a thin handler under
   `frontend/src/js/formats/handlers/<fmt>-handler.ts` and implement `load`,
   `decomposeForSave`, and `isStoredForm`, delegating heavy work to the engine
   via lazy `@arbesk/asset-core/formats/<fmt>/*.js` imports (the 3MF handler is
   the reference).
3. Register the handler in `frontend/src/js/formats/index.ts` and add the
   extension to `ALLOWED_EXTENSIONS` in `services/library-ops.ts`.
4. Registration happens at bootstrap via `formats/index.ts` — before the first
   asset is loaded or saved.
5. Add tests: an engine round-trip (see `test/frontend/example-format-engine.test.js`)
   and a handler test (see `test/frontend/3mf-handler.test.js`).

## Testing recipe

See `test/frontend/format-example-handler.test.js`. It proves that a handler registered at test time is used by core save logic without any edits to `scene-loader.js` or `manifest-builder.js`.

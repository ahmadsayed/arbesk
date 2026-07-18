# Arbesk Format Handlers

Arbesk's 3D asset pipeline is format-agnostic at the dispatch layer. Adding support for a new format means writing one handler module and registering it.

## Built-in handlers

- `gltf` — loose glTF JSON assets (`frontend/src/js/formats/handlers/gltf-handler.js`)
- `glb` — binary glTF assets (`frontend/src/js/formats/handlers/glb-handler.js`)
- `3mf` — 3D Manufacturing Format assets (`frontend/src/js/formats/handlers/3mf-handler.js`)

All three are registered automatically by `frontend/src/js/formats/index.js`.

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
glTF is never persisted. The composer/decomposer/parser live in `frontend/src/js/3mf/`.

## Adding a format in four steps

1. Copy `test/frontend/fixtures/example-format.js` to a new file under `frontend/src/js/formats/handlers/`.
2. Implement `load`, `decomposeForSave`, and `isStoredForm` for your format.
3. Import and register it somewhere in your application bootstrap:
   ```js
   import { registerFormatHandler } from "./formats/registry.js";
   import { myFormatHandler } from "./formats/handlers/my-format-handler.js";
   registerFormatHandler(myFormatHandler);
   ```
   Registration must happen **before** the first asset is loaded or saved.
4. Add a test that registers the handler and runs `decomposeManifestNodes` on a node with `format: "myformat"`.

## Testing recipe

See `test/frontend/format-example-handler.test.js`. It proves that a handler registered at test time is used by core save logic without any edits to `scene-loader.js` or `manifest-builder.js`.

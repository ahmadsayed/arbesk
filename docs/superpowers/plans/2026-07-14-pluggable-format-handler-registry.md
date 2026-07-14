# Pluggable Format-Handler Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modularize Arbesk's client-side compose/decompose pipeline behind a format-handler registry so adding a new format requires only writing and registering one handler module.

**Architecture:** Introduce a zero-import `frontend/src/js/formats/registry.js` that maintains a map of canonical format keys to handler objects. Built-in `frontend/src/js/formats/handlers/gltf-handler.js` and `glb-handler.js` wrap existing glTF/GLB code; `frontend/src/js/formats/index.js` registers them on import. `frontend/src/js/engine/scene-loader.js` and `frontend/src/js/services/asset-save/manifest-builder.js` dispatch through the registry instead of inline `if (format === "glb")` branches. A dummy `frontend/src/js/formats/handlers/example-format.js` handler proves the extension point in tests.

**Tech Stack:** ES modules, JSDoc strict `checkJs`, Jest, jsdom, Babylon.js (runtime only).

---

## Context & scope

- **Frontend-only change.** The Express backend only passes `result.format` through; `src/api/schemas.js` has no format enum.
- **Cycle freedom.** `registry.js` must have zero imports. Handlers import only `gltf/*` and `ipfs/*`. Engine access is injected via context objects, so handlers never import `engine/*`.
- **Behavioral parity.** Existing no-op-save detection, rate-limit rethrow, `_verifiedCompositeCids` cache, and stored-form conventions (`path: "composite.gltf"`, `format: "gltf"`) must be preserved exactly.
- **Worker fast paths stay internal.** `gltf-worker.js` remains a glTF/GLB optimization behind `async-gltf.js`; plugins run on the main thread.

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/js/formats/registry.js` | Cycle-proof registry root: register, lookup, detect, resolve, reset. |
| `frontend/src/js/formats/handlers/gltf-handler.js` | Built-in handler for loose glTF JSON assets. |
| `frontend/src/js/formats/handlers/glb-handler.js` | Built-in handler for binary GLB assets. |
| `frontend/src/js/formats/handlers/example-format.js` | Dummy/template handler, registered only in tests. |
| `frontend/src/js/formats/index.js` | Registers built-ins and re-exports registry API. |
| `frontend/src/js/engine/transforms.js:25-30` | Re-export `detectAssetFormat` from `formats/registry.js`. |
| `frontend/src/js/engine/scene-loader.js:37-111` | Refactor `loadAsset` to dispatch through registry. |
| `frontend/src/js/services/asset-save/manifest-builder.js` | Refactor decompose/dedup/color routes through registry. |
| `test/frontend/format-registry.test.js` | Registry API + detection tests. |
| `test/frontend/format-handlers.test.js` | gltf/glb handler delegation tests. |
| `test/frontend/format-example-handler.test.js` | Extension-point proof with dummy handler. |
| `docs/FORMAT_HANDLERS.md` | Interface reference and "adding a format" guide. |

---

## Task 0: Baseline verification

**Files:**
- Run in worktree: `.worktrees/feature-pluggable-format-registry`

- [ ] **Step 0.1: Record current test baseline**

```bash
npm run typecheck:frontend
npm test
npm run build:frontend
```

**Expected:**
- `typecheck:frontend` exits 0.
- `npm test` reports `Test Suites: 82 passed, 82 total` and `Tests: 1104 passed, 1104 total`.
- `npm run build:frontend` exits 0.

- [ ] **Step 0.2: Commit baseline (optional, creates a known-good checkpoint)**

Skip if worktree already has unrelated modifications; otherwise:

```bash
git add -A
git commit -m "chore: baseline before pluggable format-handler registry"
```

---

## Task 1: Create `registry.js` and its tests

**Files:**
- Create: `frontend/src/js/formats/registry.js`
- Create: `test/frontend/format-registry.test.js`

- [ ] **Step 1.1: Write `frontend/src/js/formats/registry.js`**

```js
/**
 * Format-handler registry.
 *
 * Cycle-proof root: this file must not import any project modules.
 * Handlers are plain objects keyed by canonical lowercase format name.
 */

/** @typedef {import('./handlers/example-format.js').FormatHandler} FormatHandler */

const handlers = new Map();
const warnedFormats = new Set();

/**
 * Register a format handler.
 *
 * @param {FormatHandler} handler
 * @throws {TypeError} on duplicate format or missing required hooks
 */
export function registerFormatHandler(handler) {
  if (!handler || typeof handler !== "object") {
    throw new TypeError("registerFormatHandler: handler must be an object");
  }
  if (typeof handler.format !== "string" || handler.format.length === 0) {
    throw new TypeError("registerFormatHandler: handler.format must be a non-empty string");
  }
  const key = handler.format.toLowerCase();
  if (handlers.has(key)) {
    throw new TypeError(`registerFormatHandler: format "${key}" is already registered`);
  }
  for (const required of ["load", "decomposeForSave", "isStoredForm"]) {
    if (typeof handler[required] !== "function") {
      throw new TypeError(
        `registerFormatHandler: handler.${required} must be a function`
      );
    }
  }
  handlers.set(key, handler);
}

/**
 * Look up a handler by canonical format key.
 *
 * @param {string} format
 * @returns {FormatHandler | null}
 */
export function getFormatHandler(format) {
  if (!format) return null;
  return handlers.get(format.toLowerCase()) || null;
}

/**
 * Detect the asset format from its source reference.
 *
 * @param {any} src
 * @returns {string}
 */
export function detectAssetFormat(src) {
  if (src && typeof src === "object" && src.format) {
    return src.format.toLowerCase();
  }
  return "gltf";
}

/**
 * Detect the format and return its registered handler, falling back to gltf.
 *
 * @param {any} src
 * @returns {FormatHandler}
 */
export function resolveFormatHandler(src) {
  const detected = detectAssetFormat(src);
  const handler = getFormatHandler(detected);
  if (handler) return handler;
  if (!warnedFormats.has(detected)) {
    console.warn(`[FORMATS] unknown format "${detected}", falling back to gltf`);
    warnedFormats.add(detected);
  }
  return handlers.get("gltf");
}

/**
 * List all registered handlers.
 *
 * @returns {FormatHandler[]}
 */
export function listFormatHandlers() {
  return Array.from(handlers.values());
}

/**
 * Reset the registry. Used only by tests.
 */
export function _resetFormatRegistry() {
  handlers.clear();
  warnedFormats.clear();
}
```

- [ ] **Step 1.2: Write `test/frontend/format-registry.test.js`**

```js
/**
 * @jest-environment jsdom
 */
import {
  registerFormatHandler,
  getFormatHandler,
  detectAssetFormat,
  resolveFormatHandler,
  listFormatHandlers,
  _resetFormatRegistry,
} from "../../frontend/src/js/formats/registry.js";

describe("format registry", () => {
  afterEach(() => {
    _resetFormatRegistry();
  });

  const minimalHandler = (format) => ({
    format,
    extensions: [],
    load: async () => ({ meshes: [] }),
    decomposeForSave: async () => null,
    isStoredForm: () => false,
  });

  it("registers and looks up a handler", () => {
    const h = minimalHandler("foo");
    registerFormatHandler(h);
    expect(getFormatHandler("foo")).toBe(h);
    expect(getFormatHandler("FOO")).toBe(h);
  });

  it("throws on duplicate format", () => {
    registerFormatHandler(minimalHandler("foo"));
    expect(() => registerFormatHandler(minimalHandler("foo"))).toThrow(/already registered/);
  });

  it("throws when required hooks are missing", () => {
    expect(() => registerFormatHandler({ format: "x" })).toThrow(/handler.load/);
    expect(() =>
      registerFormatHandler({ format: "x", load: async () => {} })
    ).toThrow(/handler.decomposeForSave/);
    expect(() =>
      registerFormatHandler({ format: "x", load: async () => {}, decomposeForSave: async () => {} })
    ).toThrow(/handler.isStoredForm/);
  });

  it("detects formats case-insensitively", () => {
    expect(detectAssetFormat({ format: "GLB" })).toBe("glb");
    expect(detectAssetFormat({ format: "gltf" })).toBe("gltf");
    expect(detectAssetFormat({ format: "EXAMPLE" })).toBe("example");
  });

  it('defaults to "gltf" for missing/unknown format', () => {
    expect(detectAssetFormat({ cid: "bafy" })).toBe("gltf");
    expect(detectAssetFormat(null)).toBe("gltf");
    expect(detectAssetFormat("plain")).toBe("gltf");
  });

  it("lists all handlers", () => {
    const a = minimalHandler("a");
    const b = minimalHandler("b");
    registerFormatHandler(a);
    registerFormatHandler(b);
    expect(listFormatHandlers()).toEqual([a, b]);
  });

  it("warns once on unknown format and falls back to gltf", () => {
    registerFormatHandler(minimalHandler("gltf"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    resolveFormatHandler({ format: "unknown" });
    resolveFormatHandler({ format: "UNKNOWN" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 1.3: Run the new test**

```bash
npx jest test/frontend/format-registry.test.js --runInBand
```

**Expected:** `Tests: 7 passed, 7 total` (or similar; all green).

- [ ] **Step 1.4: Run frontend typecheck**

```bash
npm run typecheck:frontend
```

**Expected:** exits 0. Fix any JSDoc/strict checkJs errors before moving on.

- [ ] **Step 1.5: Commit**

```bash
git add frontend/src/js/formats/registry.js test/frontend/format-registry.test.js
git commit -m "feat(formats): add format-handler registry and tests"
```

---

## Task 2: Create glTF and GLB handlers and their tests

**Files:**
- Create: `frontend/src/js/formats/handlers/gltf-handler.js`
- Create: `frontend/src/js/formats/handlers/glb-handler.js`
- Create: `test/frontend/format-handlers.test.js`

- [ ] **Step 2.1: Read current `gltf/async-gltf.js` exports**

Confirm these functions are exported (used in handlers):
- `composeGlTFToBlobAsync(compositeJson)`
- `decomposeAndStoreAsync(gltfJson, { assetName, assetId, dedupMap })`
- `decomposeGLBAsync(glbBuffer, true, { assetName, assetId, dedupMap })`
- `editSourceColorsAsync(cid, colorMap, { assetName, assetId, dedupMap })`

If signatures differ, adjust handler code below to match.

- [ ] **Step 2.2: Write `frontend/src/js/formats/handlers/gltf-handler.js`**

```js
// @ts-check
/**
 * Built-in handler for loose glTF JSON assets.
 */

import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.js";
import {
  composeGlTFToBlobAsync,
  decomposeAndStoreAsync,
  editSourceColorsAsync,
} from "../../gltf/async-gltf.js";
import { isComposite } from "../../gltf/decomposer.js";
import { editCompositeColors } from "../../gltf/material-editor.js";

/** @type {import("../registry.js").FormatHandler} */
export const gltfHandler = {
  format: "gltf",
  extensions: [".gltf"],

  /**
   * Load a loose glTF JSON asset into the scene.
   *
   * @param {any} src
   * @param {import("../registry.js").FormatLoadContext} ctx
   */
  async load(src, ctx) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-gltf] fetching glTF JSON | cid=${cid}`);
    const gltfJson = await getFromRemoteIPFS(cid);
    const gltfBlob = await composeGlTFToBlobAsync(gltfJson);
    console.log(`[FORMATS-gltf] composed | bytes=${gltfBlob.size}`);
    return ctx.importFromBlob(gltfBlob, ".gltf");
  },

  /**
   * Decompose a loose glTF source for save/publish.
   *
   * @param {any} node
   * @param {import("../registry.js").FormatSaveContext} ctx
   */
  async decomposeForSave(node, ctx) {
    const cid = node.source.cid;
    const gltf = await getFromRemoteIPFS(cid);
    if (!gltf?.asset?.version) {
      console.log(`[FORMATS-gltf] CID ${cid} is not a glTF, skipping`);
      return null;
    }
    if (isComposite(gltf)) {
      console.log(`[FORMATS-gltf] already composite, normalizing path | cid=${cid}`);
      return {
        cid,
        path: "composite.gltf",
        format: "gltf",
        normalizeOnly: true,
      };
    }
    const { compositeCid } = await decomposeAndStoreAsync(gltf, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
    return {
      cid: compositeCid,
      path: "composite.gltf",
      format: "gltf",
    };
  },

  isStoredForm(node) {
    return (
      node.source?.format === "gltf" && node.source?.path === "composite.gltf"
    );
  },

  isDedupSource(node) {
    return (
      node.source?.path === "composite.gltf" || node.source?.format === "gltf"
    );
  },

  async editSourceColors(node, colorMap, ctx) {
    return editSourceColorsAsync(node.source.cid, colorMap, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
  },

  async editCompositeColors(node, meshOverrides, color, ctx) {
    return editCompositeColors(
      node.source.cid,
      meshOverrides,
      color,
      {
        assetName: ctx.assetName,
        assetId: ctx.assetId,
      }
    );
  },
};
```

- [ ] **Step 2.3: Write `frontend/src/js/formats/handlers/glb-handler.js`**

```js
// @ts-check
/**
 * Built-in handler for binary GLB assets.
 */

import {
  getBlobFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
} from "../../ipfs/remote-ipfs.js";
import {
  decomposeGLBAsync,
  editSourceColorsAsync,
} from "../../gltf/async-gltf.js";

const GLB_MAGIC = 0x676c5446; // "glTF"

/** @type {import("../registry.js").FormatHandler} */
export const glbHandler = {
  format: "glb",
  extensions: [".glb"],

  /**
   * @param {Uint8Array} bytes
   * @returns {boolean}
   */
  sniff(bytes) {
    if (!bytes || bytes.length < 4) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint32(0, true) === GLB_MAGIC;
  },

  /**
   * Load a binary GLB asset into the scene.
   *
   * @param {any} src
   * @param {import("../registry.js").FormatLoadContext} ctx
   */
  async load(src, ctx) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-glb] fetching GLB blob | cid=${cid}`);
    const blob = await getBlobFromRemoteIPFS(cid);
    console.log(`[FORMATS-glb] fetched | bytes=${blob.size}`);
    return ctx.importFromBlob(blob, ".glb");
  },

  /**
   * Decompose a binary GLB source for save/publish.
   *
   * @param {any} node
   * @param {import("../registry.js").FormatSaveContext} ctx
   */
  async decomposeForSave(node, ctx) {
    const cid = node.source.cid;
    const glbBuffer = await getArrayBufferFromRemoteIPFS(cid);
    const { compositeCid } = await decomposeGLBAsync(glbBuffer, true, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
    return {
      cid: compositeCid,
      path: "composite.gltf",
      format: "gltf",
    };
  },

  isStoredForm() {
    return false;
  },

  isDedupSource() {
    return false;
  },

  async editSourceColors(node, colorMap, ctx) {
    return editSourceColorsAsync(node.source.cid, colorMap, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
  },
};
```

- [ ] **Step 2.4: Write `test/frontend/format-handlers.test.js`**

```js
/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { gltfHandler } from "../../frontend/src/js/formats/handlers/gltf-handler.js";
import { glbHandler } from "../../frontend/src/js/formats/handlers/glb-handler.js";

jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: jest.fn(),
  getBlobFromRemoteIPFS: jest.fn(),
  getArrayBufferFromRemoteIPFS: jest.fn(),
}));

jest.unstable_mockModule("../../frontend/src/js/gltf/async-gltf.js", () => ({
  composeGlTFToBlobAsync: jest.fn(),
  decomposeAndStoreAsync: jest.fn(),
  decomposeGLBAsync: jest.fn(),
  editSourceColorsAsync: jest.fn(),
}));

jest.unstable_mockModule("../../frontend/src/js/gltf/decomposer.js", () => ({
  isComposite: jest.fn(),
}));

const { getFromRemoteIPFS, getBlobFromRemoteIPFS, getArrayBufferFromRemoteIPFS } =
  await import("../../frontend/src/js/ipfs/remote-ipfs.js");
const {
  composeGlTFToBlobAsync,
  decomposeAndStoreAsync,
  decomposeGLBAsync,
} = await import("../../frontend/src/js/gltf/async-gltf.js");
const { isComposite } = await import("../../frontend/src/js/gltf/decomposer.js");

describe("gltf handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads via importFromBlob with .gltf extension", async () => {
    const gltfJson = { asset: { version: "2.0" } };
    const blob = new Blob(["gltf"], { type: "model/gltf+json" });
    getFromRemoteIPFS.mockResolvedValue(gltfJson);
    composeGlTFToBlobAsync.mockResolvedValue(blob);
    const importFromBlob = jest.fn().mockResolvedValue({ meshes: ["m1"] });

    const result = await gltfHandler.load(
      { cid: "bafyGltf", format: "gltf" },
      { cid: "bafyGltf", importFromBlob }
    );

    expect(result).toEqual({ meshes: ["m1"] });
    expect(importFromBlob).toHaveBeenCalledWith(blob, ".gltf");
  });

  it("returns normalizeOnly for already-composite glTF", async () => {
    const gltfJson = { asset: { version: "2.0" } };
    getFromRemoteIPFS.mockResolvedValue(gltfJson);
    isComposite.mockReturnValue(true);

    const result = await gltfHandler.decomposeForSave(
      { source: { cid: "bafyComposite", format: "gltf" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toEqual({
      cid: "bafyComposite",
      path: "composite.gltf",
      format: "gltf",
      normalizeOnly: true,
    });
  });

  it("decomposes non-composite glTF", async () => {
    const gltfJson = { asset: { version: "2.0" } };
    getFromRemoteIPFS.mockResolvedValue(gltfJson);
    isComposite.mockReturnValue(false);
    decomposeAndStoreAsync.mockResolvedValue({ compositeCid: "bafyNew" });

    const result = await gltfHandler.decomposeForSave(
      { source: { cid: "bafyOld", format: "gltf" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toEqual({
      cid: "bafyNew",
      path: "composite.gltf",
      format: "gltf",
    });
  });

  it("returns null for non-glTF JSON", async () => {
    getFromRemoteIPFS.mockResolvedValue({ not: "gltf" });

    const result = await gltfHandler.decomposeForSave(
      { source: { cid: "bafyOther", format: "gltf" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toBeNull();
  });

  it("identifies stored composite form", () => {
    expect(
      gltfHandler.isStoredForm({ source: { format: "gltf", path: "composite.gltf" } })
    ).toBe(true);
    expect(
      gltfHandler.isStoredForm({ source: { format: "gltf", path: "asset.gltf" } })
    ).toBe(false);
  });
});

describe("glb handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sniffs glTF magic", () => {
    const magic = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    expect(glbHandler.sniff(magic)).toBe(true);
    expect(glbHandler.sniff(new Uint8Array([0, 0, 0, 0]))).toBe(false);
  });

  it("loads via importFromBlob with .glb extension", async () => {
    const blob = new Blob(["glb"], { type: "model/gltf-binary" });
    getBlobFromRemoteIPFS.mockResolvedValue(blob);
    const importFromBlob = jest.fn().mockResolvedValue({ meshes: ["m1"] });

    const result = await glbHandler.load(
      { cid: "bafyGlb", format: "glb" },
      { cid: "bafyGlb", importFromBlob }
    );

    expect(result).toEqual({ meshes: ["m1"] });
    expect(importFromBlob).toHaveBeenCalledWith(blob, ".glb");
  });

  it("decomposes GLB to composite glTF", async () => {
    getArrayBufferFromRemoteIPFS.mockResolvedValue(new ArrayBuffer(10));
    decomposeGLBAsync.mockResolvedValue({ compositeCid: "bafyComposite" });

    const result = await glbHandler.decomposeForSave(
      { source: { cid: "bafyGlb", format: "glb" } },
      { assetName: "Test", assetId: "asset_1", dedupMap: new Map() }
    );

    expect(result).toEqual({
      cid: "bafyComposite",
      path: "composite.gltf",
      format: "gltf",
    });
  });
});
```

- [ ] **Step 2.5: Run handler tests**

```bash
npx jest test/frontend/format-handlers.test.js --runInBand
```

**Expected:** all green.

- [ ] **Step 2.6: Run typecheck again**

```bash
npm run typecheck:frontend
```

**Expected:** exits 0.

- [ ] **Step 2.7: Commit**

```bash
git add frontend/src/js/formats/handlers test/frontend/format-handlers.test.js
git commit -m "feat(formats): add gltf/glb handlers and tests"
```

---

## Task 3: Wire `formats/index.js`

**Files:**
- Create: `frontend/src/js/formats/index.js`

- [ ] **Step 3.1: Write `frontend/src/js/formats/index.js`**

```js
/**
 * Format registry entry point.
 *
 * Importing this module registers the built-in glTF/GLB handlers.
 * ESM module caching makes this idempotent.
 */

import { registerFormatHandler } from "./registry.js";
import { gltfHandler } from "./handlers/gltf-handler.js";
import { glbHandler } from "./handlers/glb-handler.js";

registerFormatHandler(gltfHandler);
registerFormatHandler(glbHandler);

export {
  registerFormatHandler,
  getFormatHandler,
  detectAssetFormat,
  resolveFormatHandler,
  listFormatHandlers,
  _resetFormatRegistry,
} from "./registry.js";
```

- [ ] **Step 3.2: Verify built-ins load without error**

```bash
node --check frontend/src/js/formats/index.js
```

**Expected:** exits 0.

- [ ] **Step 3.3: Commit**

```bash
git add frontend/src/js/formats/index.js
git commit -m "feat(formats): wire built-in handler registration"
```

---

## Task 4: Refactor `scene-loader.js`

**Files:**
- Modify: `frontend/src/js/engine/scene-loader.js:10-36` (imports)
- Modify: `frontend/src/js/engine/scene-loader.js:37-111` (`loadAsset`)

- [ ] **Step 4.1: Update imports**

Replace:
```js
import {
  getFromRemoteIPFS,
  getBlobFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { composeGlTFToBlobAsync } from "../gltf/async-gltf.js";
```

With:
```js
import { resolveFormatHandler } from "../formats/index.js";
```

Keep the `detectAssetFormat` import from `transforms.js` for the log line, or replace the log line with `resolveFormatHandler(src).format`.

- [ ] **Step 4.2: Replace `loadAsset` body**

Replace the entire `loadAsset` function (lines 37-111) with:

```js
async function loadAsset(src, parentNode, nodeId) {
  const cid = extractCid(src);
  const handler = resolveFormatHandler(src);
  console.log(`[SCENE] loadAsset nodeId=${nodeId} cid=${cid} format=${handler.format}`);

  try {
    const result = await handler.load(src, {
      scene: state.scene,
      cid,
      importFromBlob,
    });
    attachMetadata(
      result.meshes,
      nodeId,
      parentNode,
      result.transformNodes || []
    );
    return result.meshes;
  } catch (error) {
    console.error(`[SCENE] FAILED to load asset for node ${nodeId}:`, error);
    const box = BABYLON.MeshBuilder.CreateBox(
      `placeholder_${nodeId}`,
      { size: 1 },
      state.scene
    );
    box.parent = parentNode;
    box.metadata = { nodeId };
    applyDefaultMaterial([box]);
    return [box];
  }
}

async function importFromBlob(blob, extension) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const result = await BABYLON.SceneLoader.ImportMeshAsync(
      "",
      blobUrl,
      "",
      state.scene,
      null,
      extension
    );
    return {
      meshes: result.meshes,
      transformNodes: result.transformNodes || [],
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
```

- [ ] **Step 4.3: Run scene-loader related tests**

```bash
npx jest test/frontend/scene-graph-new-asset.test.js test/scene-graph.test.js --runInBand
```

**Expected:** all green.

- [ ] **Step 4.4: Run build and build.test.js**

```bash
npm run build:frontend
npx jest test/frontend/build.test.js --runInBand
```

**Expected:** build exits 0; build.test.js passes.

- [ ] **Step 4.5: Commit**

```bash
git add frontend/src/js/engine/scene-loader.js
git commit -m "refactor(scene-loader): dispatch asset load through format handler"
```

---

## Task 5: Refactor `manifest-builder.js`

**Files:**
- Modify: `frontend/src/js/services/asset-save/manifest-builder.js` (imports, `looksComposite`, `_decomposeOneNode`, `buildDedupMapFromManifests`, pendingColors loop, pp bake)

- [ ] **Step 5.1: Update imports**

Replace:
```js
import {
  decomposeAndStoreAsync,
  decomposeGLBAsync,
  editSourceColorsAsync,
} from "../../gltf/async-gltf.js";
import { editCompositeColors } from "../../gltf/material-editor.js";
```

With:
```js
import { resolveFormatHandler } from "../../formats/index.js";
```

Drop `getArrayBufferFromRemoteIPFS` from the `remote-ipfs.js` import if it becomes unused. Keep `getFromRemoteIPFS` and `writeJSONToIPFS`.
Drop `isComposite` from the `decomposer.js` import (it is no longer used directly).

- [ ] **Step 5.2: Rename `looksComposite` to `looksStored` and delegate**

Replace:
```js
function looksComposite(node) {
  if (!node.source?.cid || node.child_ref) return false;
  if (_verifiedCompositeCids.has(node.source.cid)) return true;
  const format = (node.source.format || "gltf").toLowerCase();
  return format === "gltf" && node.source.path === "composite.gltf";
}
```

With:
```js
function looksStored(node) {
  if (!node.source?.cid || node.child_ref) return false;
  if (_verifiedCompositeCids.has(node.source.cid)) return true;
  return resolveFormatHandler(node.source).isStoredForm(node);
}
```

- [ ] **Step 5.3: Update `_decomposeOneNode` body**

Inside `_decomposeOneNode`, after the `looksStored` fast-path check (which should now call `looksStored`), replace the GLB branch + glTF branch with:

```js
  try {
    const handler = resolveFormatHandler(node.source);
    const result = await handler.decomposeForSave(node, {
      assetName: manifest.name,
      assetId: manifest.asset_id,
      dedupMap,
    });
    if (!result) return null;
    if (result.normalizeOnly) {
      _verifiedCompositeCids.add(result.cid);
      return {
        nodeId: node.node_id,
        cid: result.cid,
        path: "composite.gltf",
        format: "gltf",
        normalizeOnly: true,
      };
    }
    _verifiedCompositeCids.add(result.cid);
    return {
      nodeId: node.node_id,
      cid: result.cid,
      path: result.path,
      format: result.format,
    };
  } catch (err) {
    if (isRateLimitError(err)) throw err;
    warn(
      `Decompose save: failed to decompose node ${node.node_id}:`,
      err.message
    );
    return null;
  }
```

- [ ] **Step 5.4: Update `buildDedupMapFromManifests` filter**

Replace:
```js
      .filter(
        (n) =>
          n.source?.cid &&
          (n.source.path === "composite.gltf" || n.source.format === "gltf")
      )
```

With:
```js
      .filter(
        (n) =>
          n.source?.cid &&
          (resolveFormatHandler(n.source).isDedupSource?.(n) ?? false)
      )
```

- [ ] **Step 5.5: Route pending source-color edits through handler**

Replace the direct `editSourceColorsAsync(...)` call inside the `pendingColors.size > 0` loop with:

```js
            const handler = resolveFormatHandler(node.source);
            if (typeof handler.editSourceColors !== "function") {
              warn(
                `Save: source-color edit unsupported for format ${handler.format} | node=${nodeId}`
              );
              return null;
            }
            const result = await handler.editSourceColors(node, colorMap, {
              assetName: manifest.name,
              assetId: manifest.asset_id,
              dedupMap,
            });
```

- [ ] **Step 5.6: Route post-processor composite bake through handler**

Replace:
```js
      const isDecomposed =
        node.source?.path === "composite.gltf" && node.source?.cid;
```

With:
```js
      const isDecomposed =
        !!node.source?.cid && resolveFormatHandler(node.source).isStoredForm(node);
```

And replace the direct `editCompositeColors(...)` call with:

```js
            const handler = resolveFormatHandler(node.source);
            if (typeof handler.editCompositeColors !== "function") {
              // Fall through to overlay path by returning null.
              return { nodeId, pp, result: null };
            }
            result = await handler.editCompositeColors(
              node,
              pp.meshOverrides || null,
              pp.color || null,
              {
                assetName: manifest.name,
                assetId: manifest.asset_id,
              }
            );
```

- [ ] **Step 5.7: Update `decomposeManifestNodes` result application**

Ensure it still handles `normalizeOnly`:
```js
    if (!r.value.normalizeOnly) decomposed++;
```
(already present; verify it remains.)

- [ ] **Step 5.8: Update the `needsDedup` computation**

Replace:
```js
  const needsDedup =
    pendingColors.size > 0 ||
    sourceNodes.some((n) => !looksComposite(n));
```

With:
```js
  const needsDedup =
    pendingColors.size > 0 ||
    sourceNodes.some((n) => !looksStored(n));
```

- [ ] **Step 5.9: Run manifest-builder and asset-save tests**

```bash
npx jest test/frontend/manifest-builder.test.js test/frontend/asset-save-core.test.js test/frontend/asset-save.test.js --runInBand
```

**Expected:** all green.

- [ ] **Step 5.10: Run typecheck**

```bash
npm run typecheck:frontend
```

**Expected:** exits 0.

- [ ] **Step 5.11: Commit**

```bash
git add frontend/src/js/services/asset-save/manifest-builder.js
git commit -m "refactor(manifest-builder): decompose and color edits via format handler"
```

---

## Task 6: Re-export `detectAssetFormat` from `transforms.js`

**Files:**
- Modify: `frontend/src/js/engine/transforms.js:22-30`

- [ ] **Step 6.1: Replace inline function with re-export**

Replace:
```js
/**
 * Detect the asset format from its source reference.
 */
export function detectAssetFormat(src) {
  if (src && typeof src === "object" && src.format) {
    return src.format.toLowerCase();
  }
  return "gltf";
}
```

With:
```js
export { detectAssetFormat } from "../formats/registry.js";
```

- [ ] **Step 6.2: Run tests that import `detectAssetFormat`**

```bash
npx jest test/scene-graph.test.js test/frontend/scene-graph-new-asset.test.js --runInBand
```

**Expected:** all green.

- [ ] **Step 6.3: Commit**

```bash
git add frontend/src/js/engine/transforms.js
git commit -m "refactor(transforms): re-export detectAssetFormat from formats registry"
```

---

## Task 7: Example format handler and extension test

**Files:**
- Create: `frontend/src/js/formats/handlers/example-format.js`
- Create: `test/frontend/format-example-handler.test.js`

- [ ] **Step 7.1: Write `frontend/src/js/formats/handlers/example-format.js`**

```js
// @ts-check
/**
 * Dummy/template format handler.
 *
 * This handler is intentionally NOT imported by `formats/index.js`.
 * It exists as a copy-paste template for adding real formats (e.g. 3MF)
 * and is registered only inside its own test to prove the extension point.
 */

/** @typedef {import("../registry.js").FormatHandler} FormatHandler */

/**
 * Factory so tests can inject spies.
 *
 * @returns {FormatHandler}
 */
export function createExampleFormatHandler() {
  return {
    format: "example",
    extensions: [".example"],

    /**
     * Sniff bytes to decide if this handler owns a raw file.
     * Optional: omit if the format is only identified by `src.format`.
     */
    sniff(bytes) {
      return (
        bytes.length >= 7 &&
        new TextDecoder().decode(bytes.slice(0, 7)) === "EXAMPLE"
      );
    },

    /**
     * Load the asset into the Babylon scene.
     *
     * @param {any} src
     * @param {import("../registry.js").FormatLoadContext} ctx
     */
    async load(src, ctx) {
      // Real implementation would fetch the source bytes, convert to a
      // Babylon-loadable form (e.g. glTF Blob), then call ctx.importFromBlob.
      console.log(`[EXAMPLE] load called for cid=${ctx.cid}`);
      return { meshes: [], transformNodes: [] };
    },

    /**
     * Prepare the source for persistence.
     *
     * Strategy A: convert to composite glTF and return
     * `{ path: "composite.gltf", format: "gltf" }`.
     *
     * Strategy B: keep the native format and return
     * `{ path: "asset.example", format: "example" }`.
     * The loader must then know how to load that stored form.
     *
     * @param {any} node
     * @param {import("../registry.js").FormatSaveContext} ctx
     */
    async decomposeForSave(node, ctx) {
      console.log(
        `[EXAMPLE] decompose called | cid=${node.source.cid} asset=${ctx.assetName}`
      );
      return {
        cid: node.source.cid,
        path: "asset.example",
        format: "example",
      };
    },

    /**
     * Predicate: does this node already point to the stored form?
     */
    isStoredForm(node) {
      return (
        node.source?.format === "example" &&
        node.source?.path === "asset.example"
      );
    },

    /**
     * Optional: contribute this node to the hash->CID dedup map.
     */
    isDedupSource() {
      return false;
    },
  };
}
```

- [ ] **Step 7.2: Write `test/frontend/format-example-handler.test.js`**

```js
/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  registerFormatHandler,
  _resetFormatRegistry,
} from "../../frontend/src/js/formats/registry.js";
import { createExampleFormatHandler } from "../../frontend/src/js/formats/handlers/example-format.js";

jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: jest.fn(),
}));

const { getFromRemoteIPFS } = await import(
  "../../frontend/src/js/ipfs/remote-ipfs.js"
);

describe("example format handler extension point", () => {
  afterEach(() => {
    _resetFormatRegistry();
    jest.clearAllMocks();
  });

  it("is not registered by formats/index.js", async () => {
    const { listFormatHandlers } = await import(
      "../../frontend/src/js/formats/index.js"
    );
    const formats = listFormatHandlers().map((h) => h.format);
    expect(formats).toContain("gltf");
    expect(formats).toContain("glb");
    expect(formats).not.toContain("example");
  });

  it("can be registered and used for decompose without touching core code", async () => {
    const handler = createExampleFormatHandler();
    handler.decomposeForSave = jest.fn().mockResolvedValue({
      cid: "bafyExample",
      path: "asset.example",
      format: "example",
    });
    registerFormatHandler(handler);

    const { decomposeManifestNodes } = await import(
      "../../frontend/src/js/services/asset-save/manifest-builder.js"
    );

    const manifest = {
      name: "Test",
      asset_id: "asset_1",
      scene: {
        nodes: [
          {
            node_id: "n1",
            source: { cid: "bafyInput", format: "example" },
          },
        ],
      },
    };

    await decomposeManifestNodes(manifest, new Map(), new Map());

    expect(handler.decomposeForSave).toHaveBeenCalledTimes(1);
    expect(manifest.scene.nodes[0].source).toEqual({
      cid: "bafyExample",
      path: "asset.example",
      format: "example",
    });
  });
});
```

- [ ] **Step 7.3: Run the example handler test**

```bash
npx jest test/frontend/format-example-handler.test.js --runInBand
```

**Expected:** all green.

- [ ] **Step 7.4: Commit**

```bash
git add frontend/src/js/formats/handlers/example-format.js test/frontend/format-example-handler.test.js
git commit -m "feat(formats): add example format handler template and extension test"
```

---

## Task 8: Write `docs/FORMAT_HANDLERS.md`

**Files:**
- Create: `docs/FORMAT_HANDLERS.md`

- [ ] **Step 8.1: Write the documentation**

```markdown
# Arbesk Format Handlers

Arbesk's 3D asset pipeline is format-agnostic at the dispatch layer. Adding support for a new format means writing one handler module and registering it.

## Built-in handlers

- `gltf` — loose glTF JSON assets (`frontend/src/js/formats/handlers/gltf-handler.js`)
- `glb` — binary glTF assets (`frontend/src/js/formats/handlers/glb-handler.js`)

Both are registered automatically by `frontend/src/js/formats/index.js`.

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
The built-in handlers store decomposed assets as:

```json
{ "format": "gltf", "path": "composite.gltf" }
```

A 3MF handler could either:

1. **Converge on glTF** — `decomposeForSave` converts to glTF, stores it as `composite.gltf`, and returns `{ format: "gltf", path: "composite.gltf" }`.
2. **Keep native form** — return `{ format: "3mf", path: "asset.3mf" }` and implement `load` to load `.3mf` files directly.

## Adding a format in four steps

1. Copy `frontend/src/js/formats/handlers/example-format.js` to a new file.
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
```

- [ ] **Step 8.2: Commit**

```bash
git add docs/FORMAT_HANDLERS.md
git commit -m "docs: add FORMAT_HANDLERS interface guide"
```

---

## Final verification

- [ ] **Step F.1: Typecheck**

```bash
npm run typecheck:frontend
```

**Expected:** exits 0.

- [ ] **Step F.2: Unit tests**

```bash
npm test
```

**Expected:** `Test Suites: 82 passed, 82 total` (or 85 with the three new suites) and all tests green.

- [ ] **Step F.3: Frontend build**

```bash
npm run build:frontend
npx jest test/frontend/build.test.js --runInBand
```

**Expected:** build exits 0; build.test.js passes.

- [ ] **Step F.4: E2E critical path**

Ensure no stale backend on the worktree port:

```bash
./scripts/start-dev.sh --setup-only
```

Then run:

```bash
npm run test:e2e -- --project=chromium
```

**Expected:** all E2E specs green. If failures occur, diagnose whether they are caused by the format changes or by environment/port conflicts.

- [ ] **Step F.5: Final commit**

```bash
git add -A
git status --short
git commit -m "feat(formats): pluggable format-handler registry (GLTF/GLB + example)"
```

---

## Self-review checklist

- [ ] Every spec requirement from the original plan maps to a task above.
- [ ] No placeholders ("TBD", "TODO", "implement later") remain.
- [ ] File paths are exact and exist in the codebase.
- [ ] Type names (`FormatHandler`, `FormatLoadContext`, etc.) match between `registry.js`, handlers, and docs.
- [ ] `_verifiedCompositeCids`, rate-limit rethrow, and `normalizeOnly` semantics are preserved.
- [ ] `example-format.js` is not imported by `formats/index.js`.

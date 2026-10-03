# CAD provider for @arbesk/ai-asset-gen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@arbesk/cad-gen` a first-class provider (`"cad"`) of `@arbesk/ai-asset-gen` — design-on-the-wire through the existing `/api/v1/generations` pipeline — behind an IoC provider registry, plus a `meshToGltf` exporter in cad-gen.

**Architecture:** Keep the `GenerationProvider` facade; replace the if/else factory with `createProviderRegistry(factories)` (factories injected at the composition root). The cad provider collapses the task lifecycle in-process (mock precedent), returns the `CadDesign` document with `format: "cad-design"`, and keeps its task store at module scope because the poll/DELETE handlers rebuild the provider per request. The backend cad branch owns metering via an `onSettle` callback (cad-quota slot release + unsuitable refund).

**Tech Stack:** Bun + TypeScript (erasable syntax only), Hono, bun:test + supertest, `@arbesk/cad-gen` (workspace `*`), `@arbesk/asset-core` (transitively, for `serializeGLB`).

**Spec:** `docs/superpowers/specs/2026-10-04-cad-gen-provider-design.md` — read it first; this plan argues from it.

## Global Constraints

- Backend `src/` and packages: erasable TypeScript only — no enums/namespaces; type-only imports MUST use `import type`; relative imports carry explicit `.ts` extensions.
- Import specifiers: SDK packages by bare specifier with `.js` subpaths (e.g. `@arbesk/ai-asset-gen/index.js`, `@arbesk/cad-gen/backend/index.js`). The test preload (`test/bun.setup.js`) maps `@arbesk/*` to package **sources** — no package build needed for `bun run test`.
- `bun run test` runs each file in its own process (`scripts/run-tests.mjs`); `mock.module()` is process-global — re-mocking a module requires restoring for later tests.
- ESLint package boundaries are enforced: `packages/ai-asset-gen` may NOT import `frontend/`, `src/api/`, `constants/`; importing `@arbesk/cad-gen` is now allowed (that boundary change is Task 3 and its AGENTS.md update is part of the task).
- No new external npm dependencies. `@arbesk/cad-gen` is added as `"*"` (workspace), matching how cad-gen depends on asset-core.
- New files carry the package's doc-comment style (the surrounding files are heavily documented; match them). No comments that restate what the code plainly does.
- Pre-commit hook runs `fallow audit --changed-since HEAD`; keep the changeset clean.
- Provider id is exactly `"cad"`; cad poll success `format` is exactly `"cad-design"`; unsuitable error code is exactly `"CAD_REQUEST_UNSUITABLE"`.
- `bun run lint && bun run typecheck` must pass before every commit (typecheck runs `build:packages` first via pretypecheck).

---

### Task 1: Provider registry in @arbesk/ai-asset-gen

**Files:**
- Create: `packages/ai-asset-gen/src/registry.ts`
- Modify: `packages/ai-asset-gen/src/facade.ts:60-63` (re-implement `createGenerationProvider` on the default registry)
- Modify: `packages/ai-asset-gen/src/index.ts` (exports)
- Test: `test/ai-asset-gen/registry.test.js`

**Interfaces:**
- Consumes: `GenerationConfig`, `GenerationProvider` from `packages/ai-asset-gen/src/facade.ts`; `createMockProvider` (`providers/mock-provider.ts`), `createTripoProvider` (`providers/tripo-provider.ts`).
- Produces (Task 4 uses these):
  - `export type ProviderFactory = (config: GenerationConfig) => GenerationProvider`
  - `export interface ProviderRegistry { resolve(id: string, config: GenerationConfig): GenerationProvider }`
  - `export function createProviderRegistry(factories: Readonly<Record<string, ProviderFactory>>): ProviderRegistry`
  - `createGenerationProvider(config)` — signature and behavior unchanged for callers: resolves `"mock"`/`"tripo3d"`, throws `Error("unknown generation provider: " + id)` otherwise.

- [ ] **Step 1: Write the failing test**

Create `test/ai-asset-gen/registry.test.js`:

```js
/**
 * Provider registry: construction by injection.
 */
import { describe, expect, it } from "bun:test";
import {
  createGenerationProvider,
  createMockProvider,
  createProviderRegistry,
} from "@arbesk/ai-asset-gen/index.js";

describe("createProviderRegistry", () => {
  it("resolves a registered id through its factory with the config passed through", () => {
    const registry = createProviderRegistry({ mock: (config) => createMockProvider(config) });
    const provider = registry.resolve("mock", { id: "mock", capabilities: ["text-to-3d"] });
    expect(provider.id).toBe("mock");
    expect(provider.can("text-to-3d")).toBe(true);
    expect(provider.can("retopo")).toBe(false);
  });

  it("throws the historical message for an unknown id", () => {
    const registry = createProviderRegistry({});
    expect(() => registry.resolve("nope", { id: "nope", capabilities: [] }))
      .toThrow("unknown generation provider: nope");
  });
});

describe("createGenerationProvider (default registry)", () => {
  it("still resolves mock and tripo3d", () => {
    const mock = createGenerationProvider({ id: "mock", capabilities: ["text-to-3d"] });
    expect(mock.id).toBe("mock");
    const tripo = createGenerationProvider({ id: "tripo3d", capabilities: ["text-to-3d"] });
    expect(tripo.id).toBe("tripo3d");
  });

  it("still throws for an unknown id", () => {
    expect(() => createGenerationProvider({ id: "cad", capabilities: ["text-to-3d"] }))
      .toThrow("unknown generation provider: cad");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/ai-asset-gen/registry.test.js`
Expected: FAIL — `createProviderRegistry` is not exported from `@arbesk/ai-asset-gen/index.js` (SyntaxError/undefined at import).

- [ ] **Step 3: Implement**

Create `packages/ai-asset-gen/src/registry.ts`:

```ts
/**
 * Provider registry — provider construction by injection.
 * @remarks The composition root supplies the factories, so adding a provider
 *   never modifies this module (or the facade's default convenience).
 */
import type { GenerationConfig, GenerationProvider } from "./facade.ts";

export type ProviderFactory = (config: GenerationConfig) => GenerationProvider;

export interface ProviderRegistry {
  resolve(id: string, config: GenerationConfig): GenerationProvider;
}

export function createProviderRegistry(
  factories: Readonly<Record<string, ProviderFactory>>,
): ProviderRegistry {
  return {
    resolve(id, config) {
      const factory = factories[id];
      if (!factory) throw new Error("unknown generation provider: " + id);
      return factory(config);
    },
  };
}
```

In `packages/ai-asset-gen/src/facade.ts`, replace the if/else factory (lines 60-63) and add the import:

```ts
import { createProviderRegistry } from "./registry.ts";
```

```ts
const defaultRegistry = createProviderRegistry({
  mock: (config) => createMockProvider(config),
  tripo3d: (config) => createTripoProvider(config),
});

export function createGenerationProvider(config: GenerationConfig): GenerationProvider {
  return defaultRegistry.resolve(config.id, config);
}
```

In `packages/ai-asset-gen/src/index.ts`, add:

```ts
export { createProviderRegistry } from "./registry.ts";
export type { ProviderFactory, ProviderRegistry } from "./registry.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/ai-asset-gen/registry.test.js`
Expected: PASS (4 tests). Also run `bun run test -- test/api.test.js` — the mock generation suites must stay green (they exercise `createGenerationProvider` through the route).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-asset-gen/src/registry.ts packages/ai-asset-gen/src/facade.ts packages/ai-asset-gen/src/index.ts test/ai-asset-gen/registry.test.js
git commit -m "feat(ai-asset-gen): provider registry — construction by injection"
```

---

### Task 2: meshToGltf exporter in @arbesk/cad-gen

**Files:**
- Modify: `packages/cad-gen/src/core/export/glb.ts` (extract the shared document builder)
- Create: `packages/cad-gen/src/core/export/gltf.ts`
- Modify: `packages/cad-gen/src/index.ts:27` (barrel export)
- Modify: `packages/cad-gen/package.json` (description: "glTF/GLB/3MF")
- Modify: `packages/cad-gen/AGENTS.md` (Exporters section)
- Test: `test/cad-gen/exporters.test.js` (new `describe("meshToGltf")`)

**Interfaces:**
- Consumes: `serializeGLB` from `@arbesk/asset-core/formats/gltf/gltf-core.js`; `CadDesign`, `CadMesh` from `packages/cad-gen/src/types.ts`; existing `meshToGlb` behavior (unchanged — GLB bytes must be byte-for-byte as before; only construction is refactored).
- Produces (the follow-up browser worker consumes this later; nothing consumes it in this changeset):
  - `export function buildPartDocument(mesh: CadMesh, design: CadDesign): { gltf: Record<string, unknown>; bin: Uint8Array }` (internal to the export dir, exported for gltf.ts)
  - `export function meshToGltf(mesh: CadMesh, design: CadDesign): string` — self-contained glTF 2.0 JSON; `buffers[0].uri` is a `data:application/octet-stream;base64,...` URI; `asset.extras.arbesk_cad`/`arbesk_units` sidecar identical to the GLB's.

- [ ] **Step 1: Write the failing test**

Append to `test/cad-gen/exporters.test.js`:

```js
describe("meshToGltf", () => {
  const b64ToBytes = (b64) =>
    Uint8Array.from(Buffer.from(b64.slice("data:application/octet-stream;base64,".length), "base64"));

  it("writes self-contained glTF 2.0 JSON with the buffer as a data URI", () => {
    const json = JSON.parse(meshToGltf(MESH, DESIGN));
    expect(json.asset.version).toBe("2.0");
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0].uri.startsWith("data:application/octet-stream;base64,")).toBe(true);
    const bin = b64ToBytes(json.buffers[0].uri);
    expect(bin.length).toBe(json.buffers[0].byteLength);
    expect(json.buffers[0].byteLength).toBeGreaterThan(0);
  });

  it("produces the same document as the GLB path (buffers aside)", () => {
    const gltf = JSON.parse(meshToGltf(MESH, DESIGN));
    const glbJson = readGlbJson(meshToGlb(MESH, DESIGN));
    const stripBuffers = (doc) => {
      const { buffers, ...rest } = doc;
      return rest;
    };
    expect(stripBuffers(gltf)).toEqual(stripBuffers(glbJson));
  });

  it("embeds the design document in asset extras", () => {
    const json = JSON.parse(meshToGltf(MESH, DESIGN));
    expect(json.asset.extras.arbesk_cad.code).toBe(DESIGN.code);
    expect(json.asset.extras.arbesk_units).toBe("mm");
  });

  it("keeps the binary chunk byte-identical to the GLB path", () => {
    const gltf = JSON.parse(meshToGltf(MESH, DESIGN));
    const fromGltf = b64ToBytes(gltf.buffers[0].uri);

    const glb = meshToGlb(MESH, DESIGN);
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jsonLength = view.getUint32(12, true);
    const binLength = view.getUint32(20 + jsonLength, true);
    const fromGlb = glb.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binLength);

    expect(fromGltf.length).toBe(fromGlb.length);
    expect(Buffer.from(fromGltf).equals(Buffer.from(fromGlb))).toBe(true);
  });
});
```

Add `meshToGltf` to the existing import from `"@arbesk/cad-gen"` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/exporters.test.js`
Expected: FAIL — `meshToGltf` is not exported from `@arbesk/cad-gen`.

- [ ] **Step 3: Implement**

In `packages/cad-gen/src/core/export/glb.ts`: keep `computeNormals`, `bytesOf`, `positionBounds`, `packChunk`, and `MM_TO_M_Z_UP_TO_Y_UP` as-is. Replace the `meshToGlb` body with a shared builder (move the gltf object construction into it) and re-export the builder:

```ts
/**
 * Builds the shared glTF document plus its binary chunk.
 * @remarks meshToGlb wraps this in a GLB container; meshToGltf (gltf.ts)
 *   embeds the chunk as a base64 data URI. One builder means the two formats
 *   cannot drift apart.
 */
export function buildPartDocument(mesh: CadMesh, design: CadDesign) {
  const normals = computeNormals(mesh);
  const indexBytes = bytesOf(mesh.indices);
  const posBytes = bytesOf(mesh.positions);
  const normalBytes = bytesOf(normals);
  const { bin, posOffset, normalOffset } = packChunk(indexBytes, posBytes, normalBytes);
  const bounds = positionBounds(mesh.positions);

  const gltf = {
    asset: {
      version: "2.0",
      generator: "arbesk-cad-gen",
      extras: { arbesk_cad: design, arbesk_units: "mm" },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, matrix: MM_TO_M_Z_UP_TO_Y_UP, name: "cad_part" }],
    meshes: [{
      primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }],
    }],
    materials: [{
      name: "cad_default",
      pbrMetallicRoughness: {
        baseColorFactor: [0.75, 0.76, 0.78, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes.length, target: 34963 },
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
      {
        bufferView: 1, componentType: 5126, count: mesh.positions.length / 3, type: "VEC3",
        min: bounds.min, max: bounds.max,
      },
      { bufferView: 2, componentType: 5126, count: normals.length / 3, type: "VEC3" },
    ],
  };

  return { gltf, bin };
}

export function meshToGlb(mesh: CadMesh, design: CadDesign): Uint8Array {
  const { gltf, bin } = buildPartDocument(mesh, design);
  return new Uint8Array(serializeGLB(gltf as never, bin));
}
```

Create `packages/cad-gen/src/core/export/gltf.ts`:

```ts
/**
 * Mesh to self-contained glTF JSON, for previewing a CAD part.
 * @remarks Same document as the GLB export (buildPartDocument) — the binary
 *   chunk rides as a base64 data URI, so one string carries the whole part
 *   plus the design sidecar. Matches how the platform handles .gltf assets
 *   (base64 data URIs at render, ipfs:// refs in storage after the
 *   asset-core composer runs).
 */
import type { CadDesign, CadMesh } from "../../types.ts";
import { buildPartDocument } from "./glb.ts";

export function meshToGltf(mesh: CadMesh, design: CadDesign): string {
  const { gltf, bin } = buildPartDocument(mesh, design);
  gltf.buffers[0].uri = "data:application/octet-stream;base64," + Buffer.from(bin).toString("base64");
  return JSON.stringify(gltf);
}
```

Note: `Buffer` is a Node global; cad-gen core must stay environment-agnostic (the browser bundles it). Use a base64 helper that works in both. Add to `gltf.ts` instead of `Buffer`:

```ts
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
```

and `"data:application/octet-stream;base64," + toBase64(bin)`. (`btoa` exists in Node ≥ 16 and browsers.)

In `packages/cad-gen/src/index.ts`, add next to the `meshToGlb` export:

```ts
export { meshToGltf } from "./core/export/gltf.ts";
```

In `packages/cad-gen/package.json`, update the description: `"Arbesk engineering-CAD generation SDK: Manifold-script codegen, static guard, kernel port and glTF/GLB/3MF exporters. Environment-agnostic core plus a Node-only backend."`

In `packages/cad-gen/AGENTS.md` §Exporters, add a bullet:

```md
- `meshToGltf(mesh, design)` — self-contained glTF JSON (the binary chunk as
  a base64 data URI), same `buildPartDocument` as the GLB, so the two cannot
  drift. This is the client-side render target of the generation pipeline.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/exporters.test.js`
Expected: PASS (all pre-existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cad-gen/src/core/export/glb.ts packages/cad-gen/src/core/export/gltf.ts packages/cad-gen/src/index.ts packages/cad-gen/package.json packages/cad-gen/AGENTS.md test/cad-gen/exporters.test.js
git commit -m "feat(cad-gen): meshToGltf — self-contained glTF export sharing the GLB document builder"
```

---

### Task 3: Cad provider in @arbesk/ai-asset-gen

**Files:**
- Modify: `packages/ai-asset-gen/package.json` (add `"@arbesk/cad-gen": "*"` dependency; update description)
- Create: `packages/ai-asset-gen/src/providers/cad-provider.ts`
- Modify: `packages/ai-asset-gen/src/index.ts` (exports)
- Modify: `package.json:24` (root `build:packages` — ai-asset-gen moves to a final wave, after cad-gen)
- Modify: `packages/ai-asset-gen/AGENTS.md` (boundary + facade section)
- Modify: `packages/AGENTS.md` (dependency-order diagram)
- Test: `test/ai-asset-gen/cad-provider.test.js`

**Interfaces:**
- Consumes: `GenerationConfig`, `GenerationProvider` from `../facade.ts`; `requireCapability` from `../errors.ts`; `GenerationCapability` from `../types.ts`; `CadGenerator`, `CadGenerateResult` (types) from `@arbesk/cad-gen/backend/index.js`; `CadRequestUnsuitable` (value) from `@arbesk/cad-gen`.
- Produces (Task 4 consumes these exact names):
  - `export interface CadProviderOptions { config: GenerationConfig; generator: CadGenerator; onSettle?: (taskId: string, outcome: CadSettleOutcome) => void }`
  - `export type CadSettleOutcome = { ok: true; result: CadGenerateResult } | { ok: false; error: { message: string; code?: string; suitability?: number; alternative?: unknown } }`
  - `export function createCadProvider(options: CadProviderOptions): GenerationProvider`
  - `export function cadWireResult(result: CadGenerateResult): { design; runtime; provider; attribution; diagnostics }`
  - Provider behavior: `textToModel` returns `cad-<uuid>` immediately and runs `generator.generate({ prompt, signal })` detached; `poll` → running `{ status: "running", progress: 0 }` / success `{ status: "success", format: "cad-design", output: CadGenerateResult }` / failed `{ status: "failed", error, output: errorDetails }`; `download(taskId)` → wire-result JSON bytes; `cancel(taskId)` → abort + delete; everything else throws via `requireCapability` (and `uploadSource` throws `Error("cad provider has no source upload")`).

- [ ] **Step 1: Write the failing test**

Create `test/ai-asset-gen/cad-provider.test.js`:

```js
/**
 * CAD provider: design-on-the-wire lifecycle over an injected CadGenerator.
 */
import { describe, expect, it, jest } from "bun:test";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import { createCadProvider } from "@arbesk/ai-asset-gen/index.js";

const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 1,
};

const RESULT = {
  design: DESIGN,
  runtime: { contractVersion: 1, preludeVersion: "2026-09-16" },
  provider: { id: "deepseek", model: "deepseek-flash" },
  attribution: [],
  diagnostics: {
    selection: { libraries: [], fit: {}, jevTokens: {} },
    attempts: [],
    durationMs: 5,
    tokens: { prompt: 1, completion: 1 },
  },
};

const CONFIG = { id: "cad", capabilities: ["text-to-3d"] };

/** A generator whose single call the test gates manually. */
function gatedGenerator() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const generate = jest.fn(async (input) => {
    await gate;
    return RESULT;
  });
  return { generate, release };
}

async function until(predicate, what = "condition") {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(what + " never became true");
}

describe("createCadProvider", () => {
  it("runs the full lifecycle: running → success with the design in output", async () => {
    const { generate, release } = gatedGenerator();
    const onSettle = jest.fn();
    const provider = createCadProvider({ config: CONFIG, generator: { generate }, onSettle });

    const taskId = await provider.textToModel({ prompt: "a 10mm cube" });
    expect(taskId).toMatch(/^cad-/);

    const running = await provider.poll(taskId);
    expect(running.status).toBe("running");

    release();
    await until(() => onSettle.mock.calls.length === 1, "settle");
    const settled = await provider.poll(taskId);
    expect(settled.status).toBe("success");
    expect(settled.format).toBe("cad-design");
    expect(settled.output.design.code).toBe(DESIGN.code);
    expect(settled.output.provider.id).toBe("deepseek");

    const bytes = await provider.download(taskId);
    const wire = JSON.parse(new TextDecoder().decode(bytes));
    expect(wire.design).toEqual(DESIGN);
    expect(wire.runtime).toEqual(RESULT.runtime);
    expect(wire.attribution).toEqual([]);
    expect(wire.diagnostics).toEqual(RESULT.diagnostics);

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle.mock.calls[0][0]).toBe(taskId);
    expect(onSettle.mock.calls[0][1].ok).toBe(true);
  });

  it("passes an AbortSignal to the generator and aborts it on cancel", async () => {
    const generate = jest.fn(async (input) => {
      await new Promise((resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return RESULT;
    });
    const provider = createCadProvider({ config: CONFIG, generator: { generate } });
    const taskId = await provider.textToModel({ prompt: "x" });
    expect(generate.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);

    expect(await provider.cancel(taskId)).toBe(true);
    expect(generate.mock.calls[0][0].signal.aborted).toBe(true);
    expect(await provider.cancel(taskId)).toBe(false);
    expect((await provider.poll(taskId)).status).toBe("failed");
  });

  it("maps CadRequestUnsuitable to a coded failure", async () => {
    const generate = jest.fn(async () => {
      throw new CadRequestUnsuitable("organic subject", 0.12);
    });
    const onSettle = jest.fn();
    const provider = createCadProvider({ config: CONFIG, generator: { generate }, onSettle });

    const taskId = await provider.textToModel({ prompt: "a dragon" });
    await until(() => onSettle.mock.calls.length === 1, "settle");
    const poll = await provider.poll(taskId);
    expect(poll.status).toBe("failed");
    expect(poll.output.code).toBe("CAD_REQUEST_UNSUITABLE");
    expect(poll.output.suitability).toBe(0.12);
    expect(poll.output.alternative).toEqual({ kind: "organic-mesh", provider: "tripo3d" });
    expect(onSettle.mock.calls[0][1].ok).toBe(false);
    expect(onSettle.mock.calls[0][1].error.code).toBe("CAD_REQUEST_UNSUITABLE");
  });

  it("maps a generic failure to a message-only failure", async () => {
    const generate = jest.fn(async () => { throw new Error("provider down"); });
    const provider = createCadProvider({ config: CONFIG, generator: { generate } });
    const taskId = await provider.textToModel({ prompt: "x" });
    await until(async () => (await provider.poll(taskId)).status === "failed", "failure");
    const poll = await provider.poll(taskId);
    expect(poll.error).toBe("provider down");
    expect(poll.output.code).toBeUndefined();
  });

  it("reports failed for an unknown taskId", async () => {
    const provider = createCadProvider({ config: CONFIG, generator: { generate: jest.fn() } });
    expect((await provider.poll("cad-missing")).status).toBe("failed");
    await expect(provider.download("cad-missing")).rejects.toThrow("unknown task");
  });

  it("gates undeclared capabilities", async () => {
    const provider = createCadProvider({ config: CONFIG, generator: { generate: jest.fn() } });
    expect(() => provider.retexture({ prompt: "x", source: { kind: "buffer", buffer: new Uint8Array(), mime: "model/gltf-binary" } }))
      .toThrow(/text-to-3d|retexture|capability/i);
    expect(() => provider.uploadSource({ kind: "buffer", buffer: new Uint8Array(), mime: "model/gltf-binary" }))
      .toThrow("cad provider has no source upload");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/ai-asset-gen/cad-provider.test.js`
Expected: FAIL — `createCadProvider` is not exported from `@arbesk/ai-asset-gen/index.js`.

- [ ] **Step 3: Implement**

Add to `packages/ai-asset-gen/package.json` dependencies (insert in alphabetical order, matching cad-gen's style):

```json
  "dependencies": {
    "@arbesk/cad-gen": "*"
  },
```

Update its description to: `"Arbesk 3D-model generation SDK: a capability-gated facade over the mock, Tripo3D and CAD (design-on-the-wire) providers. Backend-only."`

Run `bun install` to link the workspace dependency.

Create `packages/ai-asset-gen/src/providers/cad-provider.ts`:

```ts
/**
 * CAD provider — design-on-the-wire.
 * @remarks textToModel returns a cad-<uuid> taskId immediately and runs the
 *   injected CadGenerator in-process; poll reports running → success with
 *   the CadGenerateResult in `output` (format "cad-design"), or failed.
 *   The task store is module-level, not per instance: the generations route
 *   rebuilds the provider per request from env (CAD has no BYOK key to
 *   reconstruct with), so the store must outlive any provider instance —
 *   the same process-lifetime guarantee as the route's task registry.
 *   Quota is deliberately NOT handled here: the route owns metering through
 *   the onSettle callback (release the slot; refund CAD_REQUEST_UNSUITABLE).
 */
import type { CadGenerator, CadGenerateResult } from "@arbesk/cad-gen/backend/index.js";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import type { GenerationConfig, GenerationProvider } from "../facade.ts";
import type { GenerationCapability } from "../types.ts";
import { requireCapability } from "../errors.ts";

export interface CadSettleError {
  message: string;
  code?: string;
  suitability?: number;
  alternative?: unknown;
}

export type CadSettleOutcome =
  | { ok: true; result: CadGenerateResult }
  | { ok: false; error: CadSettleError };

export interface CadProviderOptions {
  /** Facade config: id ("cad") + the declared capability set (text-to-3d). */
  config: GenerationConfig;
  /** Injected CAD generator, built from env at the composition root. */
  generator: CadGenerator;
  /** Invoked exactly once per task when the generate call settles. */
  onSettle?: (taskId: string, outcome: CadSettleOutcome) => void;
}

/** The wire shape of a succeeded CAD task (also what download() returns). */
export function cadWireResult(result: CadGenerateResult) {
  return {
    design: result.design,
    runtime: result.runtime,
    provider: result.provider,
    attribution: result.attribution,
    diagnostics: result.diagnostics,
  };
}

interface CadTaskState {
  createdAt: number;
  prompt: string;
  controller: AbortController;
  result?: CadGenerateResult;
  error?: CadSettleError;
}

/** Same TTL as src/api/generation-tasks.ts; swept lazily on access. */
const TASK_TTL_MS = 60 * 60 * 1000;
const tasks = new Map<string, CadTaskState>();

function liveTask(taskId: string): CadTaskState | undefined {
  const state = tasks.get(taskId);
  if (!state) return undefined;
  if (Date.now() - state.createdAt > TASK_TTL_MS) {
    tasks.delete(taskId);
    return undefined;
  }
  return state;
}

export function createCadProvider({ config, generator, onSettle }: CadProviderOptions): GenerationProvider {
  const capabilities = new Set(config.capabilities);
  const id = config.id;

  function unsupported(cap: GenerationCapability): never {
    requireCapability(id, capabilities, cap);
    throw new Error("unreachable");
  }

  /** Captures every rejection into task state — nothing escapes unhandled. */
  async function run(taskId: string, state: CadTaskState): Promise<void> {
    try {
      const result = await generator.generate({
        prompt: state.prompt,
        signal: state.controller.signal,
      });
      state.result = result;
      onSettle?.(taskId, { ok: true, result });
    } catch (err) {
      const e = err as Error & { suitability?: number; alternative?: unknown };
      state.error = e instanceof CadRequestUnsuitable
        ? {
            message: e.message,
            code: "CAD_REQUEST_UNSUITABLE",
            suitability: e.suitability,
            alternative: e.alternative,
          }
        : { message: e.message };
      onSettle?.(taskId, { ok: false, error: state.error });
    }
  }

  return {
    id,
    capabilities,
    can: (cap) => capabilities.has(cap),

    textToModel: async ({ prompt }) => {
      requireCapability(id, capabilities, "text-to-3d");
      const taskId = `cad-${crypto.randomUUID()}`;
      const state: CadTaskState = {
        createdAt: Date.now(),
        prompt,
        controller: new AbortController(),
      };
      tasks.set(taskId, state);
      // Detached by design: the route answers 202 and the client polls.
      void run(taskId, state);
      return taskId;
    },
    imageToModel: () => unsupported("image-to-3d"),
    multiviewToModel: () => unsupported("multiview-to-3d"),
    uploadSource: () => {
      throw new Error("cad provider has no source upload");
    },
    retexture: () => unsupported("retexture"),
    retopo: () => unsupported("retopo"),
    rigCheck: () => unsupported("rig-check"),
    rig: () => unsupported("rig"),
    animate: () => unsupported("animate"),

    poll: async (taskId) => {
      const state = liveTask(taskId);
      if (!state) return { status: "failed", error: "unknown task" };
      if (state.error) return { status: "failed", error: state.error.message, output: state.error };
      if (state.result) {
        return { status: "success", format: "cad-design", output: state.result };
      }
      return { status: "running", progress: 0 };
    },
    download: async (taskIdOrUrl) => {
      if (/^https?:\/\//i.test(taskIdOrUrl)) {
        throw new Error("cad provider has no URLs - pass the taskId");
      }
      const state = liveTask(taskIdOrUrl);
      if (!state?.result) throw new Error("unknown task or task not complete");
      return new TextEncoder().encode(JSON.stringify(cadWireResult(state.result)));
    },
    cancel: async (taskId) => {
      const state = tasks.get(taskId);
      if (!state) return false;
      state.controller.abort();
      tasks.delete(taskId);
      return true;
    },

    getBalance: () => unsupported("balance"),
  };
}
```

In `packages/ai-asset-gen/src/index.ts`, add:

```ts
export { createCadProvider, cadWireResult } from "./providers/cad-provider.ts";
export type { CadProviderOptions, CadSettleOutcome, CadSettleError } from "./providers/cad-provider.ts";
```

In the root `package.json` line 24, move ai-asset-gen to its own final wave (it now type-checks against cad-gen's `dist`):

```json
    "build:packages": "bun run --parallel --if-present --filter '@arbesk/asset-core' --filter '@arbesk/nostr' --filter '@arbesk/wallet' build && bun run --parallel --if-present --filter '@arbesk/authz' --filter '@arbesk/cad-gen' build && bun run --if-present --filter '@arbesk/ai-asset-gen' build",
```

Update `packages/ai-asset-gen/AGENTS.md`:
- Purpose: "Capability-gated facade over the **mock**, **Tripo3D** and **CAD** providers."
- Boundary: replace "No in-repo package deps" with "One in-repo dep: `@arbesk/cad-gen` (`createCadGenerator` from the backend entry + `CadRequestUnsuitable` from the root). The CAD provider returns the **design document** (`format: "cad-design"`) — the server never runs the kernel (cad-gen S11)."
- Facade: add `config.id: "mock" | "tripo3d" | "cad"` note, and a Registry line: "Provider construction is a registry (`createProviderRegistry(factories)`) injected at the composition root; `createGenerationProvider` remains as the two-provider default."

Update `packages/AGENTS.md` dependency-order block:

```
@arbesk/wallet  ──(depends on)──▶  @arbesk/authz
@arbesk/cad-gen  ──(depends on)──▶  @arbesk/asset-core   (GLB serialization)
@arbesk/ai-asset-gen  ──(depends on)──▶  @arbesk/cad-gen   (CAD provider)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/ai-asset-gen/cad-provider.test.js`
Expected: PASS (6 tests). Then `bun run typecheck` — must pass (this also validates the new cross-package types against built cad-gen dist).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-asset-gen/package.json packages/ai-asset-gen/src/providers/cad-provider.ts packages/ai-asset-gen/src/index.ts packages/ai-asset-gen/AGENTS.md packages/AGENTS.md package.json test/ai-asset-gen/cad-provider.test.js bun.lock
git commit -m "feat(ai-asset-gen): cad provider — design-on-the-wire lifecycle over an injected CadGenerator"
```

---

### Task 4: Backend wiring — composition root, task registry, route branches (+ route tests)

**Files:**
- Create: `src/api/generation-providers.ts`
- Modify: `src/api/generation-tasks.ts` (`provider` field on `TaskEntry`/`RegisterTaskInput`/`registerTask`)
- Modify: `src/api/routes/cad.ts` (export `refuseAdmission` and `setQuotaHeaders`)
- Modify: `src/api/assets/generate-node.ts` (cad branches in POST/GET/DELETE + `respondToPoll` + `completeCadTask` + `CAD_CAPABILITIES` + BYOK gate)
- Test: `test/api/generations-cad.test.js`

**Interfaces:**
- Consumes: `createCadProvider`, `CadSettleOutcome` from `@arbesk/ai-asset-gen/index.js`; `cadConfigFromEnv`, `CadRuntimeConfig` (exported) from `../routes/cad.ts`; `acquireCadSlot`, `releaseCadSlot`, `refundCadUnit`, `cadQuotaHeaders`, `QuotaOptions` from `../cad-quota.ts`; `registerTask` (now accepting `provider`) from `../generation-tasks.ts`; everything from Tasks 1-3.
- Produces:
  - `export interface GenerationProvidersDeps { generator?: CadGenerator; quotaStatePath?: string; fetchImpl?: typeof fetch }` (= `CadRouteDeps` shape)
  - `export function resolveCadRuntime(deps: GenerationProvidersDeps): CadConfigOutcome` — thin wrapper over `cadConfigFromEnv(process.env, deps)`
  - `export function createCadGenerationProvider(generator: CadGenerator, onSettle?: (taskId: string, outcome: CadSettleOutcome) => void, capabilities?: GenerationCapability[]): GenerationProvider` — wraps `createCadProvider` with `config: { id: "cad", capabilities: capabilities ?? ["text-to-3d"] }`
  - `TaskEntry.provider?: "tripo3d" | "cad"` (absent means tripo3d)
  - `generateAssetNode(core, storage, cadDeps: GenerationProvidersDeps = {})` — new optional third parameter

- [ ] **Step 1: Write the failing test**

Create `test/api/generations-cad.test.js`:

```js
/**
 * Unified generations route with provider "cad": 202 → poll → design payload.
 * Mirrors test/api/cad-route.test.js's harness (injected generator, temp
 * quota state, real session store).
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSession } from "../../src/api/sessions.ts";
import { _resetCadQuota } from "../../src/api/cad-quota.ts";
import { _resetRateLimiters } from "../../src/api/rate-limiter.ts";
import { _resetRegistry } from "../../src/api/generation-tasks.ts";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import { mountRoutes } from "../helpers/hono.js";

const { default: generateAssetNode } = await import("../../src/api/assets/generate-node.ts");

const WALLET = "0x1234567890123456789012345678901234567890";

const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 1,
};

function generated(overrides = {}) {
  return {
    design: DESIGN,
    runtime: { contractVersion: 1, preludeVersion: "2026-09-16" },
    provider: { id: "deepseek", model: "deepseek-flash" },
    attribution: [],
    diagnostics: {
      selection: { libraries: [], fit: {}, jevTokens: {} },
      attempts: [],
      durationMs: 5,
      tokens: { prompt: 1, completion: 1 },
    },
    ...overrides,
  };
}

let statePath;
let generate;
let app;

function buildApp(deps = {}) {
  // core/storage are untouched by the cad path (no sourceResolver use) — stubs suffice.
  return mountRoutes("/generations", generateAssetNode({}, {}, { quotaStatePath: statePath, generator: { generate }, ...deps }));
}

function sessionHeader(address = WALLET) {
  return "Session " + createSession(address);
}

async function post(body, address = WALLET) {
  return request(app).post("/generations").set("Authorization", sessionHeader(address)).send(body);
}

async function until(predicate, what = "condition") {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(what + " never became true");
}

beforeEach(() => {
  _resetCadQuota();
  _resetRateLimiters();
  _resetRegistry();
  statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cad-gen-quota-")), "quota.json");
  generate = jest.fn(async () => generated());
  app = buildApp();
});

afterEach(() => {
  delete process.env.CAD_DAILY_REQUEST_LIMIT;
  delete process.env.CAD_GENERATION_ENABLED;
});

describe("POST /api/v1/generations with provider cad", () => {
  test("starts a task without a providerKey and returns a design payload on poll", async () => {
    const res = await post({ prompt: "a 10mm cube", nodeId: "n_cad_1", provider: "cad" });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ provider: "cad", status: "running" });
    expect(typeof res.body.taskId).toBe("string");
    expect(res.headers["x-cad-quota-limit"]).toBeDefined();

    const poll = await request(app)
      .get("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe("success");
    expect(poll.body.format).toBe("cad-design");
    expect(poll.body.design).toEqual(DESIGN);
    expect(poll.body.provider).toEqual({ id: "deepseek", model: "deepseek-flash" });
    expect(poll.body.assetData).toBeUndefined();
    expect(poll.body.diagnostics.attempts).toEqual([]);
  });

  test("reports running while the generator is in flight", async () => {
    let release;
    generate = jest.fn(async () => {
      await new Promise((resolve) => { release = resolve; });
      return generated();
    });
    app = buildApp();

    const res = await post({ prompt: "gated", nodeId: "n_cad_gate", provider: "cad" });
    expect(res.status).toBe(202);
    const poll = await request(app)
      .get("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(poll.body.status).toBe("running");
    release();
    await until(async () => {
      const later = await request(app)
        .get("/generations/" + res.body.taskId)
        .set("Authorization", sessionHeader());
      return later.body.status === "success";
    }, "success poll");
  });

  test("rejects a missing prompt with 400", async () => {
    const res = await post({ nodeId: "n_cad_noprompt", provider: "cad" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("refuses a second in-flight cad request with 409", async () => {
    let release;
    generate = jest.fn(async () => {
      await new Promise((resolve) => { release = resolve; });
      return generated();
    });
    app = buildApp();

    const first = await post({ prompt: "one", nodeId: "n_cad_a", provider: "cad" });
    expect(first.status).toBe(202);
    const second = await post({ prompt: "two", nodeId: "n_cad_b", provider: "cad" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("GENERATION_IN_PROGRESS");
    expect(second.headers["retry-after"]).toBeDefined();
    release();
  });

  test("refuses with 429 once the daily quota is spent", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    const first = await post({ prompt: "one", nodeId: "n_cad_q1", provider: "cad" });
    expect(first.status).toBe(202);
    const second = await post({ prompt: "two", nodeId: "n_cad_q2", provider: "cad" });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("DAILY_QUOTA_EXCEEDED");
    expect(second.headers["x-cad-quota-remaining"]).toBe("0");
  });

  test("unsuitable subjects fail with CAD_REQUEST_UNSUITABLE and refund the unit", async () => {
    process.env.CAD_DAILY_REQUEST_LIMIT = "1";
    generate = jest.fn(async () => { throw new CadRequestUnsuitable("organic subject", 0.12); });
    app = buildApp();

    const res = await post({ prompt: "a dragon", nodeId: "n_cad_dragon", provider: "cad" });
    expect(res.status).toBe(202);
    const poll = await request(app)
      .get("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe("failed");
    expect(poll.body.error.code).toBe("CAD_REQUEST_UNSUITABLE");
    expect(poll.body.error.suitability).toBe(0.12);
    expect(poll.body.error.alternative).toEqual({ kind: "organic-mesh", provider: "tripo3d" });

    // The refund means the spent unit is back: a follow-up request is admitted.
    generate = jest.fn(async () => generated());
    app = buildApp();
    const next = await post({ prompt: "a plate", nodeId: "n_cad_plate", provider: "cad" });
    expect(next.status).toBe(202);
  });

  test("answers 503 CAD_NOT_CONFIGURED when disabled", async () => {
    process.env.CAD_GENERATION_ENABLED = "false";
    const res = await post({ prompt: "x", nodeId: "n_cad_off", provider: "cad" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CAD_NOT_CONFIGURED");
  });

  test("an unknown provider stays 501", async () => {
    const res = await post({ prompt: "x", nodeId: "n_cad_foo", provider: "mystery" });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("NOT_IMPLEMENTED");
  });

  test("DELETE cancels an in-flight cad task", async () => {
    let release;
    generate = jest.fn(async (input) => {
      await new Promise((resolve, reject) => {
        release = resolve;
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return generated();
    });
    app = buildApp();

    const res = await post({ prompt: "one", nodeId: "n_cad_del", provider: "cad" });
    const del = await request(app)
      .delete("/generations/" + res.body.taskId)
      .set("Authorization", sessionHeader());
    expect(del.status).toBe(200);
    expect(del.body.status).toBe("cancelled");
    release();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/api/generations-cad.test.js`
Expected: FAIL — `provider: "cad"` hits the 501 `NOT_IMPLEMENTED` arm (most tests fail); a few fail on undefined taskId/headers.

- [ ] **Step 3: Implement**

Create `src/api/generation-providers.ts`:

```ts
/**
 * Composition root for the "cad" generation provider.
 * @remarks Reuses the cad routes' cadConfigFromEnv so the unified generations
 *   path and /api/v1/cad/* share one environment vocabulary and one quota
 *   regime. The route owns metering: it supplies onSettle (release the cad
 *   slot; refund CAD_REQUEST_UNSUITABLE) because the slot token only exists
 *   after admission.
 */
import type { GenerationProvider } from "@arbesk/ai-asset-gen/facade.js";
import { createCadProvider } from "@arbesk/ai-asset-gen/index.js";
import type { CadSettleOutcome } from "@arbesk/ai-asset-gen/index.js";
import type { GenerationCapability } from "@arbesk/ai-asset-gen/types.js";
import type { CadGenerator } from "@arbesk/cad-gen/backend/index.js";
import { cadConfigFromEnv } from "./routes/cad.ts";
import type { CadConfigOutcome } from "./routes/cad.ts";

/** Same injection surface as CadRouteDeps (tests inject a stub generator). */
export interface GenerationProvidersDeps {
  generator?: CadGenerator;
  quotaStatePath?: string;
  fetchImpl?: typeof fetch;
}

/** The env-decided runtime config, or the 503 refusal (mirrors the cad routes). */
export function resolveCadRuntime(deps: GenerationProvidersDeps = {}): CadConfigOutcome {
  return cadConfigFromEnv(process.env, deps);
}

/** Binds the cad identity and the route's settle callback around a generator. */
export function createCadGenerationProvider(
  generator: CadGenerator,
  onSettle?: (taskId: string, outcome: CadSettleOutcome) => void,
  capabilities: GenerationCapability[] = ["text-to-3d"],
): GenerationProvider {
  return createCadProvider({
    config: { id: "cad", capabilities },
    generator,
    onSettle,
  });
}
```

In `src/api/routes/cad.ts`, export the two admission helpers (change `function refuseAdmission` → `export function refuseAdmission`, and `function setQuotaHeaders` → `export function setQuotaHeaders`). Also export the `CadConfigOutcome` type:

```ts
export type { CadConfigOutcome } from ... // it is declared in this file — add `export` to its declaration
```
(`CadConfigOutcome` is declared at line ~88 as `type CadConfigOutcome = ...`; add the `export` keyword. `CadRuntimeConfig` is already exported.)

In `src/api/generation-tasks.ts`: add `provider?: "tripo3d" | "cad"` to `TaskEntry` and `RegisterTaskInput`, destructure it in `registerTask`, and spread it (`...(provider && { provider })`). Add the doc line: `/** Provider that owns the task (absent = "tripo3d"). */`.

In `src/api/assets/generate-node.ts`:

1. Imports: add

```ts
import { resolveCadRuntime, createCadGenerationProvider } from "../generation-providers.ts";
import type { GenerationProvidersDeps } from "../generation-providers.ts";
import {
  acquireCadSlot,
  releaseCadSlot,
  refundCadUnit,
  cadQuotaHeaders,
} from "../cad-quota.ts";
import type { QuotaOptions } from "../cad-quota.ts";
import { refuseAdmission } from "../routes/cad.ts";
import type { CadRuntimeConfig } from "../routes/cad.ts";
```

2. Capabilities: add after `TRIPO_CAPABILITIES`:

```ts
/** Capabilities the CAD provider declares (design-on-the-wire, text-only). */
const CAD_CAPABILITIES: GenerationCapability[] = ["text-to-3d"];
```

3. BYOK gate (`rejectMissingProviderKey`, line 254): change the mock exemption to also exempt cad:

```ts
  if (effectiveProvider !== "mock" && effectiveProvider !== "cad") {
```

4. New helpers (place above `handleTripoRequest`):

```ts
/** Sets the X-Cad-Quota-* headers on the response being built. */
function setCadQuotaHeaders(c: Context, wallet: string, quota: QuotaOptions): void {
  for (const [name, value] of Object.entries(cadQuotaHeaders(wallet, quota))) {
    c.header(name, value);
  }
}

/**
 * CAD dispatch: server-paid, design-on-the-wire. Admits through the cad
 * quota (daily rounds + one in-flight per wallet), starts the in-process
 * task, and wires settle-time metering (slot release; unsuitable refund).
 * @remarks The provider is built AFTER admission so onSettle can close over
 *   the admitted slot token; the route — not the provider — owns metering.
 */
async function handleCadRequest(
  c: Context,
  userAddress: string,
  body: { prompt?: string; nodeId: string },
  cadDeps: GenerationProvidersDeps,
): Promise<Response> {
  const prompt = body.prompt?.trim();
  if (!prompt) {
    return c.json({
      error: { code: "VALIDATION_ERROR", message: "prompt is required for the cad provider" },
    }, 400);
  }

  const runtime = resolveCadRuntime(cadDeps);
  if (!runtime.ok) {
    return c.json({ error: { code: runtime.code, message: runtime.message } }, runtime.status);
  }
  const { config } = runtime;

  const decision = acquireCadSlot(userAddress, config.quota);
  if (!decision.ok) {
    return refuseAdmission(c, userAddress, config, decision);
  }

  setCadQuotaHeaders(c, userAddress, config.quota);
  const provider = createCadGenerationProvider(config.generator, (taskId, outcome) => {
    releaseCadSlot(userAddress, decision.token);
    if (!outcome.ok && outcome.error.code === "CAD_REQUEST_UNSUITABLE") {
      refundCadUnit(userAddress, config.quota);
    }
  }, CAD_CAPABILITIES);

  console.log(`[GEN] cad generation started nodeId=${body.nodeId}`);
  const cadTaskId = await provider.textToModel({ prompt });
  const taskId = registerTask({
    tripoTaskId: cadTaskId,
    providerKey: "",
    userAddress,
    provider: "cad",
  });
  return c.json({ taskId, provider: "cad", status: "running" }, 202);
}
```

Note: `refuseAdmission(c, wallet, config, decision)` from routes/cad.ts takes `config: CadRuntimeConfig` — pass `config` whole.

5. `completeCadTask` (place next to `completeTask`):

```ts
/**
 * Terminal success for a CAD task: the design document IS the payload —
 * no download, no geometry (the server never runs the kernel, cad-gen S11).
 */
async function completeCadTask(
  c: Context,
  entry: TaskEntry,
  taskId: string,
  userAddress: string,
  poll: GenerationStatus,
): Promise<Response> {
  const result = poll.output as {
    design: unknown;
    runtime: unknown;
    provider: unknown;
    attribution: unknown;
    diagnostics: unknown;
  };
  markTaskComplete(taskId, userAddress);
  console.log(`[GEN] cad task complete taskId=${taskId}`);
  return c.json({
    status: "success",
    format: "cad-design",
    design: result.design,
    runtime: result.runtime,
    provider: result.provider,
    attribution: result.attribution,
    diagnostics: result.diagnostics,
    providerTaskId: entry.tripoTaskId,
  });
}
```

6. `respondToPoll`: inside the `poll.status === "success"` handling and before the generic failure, add the cad arms:

```ts
  if (poll.status === "success" && poll.format === "cad-design") {
    return await completeCadTask(c, entry, taskId, userAddress, poll);
  }

  if (poll.status === "failed") {
    const details = poll.output as { code?: string; suitability?: number; alternative?: unknown } | undefined;
    if (details?.code === "CAD_REQUEST_UNSUITABLE") {
      // Refunded at settle time (the POST branch's onSettle); this is the report.
      evictTask(taskId);
      console.log(`[GEN] cad task unsuitable taskId=${taskId} suitability=${details.suitability}`);
      return c.json({
        status: "failed",
        error: {
          code: "CAD_REQUEST_UNSUITABLE",
          message: poll.error || "Request unsuitable for CAD generation",
          suitability: details.suitability,
          alternative: details.alternative,
        },
      });
    }
  }
```

(Place the success arm right before the existing `if (poll.status === "success")`, and the failure arm right before `return sendTaskFailed(...)`.)

7. Route factory: add the third parameter and the cad branches.

```ts
export default function generateAssetNode(
  core: ArbeskCore,
  storage: StorageAdapter,
  cadDeps: GenerationProvidersDeps = {},
) {
```

In the POST handler, between the mock arm and the tripo arm:

```ts
        if (effectiveProvider === "cad") {
          return await handleCadRequest(
            c, c.get("userAddress"), body, cadDeps,
          );
        }
```

In `GET /:taskId`, before `const provider = buildTripoProvider(entry.providerKey);`:

```ts
      if (entry.provider === "cad") {
        const runtime = resolveCadRuntime(cadDeps);
        if (!runtime.ok) {
          return c.json({ error: { code: runtime.code, message: runtime.message } }, runtime.status);
        }
        const cadProvider = createCadGenerationProvider(runtime.config.generator);
        const cadPoll = await cadProvider.poll(entry.tripoTaskId);
        return await respondToPoll(
          c, cadProvider, entry, taskId, c.get("userAddress"), cadPoll,
        );
      }
```

In `DELETE /:taskId`, before `const provider = buildTripoProvider(entry.providerKey);`:

```ts
    if (entry.provider === "cad") {
      const runtime = resolveCadRuntime(cadDeps);
      const upstreamCancelled = runtime.ok
        ? await createCadGenerationProvider(runtime.config.generator).cancel(entry.tripoTaskId)
        : false;
      console.log(`[GEN] cad task cancelled taskId=${taskId}`);
      return c.json({ status: "cancelled", upstreamCancelled });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/api/generations-cad.test.js`
Expected: PASS (8 tests). Then run the neighboring suites for regressions:
`bun run test -- test/api.test.js test/api/cad-route.test.js`
Expected: PASS — mock/tripo generations and the standalone cad routes are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/api/generation-providers.ts src/api/generation-tasks.ts src/api/routes/cad.ts src/api/assets/generate-node.ts test/api/generations-cad.test.js
git commit -m "feat(api): provider=cad on /api/v1/generations — design-on-the-wire with cad-quota admission"
```

---

### Task 5: Docs sweep + full verification

**Files:**
- Modify: `docs/API_SPEC.md` (generations endpoint: `provider: "cad"` + cad-design response)
- Modify: `AGENTS.md` (root, §1 3D generation bullet)
- (packages/AGENTS.md and both package AGENTS.md files were updated in Tasks 2-3.)

**Interfaces:**
- Consumes: everything from Tasks 1-4 (no new code interfaces).

- [ ] **Step 1: Update docs/API_SPEC.md**

Find the `POST /api/v1/generations` section and the task-poll response documentation. Add, next to the tripo3d/mock provider documentation, in the same format the file uses:

- Accepted `provider` value: `"cad"` (server-paid, no `providerKey`; requires `prompt`).
- 202 body: `{ taskId, provider: "cad", status: "running" }`.
- Poll success body for cad:

```
{ status: "success", format: "cad-design", design, runtime, provider, attribution, diagnostics, providerTaskId }
```

with a note: no `assetData`/`path` — `design` is the CAD design document the client executes (guard → kernel → `meshToGltf`) — and no `validation` claim (the server ran static gates only). Poll failure `error.code` gains `CAD_REQUEST_UNSUITABLE` (with `suitability` + `alternative`), plus admission errors 409 `GENERATION_IN_PROGRESS` / 429 `DAILY_QUOTA_EXCEEDED` / 503 `CAD_NOT_CONFIGURED`.

- [ ] **Step 2: Update root AGENTS.md §1**

In the "3D generation" bullet, after the Tripo3D sentence, add one sentence:

```
The CAD provider (`provider: "cad"`, `@arbesk/cad-gen` backend) serves parametric
parts design-on-the-wire through the same generations route — the API returns the
Manifold design document (no server-side kernel; cad-gen ruling S11) and the client
renders it to glTF via `meshToGltf`; the browser runner is the next milestone.
```

- [ ] **Step 3: Full verification**

Run, in order:

```bash
bun run lint
bun run typecheck          # pretypecheck rebuilds packages (new build order)
bun run test -- test/ai-asset-gen test/cad-gen test/api.test.js test/api/cad-route.test.js test/api/generations-cad.test.js
```

Expected: all green. If `bun run test` without filters is practical in this environment, run it; otherwise the filtered set above is the acceptance gate for this changeset.

- [ ] **Step 4: Commit**

```bash
git add docs/API_SPEC.md AGENTS.md
git commit -m "docs: cad provider on /api/v1/generations — spec + AGENTS.md updates"
```

---

## Self-review notes (plan author)

- Spec §1 registry → Task 1. §2 cad provider → Task 3. §3 meshToGltf → Task 2.
  §4 composition root/route wiring/tasks field → Task 4 (incl. response shapes
  and error-table coverage: 503/409/429/unsuitable/501 all exercised in
  `generations-cad.test.js`). §6 testing → Tasks 1-4 test steps + Task 5 gate.
  §7 docs → Tasks 2, 3, 5. Build-order change → Task 3 (root package.json).
- Type consistency: `CadSettleOutcome` (Task 3) is consumed by
  `generation-providers.ts` (Task 4) and the `onSettle` closures in
  `handleCadRequest`; `cadWireResult` is used only inside the provider.
  `resolveCadRuntime` returns `CadConfigOutcome` (existing type in
  routes/cad.ts, exported in Task 4). `createCadGenerationProvider` takes an
  optional capability list defaulting to `["text-to-3d"]`, and the POST
  branch passes `CAD_CAPABILITIES` — one source of truth for the declared
  set. `TaskEntry.provider` discriminates the GET/DELETE branches.
  `refuseAdmission`/`setQuotaHeaders` are exported from routes/cad.ts in Task
  4 and used by generate-node.ts.

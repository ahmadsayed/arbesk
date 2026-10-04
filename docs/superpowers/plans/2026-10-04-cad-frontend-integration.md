# CAD Provider Frontend Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAD (`provider: "cad"`) generations render in a browser worker (guard → kernel → 3MF), surface as ordinary `format: "3mf"` version-card bubbles, and rejections get dedicated UX.

**Architecture:** The cad path converges to the existing 3MF asset pipeline before any UI consumes it — the version-card bubble, orbit preview (via `threeMfHandler`), Show in Studio, and save/publish (composite-3mf with per-part IPFS dedup) all work unchanged. New machinery is limited to: a pure render core (`renderCadDesign`), a module worker (`cad-worker.ts` + staged `manifold.wasm`), a main-thread wrapper (`services/cad-render.ts`), and a `generateCadAsset` seam in `services/api.ts`.

**Tech Stack:** TypeScript (frontend `frontend/src/js/`, bundled by Bun.build), `@arbesk/cad-gen` core (browser-safe), `manifold-3d` 3.5.3 (WASM, ESM glue), bun test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-cad-frontend-integration-design.md`

## Global Constraints

- Frontend modules are TypeScript; import specifiers match on-disk paths (`.ts`). Type-only imports MUST use `import type`.
- SDK packages consumed by bare specifier as black boxes; `import type` from `@arbesk/cad-gen` is fine, runtime imports only from its root (core, browser-safe) — never `/backend`.
- `bun test` conventions: APIs from `bun:test`; `// @test-env dom` first line for DOM tests; `mock.module()` is process-global (runner isolates per file, so no restore needed across files); `resetModules()` + dynamic `import()` for re-mocking inside a file.
- Run tests from repo root: `bun run test -- <path-substring>`.
- Pre-commit runs `fallow audit --changed-since HEAD` — keep functions small; if fallow flags new complexity, extract helpers.
- Pug fragments: keep every id/class byte-identical except where this plan says to add.
- Backend logs use `[TAG]` prefixes; `console.error` for exceptions only.
- Exact wire strings (pinned by prior milestone): provider id `"cad"`, poll success `format: `"cad-design"`, error code `"CAD_REQUEST_UNSUITABLE"`, cad poll success body has `design/runtime/provider/attribution/diagnostics/providerTaskId` and NO `assetData`.
- Known upstream quirk: `manifold-3d` declares `locateFile` zero-arity but Emscripten calls it with the filename — type the options bag as `any`, never "fix" the `.d.ts`.

## Verified contracts this plan builds on (already in repo)

- `GuardResult = { ok: true } | { ok: false; reason: string; detail?: string }` — `packages/cad-gen/src/core/guard.ts:10`, `guardScript(code, preludeNames)` at `:76`.
- `PRELUDE_VERSION = "2026-10-04.3"` — `packages/cad-gen/src/core/contract.ts:10`; `PRELUDE_NAMES` includes `"box"` — `packages/cad-gen/src/core/prelude.ts:17`.
- `createCadKernel(module, { segments })` → `kernel.run(design)` → `{ mesh, stats }` — `packages/cad-gen/src/core/kernel.ts:192`. `CadMesh = { positions: Float32Array; indices: Uint32Array }` — `packages/cad-gen/src/types.ts:52`.
- `meshTo3mf(mesh, design)` → `Uint8Array` (embeds design sidecar `Metadata/arbesk_cad.json`) — `packages/cad-gen/src/core/export/three-mf.ts:81`.
- Kernel loader pattern: `Module({ locateFile } as any)` → `module.setup()` → `createCadKernel(..., { segments: 64 })` — `scripts/lib/cad-harness.mjs:66-82`.
- `CadGenerator.generate(input)` → `Promise<CadGenerateResult>`; `CadGenerateResult = { design, runtime: { contractVersion, preludeVersion }, provider: { id, model }, attribution: Attribution[], diagnostics: CadDiagnostics }` — `packages/cad-gen/src/backend/facade.ts:81-99`. `CadDiagnostics = { selection: Omit<LibrarySelection,"tokens"> & { jevTokens: TokenUsage }, attempts: AttemptRecord[], durationMs, tokens: TokenUsage }`; `TokenUsage = { prompt, completion }` — `facade.ts:65-71`, `types.ts:58`.
- `cadConfigFromEnv(env, deps)` waives the `DEEPSEEK_API_KEY` requirement when `deps.generator` is injected (`!apiKey && !deps.generator` check) — `src/api/routes/cad.ts:185-227`.
- `ApiError(message, status, code)` + `parseErrorBody` returning `{ message, code, details }` — `frontend/src/js/services/backend-client.ts:25-55`.
- `pollGeneration(taskId, signal, onProgress)` is module-private in `frontend/src/js/services/api.ts:193`; poll failure throw at `:218-221`; success merge in `generateAsset` at `:670-675`.
- `buildGenerationManifest({ prompt, nodeId, assetId?, prevAssetManifestCid?, transformMatrix?, assetCid, data: { format, path }, referenceImage?, referenceImages?, scaleCompensation?, getFromRemoteIPFS })` — `api.ts:524`; `writeToIPFS(bytes, name)` / `writeJSONToIPFS(manifest, null, { assetId })` — dynamic-imported from `../ipfs/write-to-ipfs.ts` at `api.ts:680-682`.
- Worker bundle pattern + wasm staging — `frontend/scripts/bundle.js:147-163`; `.wasm` is in `compress.js` COMPRESSIBLE (`compress.js:14`).
- `manifold-3d` resolves at root `node_modules/manifold-3d` (glue `manifold.js` + `manifold.wasm`).
- `syncImageAttachUI()` already gates attachments to `getProvider() === "tripo3d"` — `frontend/src/js/ui/create-panel.ts:225-229` (cad excluded automatically).
- `addChoiceMessage(text, choices: {label, value}[], onPick)` — `frontend/src/js/ui/chat-messages.ts:174`.
- `isRealProvider()` is `getProvider() !== "mock"` — `create-panel.ts:106-108`; stoppable gate uses it at `:2035`; BYOK submit gate at `:2055`; key button visibility via `syncProviderUI()` `:373-388`.
- `/api/v1/config` route — `src/api/index.ts:46-58`; e2e backend env spawn — `e2e/global-setup.mjs:301-319`.

---

### Task 1: Backend mock seam + availability flag

**Files:**
- Modify: `src/api/generation-providers.ts`
- Modify: `src/api/assets/generate-node.ts:789` (runtime resolution in `handleCadRequest`)
- Modify: `src/api/index.ts:46-58` (config route)
- Modify: `src/api/openapi.json` (config schema, near line 1044)
- Test: `test/api/generations-cad.test.js` (extend existing)

**Interfaces:**
- Consumes: `CadGenerator`, `CadGenerateResult` types; `cadConfigFromEnv(env, deps)` with `deps.generator` injection.
- Produces:
  - `createMockCadGenerator(): CadGenerator` (exported from `src/api/generation-providers.ts`) — returns a design that passes guard + kernel: `code: "return box(P.width, P.depth, P.height);"` with width/depth/height parameters, `summary: "Mock parametric box"`, `runtime.preludeVersion` from `PRELUDE_VERSION`, `provider: { id: "mock", model: "canned" }`, `attribution: []`, `diagnostics: { selection: { libraries: [], fit: {}, source: "fallback", jevTokens: { prompt: 0, completion: 0 } }, attempts: [{ index: 1, ok: true, gates: [] }], durationMs: 1, tokens: { prompt: 0, completion: 0 } }`.
  - `GET /api/v1/config` gains `cadGeneration: boolean` (`CAD_MOCK_GENERATION === "true"` or non-empty `DEEPSEEK_API_KEY`).
  - With `CAD_MOCK_GENERATION=true` in env, `POST /generations {provider:"cad"}` works without `DEEPSEEK_API_KEY`.

- [ ] **Step 1: Write the failing test**

In `test/api/generations-cad.test.js`, add a describe block `CAD_MOCK_GENERATION` (follow the file's existing app-build/import harness — read the top of the file first and mirror it):

```js
describe("CAD_MOCK_GENERATION", () => {
  test("mock mode settles a canned design without DEEPSEEK_API_KEY", async () => {
    const prevKey = process.env.DEEPSEEK_API_KEY;
    const prevMock = process.env.CAD_MOCK_GENERATION;
    delete process.env.DEEPSEEK_API_KEY;
    process.env.CAD_MOCK_GENERATION = "true";
    try {
      // build the app exactly like the sibling tests do, then:
      const res = await request(app)
        .post("/api/v1/generations")
        .set("Authorization", /* session header as sibling tests do */)
        .send({ provider: "cad", prompt: "a 40x30x20 box", nodeId: "node_1" });
      expect(res.status).toBe(202);
      const poll = await request(app).get(`/api/v1/generations/${res.body.taskId}`);
      expect(poll.status).toBe(200);
      expect(poll.body.status).toBe("success");
      expect(poll.body.format).toBe("cad-design");
      expect(poll.body.design.code).toBe("return box(P.width, P.depth, P.height);");
      expect(poll.body.provider.id).toBe("mock");
      expect(poll.body.attribution).toEqual([]);
    } finally {
      if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = prevKey;
      if (prevMock === undefined) delete process.env.CAD_MOCK_GENERATION; else process.env.CAD_MOCK_GENERATION = prevMock;
    }
  });

  test("config endpoint reports cadGeneration", async () => {
    process.env.CAD_MOCK_GENERATION = "true";
    try {
      const res = await request(app).get("/api/v1/config");
      expect(res.body.cadGeneration).toBe(true);
    } finally {
      delete process.env.CAD_MOCK_GENERATION;
    }
  });
});
```

Note: the cad provider task settles on a detached timer — the existing tests in this file already handle that (read how the sibling cad tests await the poll; reuse exactly).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/api/generations-cad.test.js`
Expected: FAIL — `res.status` is 503 `CAD_NOT_CONFIGURED` (no key), and `cadGeneration` is missing.

- [ ] **Step 3: Implement**

`src/api/generation-providers.ts` — add after the imports:

```ts
import { PRELUDE_VERSION } from "@arbesk/cad-gen/index.js";

/**
 * Canned generator for CAD_MOCK_GENERATION: a deterministic parametric box that
 * passes the guard and the kernel, so dev/E2E can exercise the UI without a
 * DeepSeek key. Mirrors the MOCK_3D_GENERATION philosophy.
 */
export function createMockCadGenerator(): CadGenerator {
  return {
    generate: async () => ({
      design: {
        code: "return box(P.width, P.depth, P.height);",
        parameters: {
          width: { value: 40, unit: "mm", min: 10, max: 200, label: "Width" },
          depth: { value: 30, unit: "mm", min: 10, max: 200, label: "Depth" },
          height: { value: 20, unit: "mm", min: 5, max: 100, label: "Height" },
        },
        summary: "Mock parametric box",
        turn: 1,
      },
      runtime: { contractVersion: 1, preludeVersion: PRELUDE_VERSION },
      provider: { id: "mock", model: "canned" },
      attribution: [],
      diagnostics: {
        selection: { libraries: [], fit: {}, source: "fallback", jevTokens: { prompt: 0, completion: 0 } },
        attempts: [{ index: 1, ok: true, gates: [] }],
        durationMs: 1,
        tokens: { prompt: 0, completion: 0 },
      },
    }),
  };
}
```

(Verify `@arbesk/cad-gen/index.js` is the correct specifier by checking how `generation-providers.ts` already imports — keep the same style. If `CadDesign["turn"]` is required by the type, keep `turn: 1`; if the type forbids it, drop it and let inference complain.)

`src/api/assets/generate-node.ts` — in `handleCadRequest`, replace `const runtime = resolveCadRuntime(cadDeps);` with:

```ts
  // CAD_MOCK_GENERATION swaps in a canned generator and waives the DeepSeek
  // key (cadConfigFromEnv skips the key check when a generator is injected).
  const runtime = process.env.CAD_MOCK_GENERATION === "true"
    ? cadConfigFromEnv(process.env, { ...cadDeps, generator: createMockCadGenerator() })
    : resolveCadRuntime(cadDeps);
```

Add `cadConfigFromEnv` and `createMockCadGenerator` to the file's imports from `./routes/cad.ts` and `../generation-providers.ts` respectively (check the existing import lines first).

`src/api/index.ts` — in the `/config` handler object, add after `mockGeneration`:

```ts
      cadGeneration:
        process.env.CAD_MOCK_GENERATION === "true" ||
        (process.env.DEEPSEEK_API_KEY ?? "").trim().length > 0,
```

`src/api/openapi.json` — in the config response schema near `"mockGeneration"` (line ~1044), add `"cadGeneration": { "type": "boolean", "description": "Parametric CAD generation provider availability (CAD_MOCK_GENERATION or DEEPSEEK_API_KEY configured)" }`.

- [ ] **Step 4: Run tests**

Run: `bun run test -- test/api/generations-cad.test.js`
Expected: PASS (all, including the pre-existing 9 cad route tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/generation-providers.ts src/api/assets/generate-node.ts src/api/index.ts src/api/openapi.json test/api/generations-cad.test.js
git commit -m "feat(api): CAD_MOCK_GENERATION canned generator + cadGeneration config flag"
```

---

### Task 2: Render core (pure, testable)

**Files:**
- Create: `frontend/src/js/workers/cad-render-core.ts`
- Test: `test/frontend/cad-render-core.test.js`

**Interfaces:**
- Consumes: `guardScript`, `PRELUDE_NAMES`, `PRELUDE_VERSION`, `createCadKernel`, `meshTo3mf` from `@arbesk/cad-gen` (root — verify each is re-exported by `packages/cad-gen/src/index.ts`; if one is missing, import from its core subpath ending in `.js`, e.g. `@arbesk/cad-gen/core/export/three-mf.js`, matching how `frontend/src/js` imports asset-core subpaths).
- Produces:
  - `export class CadRenderError extends Error` with `readonly code: string`.
  - `export function renderCadDesign(design: CadDesign, manifoldModule: any, runtime: { preludeVersion?: string } = {}): { bytes: Uint8Array; summary: string; stats: any }` — throws `CadRenderError` with codes `CAD_PRELUDE_MISMATCH`, `CAD_GUARD_REJECTED`, or lets kernel errors propagate wrapped as `CAD_KERNEL_FAILED`.

- [ ] **Step 1: Write the failing test**

`test/frontend/cad-render-core.test.js` (NOT a DOM test — no `@test-env dom` line):

```js
import { describe, expect, test, beforeAll } from "bun:test";
import path from "node:path";
import { renderCadDesign, CadRenderError } from "../../frontend/src/js/workers/cad-render-core.ts";
import { parse3mfModel } from "@arbesk/asset-core/formats/3mf/parser.js";
import { parsed3mfToGltf } from "@arbesk/asset-core/formats/3mf/to-gltf.js";
import { unzipSync, strFromU8 } from "fflate";

const DESIGN = {
  code: "return box(P.width, P.depth, P.height);",
  parameters: {
    width: { value: 40, unit: "mm", min: 10, max: 200, label: "Width" },
    depth: { value: 30, unit: "mm", min: 10, max: 200, label: "Depth" },
    height: { value: 20, unit: "mm", min: 5, max: 100, label: "Height" },
  },
  summary: "A 40x30x20 box",
};

let module_;
beforeAll(async () => {
  const Module = (await import("manifold-3d")).default;
  // Repo-root resolution keeps this independent of the test file's depth.
  module_ = await Module({
    locateFile: (f) => path.join(process.cwd(), "node_modules", "manifold-3d", f),
  });
  module_.setup();
});

describe("renderCadDesign", () => {
  test("renders a valid design to parseable 3MF with geometry", () => {
    const { bytes, summary, stats } = renderCadDesign(DESIGN, module_);
    expect(bytes.length).toBeGreaterThan(500);
    expect(summary).toBe(DESIGN.summary);
    expect(stats && typeof stats === "object").toBe(true);
    const entries = unzipSync(bytes);
    const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
    const parsed = parse3mfModel(strFromU8(entries[modelPath]));
    expect(parsed.objects[0].vertices.length).toBeGreaterThan(0);
    expect(parsed.objects[0].triangles.length).toBeGreaterThan(0);
    const gltf = parsed3mfToGltf(parsed);
    expect(gltf.meshes.length).toBe(1);
    // design sidecar embedded
    expect(Object.keys(entries)).toContain("Metadata/arbesk_cad.json");
  });

  test("rejects on prelude version mismatch", () => {
    expect(() => renderCadDesign(DESIGN, module_, { preludeVersion: "1999-01-01.0" }))
      .toThrowError(expect.objectContaining({ code: "CAD_PRELUDE_MISMATCH" }));
  });

  test("rejects a design that fails the guard", () => {
    const evil = { ...DESIGN, code: "return eval('1+1');" };
    try {
      renderCadDesign(evil, module_);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CadRenderError);
      expect(err.code).toBe("CAD_GUARD_REJECTED");
    }
  });

  test("wraps kernel failures as CAD_KERNEL_FAILED", () => {
    const broken = { ...DESIGN, code: "return M.banana(P.width);" };
    try {
      renderCadDesign(broken, module_);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CadRenderError);
      expect(err.code).toBe("CAD_KERNEL_FAILED");
    }
  });
});
```

(If `expect.objectContaining` inside `toThrowError` is awkward in bun, use the try/catch style of the third test for all error assertions — consistency matters more than brevity.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/frontend/cad-render-core.test.js`
Expected: FAIL — module not found (`../../frontend/src/js/workers/cad-render-core.ts`).

- [ ] **Step 3: Implement**

`frontend/src/js/workers/cad-render-core.ts`:

```ts
/**
 * Pure CAD render pipeline shared by the browser worker and its unit tests.
 * @remarks Imports only @arbesk/cad-gen core (browser-safe). The Manifold
 *   module is injected by the host — the kernel owns no loader by design.
 */
import {
  createCadKernel,
  guardScript,
  meshTo3mf,
  PRELUDE_NAMES,
  PRELUDE_VERSION,
} from "@arbesk/cad-gen";
import type { CadDesign } from "@arbesk/cad-gen";

/** Stable error codes mapped to user copy in the render service. */
export class CadRenderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CadRenderError";
    this.code = code;
  }
}

export interface CadRenderOutput {
  bytes: Uint8Array;
  summary: string;
  stats: unknown;
}

/**
 * Guard → kernel → 3MF export for one design document.
 * @param manifoldModule - initialized Manifold module (setup() already called)
 * @param runtime - the design's runtime contract; a prelude version newer or
 *   older than this build's refuses to run (the prelude API may have moved)
 */
export function renderCadDesign(
  design: CadDesign,
  manifoldModule: unknown,
  runtime: { preludeVersion?: string } = {},
): CadRenderOutput {
  if (runtime.preludeVersion && runtime.preludeVersion !== PRELUDE_VERSION) {
    throw new CadRenderError(
      "CAD_PRELUDE_MISMATCH",
      `CAD runtime mismatch (design ${runtime.preludeVersion}, app ${PRELUDE_VERSION}) — refresh the page.`,
    );
  }
  const guard = guardScript(design.code, PRELUDE_NAMES);
  if (!guard.ok) {
    throw new CadRenderError(
      "CAD_GUARD_REJECTED",
      `Design rejected by the client-side safety guard (${guard.reason}) — try rephrasing the request.`,
    );
  }
  try {
    const kernel = createCadKernel(manifoldModule as any, { segments: 64 });
    const { mesh, stats } = kernel.run(design);
    const bytes = meshTo3mf(mesh, design);
    return { bytes, summary: design.summary, stats };
  } catch (err) {
    if (err instanceof CadRenderError) throw err;
    throw new CadRenderError(
      "CAD_KERNEL_FAILED",
      `CAD kernel failed: ${(err as Error).message ?? "unknown error"}`,
    );
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test -- test/frontend/cad-render-core.test.js`
Expected: PASS (4 tests). If the root import doesn't expose a name, switch that name to its core subpath import (see Interfaces note) and rerun.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/workers/cad-render-core.ts test/frontend/cad-render-core.test.js
git commit -m "feat(frontend): pure CAD render core (guard/kernel/3MF)"
```

---

### Task 3: Worker entry + main-thread render service

**Files:**
- Create: `frontend/src/js/workers/cad-worker.ts`
- Create: `frontend/src/js/services/cad-render.ts`
- Test: `test/frontend/cad-render.test.js`

**Interfaces:**
- Consumes: `renderCadDesign` + `CadRenderError` from `../workers/cad-render-core.ts` (worker) / re-exported `CadRenderError` from `cad-render.ts` (service).
- Produces:
  - `export interface CadRenderResult { bytes: Uint8Array; summary: string; stats: unknown }`
  - `export { CadRenderError } from "../workers/cad-render-core.ts";` (re-export for call sites)
  - `export function renderCadDesignInWorker(design: CadDesign, runtime: { preludeVersion?: string }, opts?: { timeoutMs?: number }): Promise<CadRenderResult>` — spawns `/workers/cad-worker.js` (module worker), resolves on `{type:"ok"}`, rejects with `CadRenderError` on `{type:"error"}` or `CAD_RENDER_TIMEOUT` after `timeoutMs` (default 90_000).
  - Worker protocol: in `{ type: "render", design, runtime }`; out `{ type: "ok", bytes, summary, stats }` (bytes buffer transferred) or `{ type: "error", code, message }`.

- [ ] **Step 1: Write the failing test**

`test/frontend/cad-render.test.js` with `// @test-env dom` as the first line (Worker global exists in jsdom? It does not — but Bun defines a global `Worker`; this test replaces it with a mock anyway. Use the dom env to be consistent with other service tests; check one existing service test, e.g. `test/frontend/attach-views.test.js`, for the pattern and mirror it):

```js
// @test-env dom
import { describe, expect, test } from "bun:test";
import { renderCadDesignInWorker, CadRenderError } from "../../frontend/src/js/services/cad-render.ts";

function mockWorker(impl) {
  return class {
    static instances = [];
    onmessage = null;
    onerror = null;
    terminated = false;
    constructor(url, opts) { this.url = url; this.opts = opts; this.constructor.instances.push(this); queueMicrotask(() => impl(this)); }
    postMessage(msg) { this.lastMessage = msg; }
    terminate() { this.terminated = true; }
  };
}

const DESIGN = { code: "return box(P.width, P.depth, P.height);", parameters: {}, summary: "box" };

describe("renderCadDesignInWorker", () => {
  test("spawns a module worker at /workers/cad-worker.js and resolves bytes", async () => {
    const Fake = mockWorker((w) => {
      expect(w.url).toBe("/workers/cad-worker.js");
      expect(w.opts).toEqual({ type: "module" });
      w.onmessage({ data: { type: "ok", bytes: new Uint8Array([1, 2, 3]), summary: "box", stats: { tris: 12 } } });
    });
    const orig = globalThis.Worker;
    globalThis.Worker = Fake;
    try {
      const out = await renderCadDesignInWorker(DESIGN, { preludeVersion: "x" }, { timeoutMs: 5000 });
      expect(out.bytes).toEqual(new Uint8Array([1, 2, 3]));
      expect(out.summary).toBe("box");
      expect(Fake.instances[0].lastMessage.type).toBe("render");
      expect(Fake.instances[0].lastMessage.design).toBe(DESIGN);
      expect(Fake.instances[0].terminated).toBe(true);
    } finally {
      globalThis.Worker = orig;
    }
  });

  test("rejects with the worker's error code and terminates", async () => {
    const Fake = mockWorker((w) => w.onmessage({ data: { type: "error", code: "CAD_GUARD_REJECTED", message: "nope" } }));
    const orig = globalThis.Worker;
    globalThis.Worker = Fake;
    try {
      await expect(renderCadDesignInWorker(DESIGN, {}, { timeoutMs: 5000 }))
        .rejects.toMatchObject({ code: "CAD_GUARD_REJECTED", message: "nope" });
    } finally {
      globalThis.Worker = orig;
    }
  });

  test("times out with CAD_RENDER_TIMEOUT and terminates the worker", async () => {
    const Fake = mockWorker(() => { /* never responds */ });
    const orig = globalThis.Worker;
    globalThis.Worker = Fake;
    try {
      await expect(renderCadDesignInWorker(DESIGN, {}, { timeoutMs: 20 }))
        .rejects.toMatchObject({ code: "CAD_RENDER_TIMEOUT" });
      expect(Fake.instances[0].terminated).toBe(true);
    } finally {
      globalThis.Worker = orig;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/frontend/cad-render.test.js`
Expected: FAIL — module `../../frontend/src/js/services/cad-render.ts` not found.

- [ ] **Step 3: Implement**

`frontend/src/js/services/cad-render.ts`:

```ts
/**
 * Main-thread wrapper around the CAD render worker.
 * @remarks The worker is the sandbox boundary (it evals model-written code):
 *   it holds no session token and does no network I/O. The 90 s default cap
 *   bounds kernel runaways — the server-side kernel limits went away when the
 *   kernel moved to the client.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { CadRenderError } from "../workers/cad-render-core.ts";

export { CadRenderError };

export interface CadRenderResult {
  bytes: Uint8Array;
  summary: string;
  stats: unknown;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const WORKER_URL = "/workers/cad-worker.js";

export function renderCadDesignInWorker(
  design: CadDesign,
  runtime: { preludeVersion?: string },
  opts: { timeoutMs?: number } = {},
): Promise<CadRenderResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_URL, { type: "module" });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new CadRenderError("CAD_RENDER_TIMEOUT", "CAD rendering timed out — try a simpler request."))),
      timeoutMs,
    );
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "ok") {
        finish(() => resolve({ bytes: data.bytes, summary: data.summary, stats: data.stats }));
      } else if (data?.type === "error") {
        finish(() => reject(new CadRenderError(data.code ?? "CAD_KERNEL_FAILED", data.message ?? "CAD rendering failed.")));
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(new CadRenderError("CAD_KERNEL_FAILED", event.message || "CAD worker crashed.")));
    };
    worker.postMessage({ type: "render", design, runtime });
  });
}
```

`frontend/src/js/workers/cad-worker.ts`:

```ts
/**
 * CAD render worker: loads the Manifold WASM module, then renders designs
 * (guard → kernel → 3MF) on demand. Self-contained bundle — module workers
 * get no import map. `manifold.wasm` is staged next to this bundle by
 * frontend/scripts/bundle.js.
 */
import Module from "manifold-3d";
import { CadRenderError, renderCadDesign } from "./cad-render-core.ts";

// locateFile is declared zero-arity upstream but Emscripten passes the file
// name — keep the options bag `any` (same ruling as scripts/lib/cad-harness.mjs).
const modulePromise = Module({
  locateFile: (f: string) => new URL(f, import.meta.url).href,
} as any).then((module) => {
  // Manifold registers its JS API lazily; without setup() Manifold.cube is
  // undefined and every script dies with "Manifold.cube is not a function".
  module.setup();
  return module;
});

self.onmessage = async (event: MessageEvent) => {
  const { design, runtime } = event.data ?? {};
  const module = await modulePromise;
  try {
    const out = renderCadDesign(design, module, runtime ?? {});
    (self as unknown as Worker).postMessage(
      { type: "ok", bytes: out.bytes, summary: out.summary, stats: out.stats },
      [out.bytes.buffer],
    );
  } catch (err) {
    const code = err instanceof CadRenderError ? err.code : "CAD_KERNEL_FAILED";
    const message = err instanceof Error ? err.message : "CAD rendering failed.";
    (self as unknown as Worker).postMessage({ type: "error", code, message });
  }
};
```

- [ ] **Step 4: Run tests**

Run: `bun run test -- test/frontend/cad-render.test.js`
Expected: PASS (3 tests). Also run `bun run typecheck:frontend` and fix any worker-typing complaints (Emscripten module typing may need `as any` at the `.then` — mirror `cad-harness.mjs`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/workers/cad-worker.ts frontend/src/js/services/cad-render.ts test/frontend/cad-render.test.js
git commit -m "feat(frontend): CAD render worker + main-thread service"
```

---

### Task 4: `generateCadAsset` seam in api.ts

**Files:**
- Modify: `frontend/src/js/services/backend-client.ts:25-34` (ApiError details)
- Modify: `frontend/src/js/services/api.ts:218-221` (poll failure details), `:226-230` (announce copy), add `generateCadAsset` after `generateAsset` (~line 737)
- Test: `test/frontend/generate-cad-asset.test.js`

**Interfaces:**
- Consumes: `renderCadDesignInWorker`, `CadRenderError` from `./cad-render.ts`; `pollGeneration` (module-private, same file); `buildGenerationManifest`, `writeToIPFS`/`writeJSONToIPFS`, `getFromRemoteIPFS` (same as `generateAsset`).
- Produces:
  - `ApiError` gains optional `details: any` (4th constructor arg, default `null`).
  - `pollGeneration` failure path preserves `error.suitability` / `error.alternative` from the poll body into `ApiError.details`.
  - `export interface GenerateCadAssetParams { prompt: string; nodeId: string; assetId?: string; prevAssetManifestCid?: string; transformMatrix?: number[]; signal?: AbortSignal; onTaskId?: (taskId: string) => void; onProgress?: (update: GenerationProgress) => void; }`
  - `export async function generateCadAsset(params: GenerateCadAssetParams): Promise<GenerateAssetResult>` — result carries `format: "3mf"`, `path: "asset.3mf"`, `taskId`, `providerTaskId`.
  - Generation manifest gains `metadata.cad = { summary, provider, attribution, providerTaskId }` (verify writeJSONToIPFS does not strip unknown metadata keys — check `packages/asset-core/src/manifest/schema.ts` zod metadata object for `.passthrough()`/`.strict()`; if it strips, instead thread attribution via the bubble record in Task 5 and note the deviation).

- [ ] **Step 1: Write the failing test**

`test/frontend/generate-cad-asset.test.js` with `// @test-env dom` first. Mock strategy: `mock.module()` the collaborators BEFORE importing api.ts, following the pattern of an existing api test — read `test/frontend/api.test.js` first and mirror its harness (how it mocks `backend-client` session fetch, `../ipfs/write-to-ipfs.ts`, etc.). The test body:

```js
// @test-env dom
import { describe, expect, test, mock, beforeEach } from "bun:test";

const calls = { fetch: [], writes: [], jsonWrites: [], renders: [] };

mock.module("../../frontend/src/js/services/cad-render.ts", () => ({
  CadRenderError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
  renderCadDesignInWorker: async (design, runtime) => {
    calls.renders.push({ design, runtime });
    return { bytes: new Uint8Array([3, 77, 70]), summary: "A box", stats: { tris: 12 } };
  },
}));
mock.module("../../frontend/src/js/ipfs/write-to-ipfs.ts", () => ({
  writeToIPFS: async (bytes, name) => { calls.writes.push({ bytes, name }); return "bafy-source"; },
  writeJSONToIPFS: async (manifest) => { calls.jsonWrites.push(manifest); return "bafy-manifest"; },
}));
mock.module("../../frontend/src/js/ipfs/remote-ipfs.ts", () => ({
  getFromRemoteIPFS: async () => { throw new Error("no prev"); },
}));
// fetchWithSession lives in backend-client; mock it to serve POST + poll + failure cases.
let fetchHandler;
mock.module("../../frontend/src/js/services/backend-client.ts", () => ({
  ...jest.requireActual ? {} : {}, // (see note below)
}));

// NOTE for implementer: backend-client exports many symbols used across api.ts.
// Do NOT mock the whole module with a hand-rolled factory — instead spy on
// `fetchWithSession` if the existing api.test.js pattern exposes one, or mock
// global fetch following that file. Mirror api.test.js exactly.

const CAD_SUCCESS = {
  status: "success",
  format: "cad-design",
  design: { code: "return box(P.width, P.depth, P.height);", parameters: {}, summary: "A box" },
  runtime: { contractVersion: 1, preludeVersion: "2026-10-04.3" },
  provider: { id: "deepseek", model: "m" },
  attribution: [{ helper: "box", work: "…", author: "…", authorGithub: [], licence: "MIT", url: "u" }],
  diagnostics: { selection: { libraries: [], fit: {}, source: "fallback", jevTokens: { prompt: 0, completion: 0 } }, attempts: [], durationMs: 1, tokens: { prompt: 0, completion: 0 } },
  providerTaskId: "cad-1",
};

describe("generateCadAsset", () => {
  test("polls, renders client-side, uploads 3MF, and returns a 3mf result", async () => {
    const { generateCadAsset } = await import("../../frontend/src/js/services/api.ts");
    // drive fetchHandler: first POST → { taskId: "t1", provider: "cad", status: "running" } (202);
    // then GET poll → CAD_SUCCESS.
    const result = await generateCadAsset({ prompt: "a box", nodeId: "n_1" });
    expect(result.format).toBe("3mf");
    expect(result.path).toBe("asset.3mf");
    expect(result.sourceAssetCid).toBe("bafy-source");
    expect(result.assetManifestCid).toBe("bafy-manifest");
    expect(result.taskId).toBe("t1");
    expect(result.providerTaskId).toBe("cad-1");
    expect(calls.renders).toHaveLength(1);
    expect(calls.writes[0].name).toBe("asset.3mf");
    const manifest = calls.jsonWrites[0];
    expect(manifest.scene.nodes[0].source.format).toBe("3mf");
    expect(manifest.metadata.cad.summary).toBe("A box");
    expect(manifest.metadata.cad.attribution).toHaveLength(1);
  });

  test("CAD_REQUEST_UNSUITABLE keeps suitability and alternative on the error", async () => {
    const { generateCadAsset } = await import("../../frontend/src/js/services/api.ts");
    // POST → { taskId: "t2" }; poll →
    // { status: "failed", error: { code: "CAD_REQUEST_UNSUITABLE", message: "not CAD-able", suitability: 0.2, alternative: { kind: "organic-mesh", provider: "tripo3d" } } }
    const err = await generateCadAsset({ prompt: "a dragon", nodeId: "n_2" }).then(() => null, (e) => e);
    expect(err.code).toBe("CAD_REQUEST_UNSUITABLE");
    expect(err.details.suitability).toBe(0.2);
    expect(err.details.alternative.provider).toBe("tripo3d");
  });

  test("surfaces CAD_NOT_CONFIGURED from the POST", async () => {
    // POST → 503 { error: { code: "CAD_NOT_CONFIGURED", message: "DEEPSEEK_API_KEY is not set" } }
    const err = await generateCadAsset({ prompt: "x", nodeId: "n_3" }).then(() => null, (e) => e);
    expect(err.code).toBe("CAD_NOT_CONFIGURED");
    expect(err.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/frontend/generate-cad-asset.test.js`
Expected: FAIL — `generateCadAsset` is not exported.

- [ ] **Step 3: Implement**

`backend-client.ts` — extend `ApiError`:

```ts
export class ApiError extends Error {
  status: number;
  code: string | null;
  details: any;
  constructor(message: string, status: number, code: string | null = null, details: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = "ApiError";
  }
}
```

`api.ts` poll failure path (replace the `pollData.status === "failed"` block):

```ts
    if (pollData.status === "failed") {
      const { message, code, details } = parseErrorBody(pollData);
      // CAD failures carry suitability/alternative directly on `error` (not
      // under `details`); preserve them so the UI can offer Tripo 3D retry.
      const extras: any = { ...(details ?? {}) };
      if (pollData.error && typeof pollData.error === "object") {
        if ("suitability" in pollData.error) extras.suitability = pollData.error.suitability;
        if ("alternative" in pollData.error) extras.alternative = pollData.error.alternative;
      }
      throw new ApiError(message || "Generation failed", 500, code, Object.keys(extras).length ? extras : null);
    }
```

`api.ts` announce copy (lines 226-230) — make the fallback provider-neutral:

```ts
    announceStatus(
      pollData.stage
        ? `${pollData.stage}… ${progress}%`
        : `Generating 3D asset… ${progress}%`
    );
```

Add after `generateAsset` (~line 737):

```ts
export interface GenerateCadAssetParams {
  prompt: string;
  nodeId: string;
  assetId?: string;
  prevAssetManifestCid?: string;
  transformMatrix?: number[];
  signal?: AbortSignal;
  onTaskId?: (taskId: string) => void;
  onProgress?: (update: GenerationProgress) => void;
}

/**
 * POST /api/v1/generations with provider "cad": the backend returns a design
 * document (no asset bytes — design-on-the-wire). The browser guards and
 * kernels it in a worker, exports 3MF, then runs the SAME upload + manifest
 * flow as generateAsset so every downstream consumer sees format "3mf".
 * @remarks The design is persisted immediately as the 3MF sidecar
 *   (Metadata/arbesk_cad.json) — the poll success is delivered exactly once.
 */
export async function generateCadAsset({
  prompt,
  nodeId,
  assetId,
  prevAssetManifestCid,
  transformMatrix,
  signal,
  onTaskId,
  onProgress,
}: GenerateCadAssetParams): Promise<GenerateAssetResult> {
  announceStatus("Generating parametric CAD design…");
  const response = await fetchWithSession("/generations", {
    body: { provider: "cad", prompt, nodeId },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const { message, code, details } = parseErrorBody(data);
    announceStatus("CAD generation failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(message || `CAD generation failed (HTTP ${response.status})`, response.status, code, details);
  }
  if (!data.taskId) {
    throw new ApiError("CAD generation did not return a task", 500, "CAD_TASK_FAILED");
  }
  onTaskId?.(data.taskId);

  const final = await pollGeneration(data.taskId, signal, onProgress);
  if (final.format !== "cad-design" || !final.design) {
    throw new ApiError("CAD generation returned an unexpected result", 500, "CAD_TASK_FAILED");
  }

  announceStatus("Rendering CAD model…");
  const { renderCadDesignInWorker } = await import("./cad-render.ts");
  const rendered = await renderCadDesignInWorker(final.design, final.runtime ?? {});

  announceStatus("Uploading asset to IPFS…");
  const { writeToIPFS, writeJSONToIPFS } = await import("../ipfs/write-to-ipfs.ts");
  const { getFromRemoteIPFS } = await import("../ipfs/remote-ipfs.ts");

  const manifestData = { format: "3mf", path: "asset.3mf" };
  const assetCid = await writeToIPFS(rendered.bytes, manifestData.path);
  log(`[GEN] browser uploaded cad source asset → ${assetCid}`);

  const manifest = await buildGenerationManifest({
    prompt,
    nodeId,
    assetId,
    prevAssetManifestCid,
    transformMatrix,
    assetCid,
    data: manifestData,
    scaleCompensation: null,
    getFromRemoteIPFS,
  });
  manifest.metadata = {
    ...(manifest.metadata ?? {}),
    cad: {
      summary: rendered.summary,
      provider: final.provider ?? null,
      attribution: final.attribution ?? [],
      providerTaskId: final.providerTaskId ?? null,
    },
  };

  announceStatus("Uploading manifest to IPFS…");
  const assetManifestCid = await writeJSONToIPFS(manifest, null as any, {
    assetId: manifest.asset_id,
  });
  log(`[GEN] browser uploaded manifest → ${assetManifestCid}`);

  announceStatus("Asset generated successfully.");
  return {
    assetManifestCid,
    sourceAssetCid: assetCid,
    format: "3mf",
    path: manifestData.path,
    taskId: data.taskId,
    ...(final.providerTaskId && { providerTaskId: final.providerTaskId }),
  };
}
```

(Verify `log`/`announceStatus` are module imports already used in this file — they are, at lines 452/619. If `parseErrorBody` here doesn't destructure `details` today, extend the local destructuring. Check that `manifest.metadata.cad` survives `writeJSONToIPFS` — inspect the manifest schema's metadata object for passthrough; the pinned test asserts it round-trips. If the schema strips it, plan B: drop the `metadata.cad` block and add `attribution` to the Task 5 bubble record instead — leave a comment in the test skipping the metadata assertion and flag the deviation in your task summary.)

- [ ] **Step 4: Run tests**

Run: `bun run test -- test/frontend/generate-cad-asset.test.js`
Then: `bun run test -- test/frontend/api.test.js` (no regressions in the existing api suite)
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/backend-client.ts frontend/src/js/services/api.ts test/frontend/generate-cad-asset.test.js
git commit -m "feat(frontend): generateCadAsset — client-rendered CAD to 3MF staging"
```

---

### Task 5: Create-panel wiring + rejection UX

**Files:**
- Modify: `frontend/src/pug/includes/studio-sidebar.pug:141-143` (provider option)
- Modify: `frontend/src/js/ui/create-panel.ts` (`isRealProvider` :106, `syncProviderUI` bottom-bar cad label :382, stoppable gate :2035, BYOK gate :2055, `generationErrorMessage` :1844, catch block :2098-2104, `addStoppableWorkingMessage` progress :856-860, stop dialog copy :798-810, provider→cad branch in `onGenerate` :2071)
- Modify: `frontend/src/js/services/app-config.ts` (cadGeneration flag — read the file first and follow its shape)
- Test: `test/frontend/create-panel-cad.test.js` (new)

**Interfaces:**
- Consumes: `generateCadAsset` from `../services/api.ts`; `cadGeneration` from app-config; `addChoiceMessage` from `./chat-messages.ts`.
- Produces: provider select offers `cad` ("Parametric CAD"), hidden when `cadGeneration === false`; `provider !== "mock"` drives the stoppable path; retry-with-tripo choice bubble on `CAD_REQUEST_UNSUITABLE`.

- [ ] **Step 1: Write the failing test**

`test/frontend/create-panel-cad.test.js`, `// @test-env dom` first. Before writing, read `test/frontend/api.test.js` / `test/frontend/attach-views.test.js` to mirror how create-panel's DOM is set up (jsdom + required elements). Keep the test focused on pure/UI-gating behavior that doesn't require the full studio:

```js
// @test-env dom
import { describe, expect, test, mock } from "bun:test";

// Minimal DOM the module touches at import time.
document.body.innerHTML = `
  <select id="providerSelect">
    <option value="mock">Mock (Local)</option>
    <option value="tripo3d">Tripo 3D</option>
    <option value="cad">Parametric CAD</option>
  </select>
  <button id="providerKeyBtn" hidden></button>
  <p id="providerKeyHint" hidden></p>
  <p id="providerBalance" hidden></p>
  <div id="textureQualityRow" hidden></div>
  <button id="imageAttachBtn"></button>
  <input id="imageAttachInput" type="file" />
  <div id="imageAttachChips" hidden></div>
  <p id="multiviewHint" hidden></p>
  <details id="composerSettings" open><summary></summary></details>
  <button id="generateBtn"></button>
  <textarea id="promptInput"></textarea>
  <div id="refineIndicator" hidden><span id="refineIndicatorText"></span></div>
  <select id="tierSelect"><option value="0">Free</option></select>
  <input id="assetNameInput" value="asset" />
  <div id="bottomBarProvider"></div>
  <button id="clearChatBtn"></button>
  <button id="saveAssetBtn"></button>
  <button id="createFirstAssetBtn"></button>
  <div id="chatHistoryList"></div>
`;

// Mock the api barrel so generateAsset/generateCadAsset are spies.
const genCad = mock(async () => ({ assetManifestCid: "m", sourceAssetCid: "s", format: "3mf", path: "asset.3mf", taskId: "t", providerTaskId: "p" }));
const genAsset = mock(async () => ({ assetManifestCid: "m", sourceAssetCid: "s", format: "glb", path: "asset.glb" }));
mock.module("../../frontend/src/js/services/api.ts", () => ({
  generateAsset: genAsset,
  generateCadAsset: genCad,
  getOrCreateSession: mock(async () => ({ token: "t" })),
  getProviderBalance: mock(async () => ({ balance: 0, frozen: 0 })),
  cancelGenerationTask: mock(async () => ({ status: "cancelled" })),
}));

test("cad provider routes through generateCadAsset without a BYOK key", async () => {
  localStorage.setItem("arbesk-provider", "cad");
  await import("../../frontend/src/js/ui/create-panel.ts");
  document.getElementById("generateBtn").click();
  // let async onGenerate settle
  await new Promise((r) => setTimeout(r, 50));
  expect(genCad).toHaveBeenCalled();
  expect(genAsset).not.toHaveBeenCalled();
  // key button stays hidden for the server-paid cad provider
  expect(document.getElementById("providerKeyBtn").hidden).toBe(true);
});
```

(The above DOM list is indicative — the implementer MUST run the import, read the thrown "element not found" errors, and add each missing id until the module imports cleanly; keep ids/classes byte-identical to `studio-sidebar.pug`. Also mock any other heavy barrels the import chain pulls, following `test/frontend/api.test.js`'s example. If create-panel's import graph proves too heavy for a unit test, pivot: export the two decision helpers — `isRealProvider(provider)` and `shouldUseStoppable(provider)` — as pure functions from create-panel and test those, plus keep one DOM-light test for the retry choice via `generationErrorMessage` export. Document whichever pivot you take in the task summary.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/frontend/create-panel-cad.test.js`
Expected: FAIL (module import error or genCad not called — the cad branch doesn't exist yet).

- [ ] **Step 3: Implement**

`frontend/src/pug/includes/studio-sidebar.pug` — inside `select#providerSelect`, add after the tripo3d option:

```pug
                option(value="cad") Parametric CAD
```

`create-panel.ts`:

1. `isRealProvider()` → `return getProvider() === "tripo3d";` and update its doc comment ("Real" now means BYOK; CAD is server-paid like the mock). This automatically: hides the key button/hint for cad (`syncProviderUI`), and removes the BYOK submit gate for cad.
2. Stoppable gate in `onGenerate` (line ~2035) — replace `isRealProvider()` with `getProvider() !== "mock"` (cad tasks are async + cancellable; mock is synchronous). Note `provider` is read later in the function — that's fine, the gate only needs the select value.
3. Provider branch in `onGenerate` — replace the single `generateAsset(buildGenerateAssetArgs(...))` call with:

```ts
    const result = provider === "cad"
      ? await generateCadAsset({
          prompt: effectivePrompt,
          nodeId,
          ...(stoppable && { signal: stoppable.signal, onTaskId: stoppable.onTaskId, onProgress: stoppable.onProgress }),
        })
      : await generateAsset(
          buildGenerateAssetArgs({ effectivePrompt, nodeId, prevAssetManifestCid, transformMatrix, tier, provider, providerKey, retextureSource, imagePayload, stoppable }),
        );
```

   and extend the import from `../services/api.ts` to include `generateCadAsset`. (`prevAssetManifestCid`/`transformMatrix` are intentionally not passed for cad v1 — the cad bubble starts a fresh asset; note it in the task summary.)
4. `generationErrorMessage` — insert code branches before the status checks:

```ts
    if (err.code === "CAD_REQUEST_UNSUITABLE") {
      return "Parametric CAD can't model this request — it suits mechanical/printable shapes, not organic or freeform ones. Try Tripo 3D for mesh generation.";
    }
    if (err.code === "CAD_NOT_CONFIGURED") {
      return "Parametric CAD isn't enabled on this deployment.";
    }
    if (err.code === "CAD_PRELUDE_MISMATCH") {
      return err.message || "CAD runtime is out of date — refresh the page.";
    }
    if (err.code === "CAD_RENDER_TIMEOUT") {
      return "CAD rendering timed out — try a simpler request.";
    }
```

5. Retry choice — in the `catch` of `onGenerate`, before the generic `addChatMessage("system", generationErrorMessage(err))`:

```ts
    if (err instanceof ApiError && err.code === "CAD_REQUEST_UNSUITABLE" && err.details?.alternative?.provider === "tripo3d") {
      addChoiceMessage(
        generationErrorMessage(err),
        [
          { label: "Retry with Tripo 3D", value: "tripo3d" },
          { label: "Not now", value: "dismiss" },
        ],
        (value) => {
          if (value !== "tripo3d") return;
          if (providerSelect) {
            providerSelect.value = "tripo3d";
            localStorage.setItem(PROVIDER_STORAGE, "tripo3d");
            syncProviderUI();
          }
          promptInput.value = effectivePrompt;
          void onGenerate();
        },
      );
      return;
    }
```

   (`addChoiceMessage` import check: create-panel may already import from `./chat-messages.ts` — add to that import.)

6. Indeterminate progress — in `addStoppableWorkingMessage.onProgress` (~line 856), guard the zero case (cad polls always report 0):

```ts
    onProgress: ({ stage, progress }) => {
      // Stage labels ("Rigging skeleton", …) reflect the current chain phase
      // more accurately than the initial text; fall back to it otherwise.
      // progress 0 means "no data" (cad) — keep the bar indeterminate.
      if (progress > 0) working?.setProgress(progress / 100, stage || undefined);
      else if (stage) working?.setProgress(undefined as any, stage);
    },
```

   Check `WorkingMessageHandle.setProgress` implementation in `chat-messages.ts` — if it doesn't accept `undefined` fraction for indeterminate, adjust setText(stage) instead (read the impl; pick the variant that renders an indeterminate bar and add the missing DOM test there if none exists).

7. Stop dialog copy (`showStopTaskDialog`, ~line 802) — generalize:

```ts
      <p style="margin:0 0 var(--size-2)">Stop this task? Provider credits already spent are <strong>not</strong> refunded — you will lose them, and the partial result is discarded.</p>
      <button id="stopTaskConfirm" class="btn btn-danger" type="button">Stop task</button>`;
```

8. Provider availability gating — `services/app-config.ts`: add `cadGeneration?: boolean` to the config type and read it where the config is fetched (follow the file). Then in `create-panel.ts`, where the provider select is hydrated (~line 390), hide the cad option when unavailable:

```ts
  // Parametric CAD is only listed when the deployment can serve it
  // (CAD_MOCK_GENERATION or DEEPSEEK_API_KEY) — otherwise it's a dead end.
  const cadOption = providerSelect?.querySelector('option[value="cad"]');
  if (cadOption && getConfig().cadGeneration === false) cadOption.remove();
```

   (If app-config fetches lazily/after hydration, gate inside the config-load callback instead — follow the file's pattern. The e2e stack always has mock cad on, so default-visible when config unknown is correct: only hide on explicit `false`.)

- [ ] **Step 4: Run tests**

Run: `bun run test -- test/frontend/create-panel-cad.test.js`
Then: `bun run test -- test/frontend/create-panel` (any existing create-panel suites must stay green)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pug/includes/studio-sidebar.pug frontend/src/js/ui/create-panel.ts frontend/src/js/services/app-config.ts test/frontend/create-panel-cad.test.js
git commit -m "feat(frontend): Parametric CAD provider option + rejection UX"
```

---

### Task 6: Bundle + staging + deployment integrity

**Files:**
- Modify: `frontend/scripts/bundle.js` (worker build + wasm staging, after line 163)
- Modify: `frontend/package.json` (only if `@arbesk/cad-gen` fails to resolve during build — see Step 3 note)
- Test: `test/frontend/deployment-integrity.test.js` (extend with a "cad worker bundling" describe)

**Interfaces:**
- Consumes: `frontend/src/js/workers/cad-worker.ts` (Task 3).
- Produces: `frontend/dist/workers/cad-worker.js` + `frontend/dist/workers/manifold.wasm` after `bun run build:frontend` (and matching `.br` siblings).

- [ ] **Step 1: Write the failing test**

In `test/frontend/deployment-integrity.test.js`, add (mirroring the style of the "gltf-transform vendoring" describe at line 415):

```js
  describe("cad worker bundling", () => {
    const WORKER_PATH = resolve(ROOT_DIR, "frontend/src/js/workers/cad-worker.ts");
    const CORE_PATH = resolve(ROOT_DIR, "frontend/src/js/workers/cad-render-core.ts");
    const BUNDLE_PATH = resolve(ROOT_DIR, "frontend/scripts/bundle.js");

    test("cad worker exists and renders via the shared core", () => {
      expect(existsSync(WORKER_PATH)).toBe(true);
      expect(readFileSync(WORKER_PATH, "utf-8")).toContain("renderCadDesign");
    });

    test("cad render core stays browser-safe (no backend subpath, no node builtins)", () => {
      const content = readFileSync(CORE_PATH, "utf-8");
      expect(content).not.toContain("/backend/");
      expect(content).not.toMatch(/\bnode:(fs|path|child_process)\b/);
    });

    test("bundle.js builds the cad worker and stages manifold.wasm", () => {
      const content = readFileSync(BUNDLE_PATH, "utf-8");
      expect(content).toContain("cad-worker.js");
      expect(content).toContain("manifold.wasm");
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/frontend/deployment-integrity.test.js`
Expected: FAIL — bundle.js doesn't mention cad-worker/manifold.

- [ ] **Step 3: Implement**

`frontend/scripts/bundle.js` — after the gltf-worker build (line 155), before/after the brotli staging block (lines 157-163):

```js
  // 3c. Self-contained CAD render worker (Manifold WASM kernel + guard +
  //     3MF export). Same no-import-map constraint as the glTF worker.
  await run({
    ...common,
    entrypoints: [path.join(srcRoot, 'workers/cad-worker.ts')],
    outdir: path.join(distRoot, 'workers'),
    naming: 'cad-worker.js',
    format: 'esm',
    plugins: [nodeBuiltinsStub],
  }, 'workers/cad-worker.js');

  // manifold-3d's glue fetches its WASM relative to locateFile's return
  // (the worker resolves it against its own URL) — stage it next to the
  // worker. Resolve from the cad-gen workspace like brotli-wasm, since bun's
  // isolated installs don't guarantee a root-level copy.
  const MANIFOLD_WASM_FILE = path.join(
    path.dirname(require.resolve('manifold-3d/package.json', {
      paths: [path.resolve(__dirname, '../../packages/cad-gen')],
    })),
    'manifold.wasm',
  );
  fs.copyFileSync(MANIFOLD_WASM_FILE, path.join(distRoot, 'workers', 'manifold.wasm'));
  console.log('[BUNDLE] manifold.wasm staged next to cad-worker.js');
```

(`fs` is required inside `build()` today at line 159 (`const fs = require('fs')`) — hoist that require to the top of `build()` or reuse the existing local.)

Then build: `bun run build:frontend`. Verify `ls -la frontend/dist/workers/` shows `cad-worker.js`, `manifold.wasm` (+ `.br` siblings from compress). Note: `manifold-3d/package.json` resolution — if Bun's require doesn't accept the `/package.json` subpath with `paths`, resolve `manifold-3d/manifold.js` and take dirname; verify at runtime. If `@arbesk/cad-gen` doesn't resolve from the frontend workspace at all (isolated installs), add `"@arbesk/cad-gen": "*"` to `frontend/package.json` dependencies (matching how other workspaces reference it) and re-run `bun install`.

Also confirm the served path: the backend serves `frontend/dist` statically (check `src/index.ts` for the static mount and `.br` content negotiation) — `/workers/cad-worker.js` must be reachable; the e2e smoke in Task 7 proves it.

- [ ] **Step 4: Run tests**

Run: `bun run test -- test/frontend/deployment-integrity.test.js`
Expected: PASS. Also `bun run test:frontend` green.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/bundle.js test/frontend/deployment-integrity.test.js frontend/package.json
git commit -m "build(frontend): bundle CAD worker + stage manifold.wasm"
```

---

### Task 7: E2E — CAD generation flow

**Files:**
- Modify: `e2e/global-setup.mjs:315` (backend env)
- Modify: `e2e/helpers/studio-selectors.mjs` (choice buttons)
- Create: `e2e/specs/20-cad-generation.spec.js`
- Modify: `e2e/README.md` (spec list, if it enumerates specs)

**Interfaces:**
- Consumes: everything prior (backend mock cad, worker bundle, UI wiring).
- Produces: green Playwright spec covering select-cad → generate → 3MF bubble → preview → save → manifest assertions.

- [ ] **Step 1: Write the failing spec**

`e2e/specs/20-cad-generation.spec.js`. First read `e2e/specs/02-generate-asset.spec.js` and `e2e/specs/16-3mf-generation.spec.js` end-to-end and mirror their harness (wallet setup helpers, generate helper, waitFor helpers from `e2e/helpers/flows.mjs`). Then:

```js
// @ts-check
import { test, expect } from "@playwright/test";
import { S } from "../helpers/studio-selectors.mjs";
// import the wallet/page helpers 02-generate-asset uses

test.describe("CAD generation (parametric, client-rendered)", () => {
  test("generates a parametric box, shows a 3MF bubble, saves as 3mf asset", async ({ page }) => {
    // 1. wallet setup + studio load — copy from 02-generate-asset.spec.js

    // 2. pick Parametric CAD (mock cad is on in the e2e stack)
    await page.locator(S.providerSelect).selectOption("cad");

    // 3. prompt + generate — copy the typing/submit flow from 02
    await page.locator("/* prompt input selector */").fill("a 40 by 30 by 20 mm box");
    await page.locator(S.generateBtn).click();

    // 4. version-card bubble appears with a 3MF badge and live preview
    const bubble = page.locator(S.assetBubble).first();
    await expect(bubble).toBeVisible({ timeout: 60_000 });
    await expect(bubble.locator(".chat-asset-format")).toHaveText("3MF");
    await expect(bubble.locator("canvas")).toBeVisible();

    // 5. save via the bubble's send button, then verify the manifest
    await bubble.locator(S.assetBubbleSend).click();
    await expect(bubble).toHaveClass(/chat-bubble-asset-saved/);
    // manifest helpers from e2e/helpers/manifest.mjs (mirror 03-save-and-publish):
    // - metadata.computed.format === "3mf"
    // - root node source path asset.3mf, format "3mf"
    // - metadata.cad.summary present
  });

  test("unsuitable request offers a Tripo 3D retry", async ({ page }) => {
    // mock cad settles every prompt as suitable — so this test instead
    // asserts the wiring exists by unit coverage; SKIP at runtime with a
    // note, unless you add a CAD_MOCK_UNSUITABLE env the mock reads
    // (allowed: make createMockCadGenerator throw CadRequestUnsuitable when
    // process.env.CAD_MOCK_UNSUITABLE === "true" and the prompt contains
    // "dragon"; add the env to global-setup; then assert the choices bubble
    // appears and picking "Retry with Tripo 3D" flips #providerSelect).
    test.skip(true, "requires CAD_MOCK_UNSUITABLE toggle");
  });
});
```

(The mock-unsuitable toggle is a small, in-scope addition to `createMockCadGenerator` from Task 1 — throwing `{ code: "CAD_REQUEST_UNSUITABLE", ... }` shaped like `CadRequestUnsuitable`. Check how the real generator signals unsuitability — `packages/cad-gen/src/backend/facade.ts` throws/rejects with a `CadRequestUnsuitable`-typed error carrying `suitability`; mirror it. Wire `CAD_MOCK_UNSUITABLE` into global-setup too. This makes the rejection E2E real instead of skipped — prefer implementing it.)

- [ ] **Step 2: Run spec to verify it fails**

Run: `bun run build:frontend && bun run test:e2e -- --project=chromium e2e/specs/20-cad-generation.spec.js`
Expected: FAIL (option missing / bubble never appears — pre-implementation).

- [ ] **Step 3: Implement the remaining glue**

`e2e/global-setup.mjs` backend spawn env (~line 315, next to `MOCK_3D_GENERATION`):

```js
        CAD_MOCK_GENERATION: "true",
```

and to the "compatible backend already running" mismatch checks (line ~283, after `mockGeneration off`):

```js
      if (cfg.cadGeneration !== true) mismatches.push("cadGeneration off");
```

`e2e/helpers/studio-selectors.mjs` — add:

```js
  choiceBubble: ".chat-bubble-choices",
  choiceButton: (label) => `.chat-bubble-choices button:has-text("${label}")`,
```

- [ ] **Step 4: Run the spec green**

Run: `bun run test:e2e -- --project=chromium e2e/specs/20-cad-generation.spec.js`
Expected: PASS. Debug loop is expected here (worker WASM load in headless, badge text, save flow timing) — keep changes minimal and in-spec.

- [ ] **Step 5: Commit**

```bash
git add e2e/global-setup.mjs e2e/helpers/studio-selectors.mjs e2e/specs/20-cad-generation.spec.js src/api/generation-providers.ts e2e/README.md
git commit -m "test(e2e): CAD generation flow spec + mock unsuitable toggle"
```

---

### Task 8: Docs sweep + full verification

**Files:**
- Modify: `docs/API_SPEC.md` (cad section + config + env)
- Modify: `AGENTS.md` (§1 provider flow)
- Modify: `packages/cad-gen/AGENTS.md` (attribution-persistence note)
- Modify: `docs/CURRENT_STATUS.md` only if it tracks provider status (check)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: docs matching behavior; full gate green.

- [ ] **Step 1: Docs**

`docs/API_SPEC.md`:
- In the cad provider section (~lines 176-347): note the browser renders the design (guard → kernel → 3MF via `manifold-3d`), that 3MF is the stored format (`format: "3mf"` node, composite-3mf at save), and the `CAD_MOCK_GENERATION` env (canned design, waives `DEEPSEEK_API_KEY`).
- `/api/v1/config` docs: `cadGeneration` field.

`AGENTS.md` §1 (the generation bullet): append — "the `cad` option renders client-side: the poll returns a design document (`format: "cad-design"`), the browser worker (`frontend/src/js/workers/cad-worker.ts`, staged `manifold.wasm`) guards → kernels → exports 3MF, and the bubble/save flow treats it as a normal `format: "3mf"` asset (composite-3mf, IPFS part dedup). `CAD_MOCK_GENERATION=true` serves a canned box for dev/E2E."

`packages/cad-gen/AGENTS.md`: update the note that attribution persistence is the client's job — it now happens via `manifest.metadata.cad` written by `generateCadAsset`.

- [ ] **Step 2: Full gate**

```bash
bun run test
bun run lint
bun run typecheck
bun run typecheck:frontend
bun run test:frontend
bun run build:frontend
bun run test:e2e -- --project=chromium e2e/specs/20-cad-generation.spec.js e2e/specs/02-generate-asset.spec.js e2e/specs/16-3mf-generation.spec.js e2e/specs/03-save-and-publish.spec.js
```

(Use the multi-spec form `bun run test:e2e -- --project=chromium --grep "CAD|generate|3MF|save"` if the runner rejects multiple paths — match e2e/README.md usage. The full e2e suite is run by the parent agent after this task.)

Expected: everything green.

- [ ] **Step 3: Commit**

```bash
git add docs/API_SPEC.md AGENTS.md packages/cad-gen/AGENTS.md
git commit -m "docs: CAD frontend integration (API spec, AGENTS guides)"
```

---

## Self-review notes (spec coverage)

- Spec §4.1 render core → Task 2. §4.2 worker → Task 3. §4.3 service → Task 3. §4.4 api seam → Task 4. §4.5 create panel → Task 5. §4.6 mock → Task 1 (+ Task 7 toggle). §4.6a availability → Tasks 1+5. §4.7 bundle → Task 6. §5 provenance (`metadata.cad`) → Task 4 (with schema-strips fallback noted). §5 action row — no code needed (existing gates return []). §5 preview — no code needed (3mf handler). §6 error matrix → Tasks 4 (details) + 5 (copy/choices) + stop dialog generalization. §7 testing → Tasks 1-7 each ship their tests. §8 risks → manifold typing honored (Task 3), kernel timeout (Task 3), once-only success (Task 4 sidecar), unknown-format fallback (converge-to-3mf design), wasm `.br` (Task 6 follows existing pattern).
- Type consistency: `CadRenderError(code, message)` with `.code` used in Tasks 2/3/4/5 identically. `renderCadDesign(design, module, runtime?)` signature identical in Tasks 2/3. `renderCadDesignInWorker(design, runtime, opts?)` identical in Tasks 3/4. `generateCadAsset(params)` result shape reuses `GenerateAssetResult` (Task 4) consumed by `presentGenerationResult` unchanged (Task 5).

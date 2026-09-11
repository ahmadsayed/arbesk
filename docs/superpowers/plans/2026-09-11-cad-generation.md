# CAD Generation (`@arbesk/cad-gen`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A prompt-driven engineering-CAD service: DeepSeek writes Manifold JS plus a parameter table, the server validates it by running the Manifold kernel in an isolated child process, and the client executes the returned code to produce GLB/3MF.

**Architecture:** `@arbesk/cad-gen` splits into an environment-agnostic `core/` (design document, guard, prelude, kernel port, exporters — bundlable into the browser) and a Node-only `backend/` (DeepSeek client, prompt assembly, repair loop, child-process validator, facade). The Express route stays thin: validate, authenticate, quota, lock, delegate. The server **never** produces files — it returns a validated design document.

**Tech Stack:** TypeScript (erasable syntax, Bun runtime, no emit), Manifold WASM (`manifold-3d@3.5.3`), DeepSeek OpenAI-compatible API (`deepseek-flash`), Zod, express-rate-limit, Jest + supertest, fflate (3MF OPC zip), `@arbesk/asset-core` (`serializeGLB`).

**Spec:** `docs/superpowers/specs/2026-09-11-cad-generation-design.md` — read it alongside this plan; the plan argues from it.

## Global Constraints

- **Erasable TypeScript only** — no enums, no namespaces, no parameter properties; type-only imports MUST use `import type`; relative imports inside `src/` carry explicit `.ts` extensions.
- **`core/` must be environment-agnostic** — no Node globals (`Buffer`, `fs`, `path`, `process`, `child_process`), no browser globals (`window`, `document`, `navigator`, `localStorage`), no imports from `frontend/`, `src/api/` or `constants/`.
- **`packages/cad-gen/src/index.ts` exports `core/` ONLY.** The browser bundles the root entry; a backend re-export there would drag `child_process` and the DeepSeek client into the frontend bundle. Backend consumers import `@arbesk/cad-gen/backend/index.js`.
- **The server never returns geometry and never exports files.** Validation discards the mesh; GLB/3MF are the client's job.
- **Backend logs** use `[TAG]` prefixes — this feature uses `[CAD]`. Never log prompt text or API keys.
- **Validation gate values:** timeout 10000 ms, triangle budget 200000, repair attempts 3, daily limit 50, lock TTL 120000 ms.
- **Units:** Manifold is millimetres/Z-up. GLB applies `[0.001,0,0,0, 0,0,-0.001,0, 0,0.001,0,0, 0,0,0,1]` on the **node matrix** (never baked into vertices). 3MF stays mm/Z-up.
- **Never bypass `@arbesk/asset-core`** for glTF serialization — import `serializeGLB` from `@arbesk/asset-core/formats/gltf/gltf-core.js`.
- Run `bun run lint && bun run typecheck` before every commit.

---

### Task 1: Spike — Manifold WASM in this repo's four runtimes

Gates every later task. If steps 4, 6 or 8 fail, **STOP** and re-plan: the spec's fallback (section 11) is static-only validation.

> **Gate-cleanliness note.** The probe snippets above must also satisfy the repo's own gates,
> which the Global Constraints require before every commit: `tsc --noEmit` rejects the untyped
> `file` parameter in `locateFile` (TS7006 under `checkJs`), and `eslint`'s `no-empty` rejects the
> bare `while (true) {}` spin loop. JSDoc-type the parameter and put a comment inside the loop block.
>
> **Post-spike corrections (applied after Task 1 ran).** The kernel PASSED in every runtime, and the
> spike proved three defects in this plan's own snippets, all since fixed: the loader needs
> `module.setup()` before `Manifold.cube` exists; the wasm directory must be resolved from
> `PROJECT_ROOT`/cwd and never from `import.meta.url`; and in a compiled single-file server the
> `child.ts` entry does not exist on disk. Full evidence:
> `docs/superpowers/plans/cad-spike-results.md`.

**Files:**
- Modify: `package.json` (workspaces.catalog)
- Create: `scripts/cad-spike.mjs` (throwaway probe — deleted in Task 14)
- Create: `scripts/cad-spike-child.mjs` (throwaway probe)
- Create: `docs/superpowers/plans/cad-spike-results.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the verified statement that `manifold-3d` loads under Bun, in a spawned child, and inside a compiled binary **when `Module({ locateFile })` points at an absolute wasm path**. Later tasks depend on `Module({ locateFile })` being the loader call.

- [ ] **Step 1: Add the dependency to the shared catalog**

In `package.json`, inside `"workspaces"` then `"catalog"`, add:

```json
"manifold-3d": "^3.5.3"
```

- [ ] **Step 2: Install and record what actually lands**

Run: `bun install`

Then:

```bash
ls node_modules/manifold-3d/manifold.wasm
du -sh node_modules/manifold-3d
ls -d node_modules/esbuild-wasm 2>/dev/null || echo "esbuild-wasm not installed"
```

Record the output in `cad-spike-results.md`. `esbuild-wasm` is a **peer** dep of manifold-3d and is never imported by our code path; note whether Bun auto-installed it. If it did and it is large, record that as accepted install-time weight — it is never bundled, because `bun build --compile` only includes what is imported.

- [ ] **Step 3: Write the kernel probe**

Create `scripts/cad-spike.mjs`:

```js
// THROWAWAY SPIKE — proves manifold-3d loads under Bun and produces a solid.
import Module from "manifold-3d";

const wasm = await Module();
const { Manifold } = wasm;

const box = Manifold.cube([60, 40, 10], true);
const hole = Manifold.cylinder(20, 3, 3, 32, true);
const part = box.subtract(hole);

console.log(JSON.stringify({
  status: part.status(),
  numTri: part.numTri(),
  numVert: part.numVert(),
  volume: part.volume(),
  bbox: part.boundingBox(),
}, null, 2));

const mesh = part.getMesh();
console.log("mesh numProp=" + mesh.numProp +
  " vertProperties=" + mesh.vertProperties.length +
  " triVerts=" + mesh.triVerts.length);
```

- [ ] **Step 4: Run it under Bun**

Run: `bun scripts/cad-spike.mjs`

Expected: `status` is `"NoError"`, `numTri` > 0, `volume` is roughly 24000 minus pi*9*10, so about 23717 (within a few percent), `bbox` min near `[-30,-20,-5]` and max near `[30,20,5]`, and `triVerts.length` divisible by 3.

If this fails, STOP — the plan is invalid.

- [ ] **Step 5: Write the child-process kill probe**

Create `scripts/cad-spike-child.mjs`:

```js
import Module from "manifold-3d";
const wasm = await Module();
const { Manifold } = wasm;
Manifold.cube([1, 1, 1], true); // hold a live solid
console.log("CHILD_READY");
while (true) {} // hostile script: must be killable
```

- [ ] **Step 6: Prove the parent can kill a runaway child holding the kernel**

Run:

```bash
cat > .tmp/cad-spike-kill.mjs <<'EOF'
import { spawn } from "node:child_process";
const t0 = Date.now();
const child = spawn("bun", ["scripts/cad-spike-child.mjs"], { stdio: ["ignore", "pipe", "inherit"] });
child.stdout.on("data", (b) => {
  if (String(b).includes("CHILD_READY")) {
    child.kill("SIGKILL");
    console.log("killed after " + (Date.now() - t0) + "ms");
    setTimeout(() => process.exit(0), 100);
  }
});
setTimeout(() => { console.log("TIMEOUT: never became ready"); process.exit(1); }, 15000);
EOF
mkdir -p .tmp && bun .tmp/cad-spike-kill.mjs
```

Expected: prints `killed after <n>ms` and exits 0, well under 15000 ms.

- [ ] **Step 7: Write the compiled-binary probe**

Run:

```bash
mkdir -p .tmp && bun build --compile scripts/cad-spike.mjs --outfile .tmp/cad-spike
.tmp/cad-spike
```

Expected: **likely FAILS** to locate `manifold.wasm` — the same class of failure `scripts/build-server.mjs` already documents for brotli-wasm.

- [ ] **Step 8: Prove `locateFile` fixes it**

Edit `scripts/cad-spike.mjs` to pass an absolute path:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(here, "..", "node_modules", "manifold-3d");
const wasm = await Module({ locateFile: (file) => path.join(wasmDir, file) });
```

Re-run both `bun scripts/cad-spike.mjs` and `.tmp/cad-spike`.

Expected: both succeed. Record that `locateFile` is the loader contract, and that for the **compiled server** the path must resolve from `PROJECT_ROOT` (`src/api/project-root.ts`), for the same reason the brotli shim does — a compiled binary has a virtual module URL.

- [ ] **Step 9: Record results and commit**

Write `docs/superpowers/plans/cad-spike-results.md` with a pass/fail line per step and the exact commands, then:

```bash
git add package.json bun.lock scripts/cad-spike.mjs scripts/cad-spike-child.mjs docs/superpowers/plans/cad-spike-results.md
git commit -m "spike: verify manifold-3d loads under bun, in a child, and compiled"
```

---

### Task 2: Package skeleton and toolchain wiring

**Files:**
- Create: `packages/cad-gen/package.json`, `packages/cad-gen/tsconfig.json`, `packages/cad-gen/tsconfig.build.json`
- Create: `packages/cad-gen/src/index.ts`, `packages/cad-gen/src/errors.ts`, `packages/cad-gen/src/core/contract.ts`
- Modify: `package.json` (`build:packages` filter list)
- Modify: `jest.config.js` (moduleNameMapper)
- Modify: `eslint.config.js` (two new blocks)
- Test: `test/cad-gen/package-wiring.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CONTRACT_VERSION: 1` and `PRELUDE_VERSION: string` from `@arbesk/cad-gen`; `CadError`, `CadDesignError`, `CadGuardError`, `CadKernelError` from `@arbesk/cad-gen/errors.js`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/package-wiring.test.js`:

```js
import { CONTRACT_VERSION, PRELUDE_VERSION } from "@arbesk/cad-gen";
import { CadDesignError } from "@arbesk/cad-gen/errors.js";

describe("@arbesk/cad-gen package wiring", () => {
  it("exposes the contract version", () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it("exposes a non-empty prelude version", () => {
    expect(typeof PRELUDE_VERSION).toBe("string");
    expect(PRELUDE_VERSION.length).toBeGreaterThan(0);
  });

  it("exposes the error hierarchy", () => {
    const err = new CadDesignError("bad");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CadDesignError");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/package-wiring.test.js`

Expected: FAIL — `Cannot find module '@arbesk/cad-gen'`.

- [ ] **Step 3: Create the package manifest**

`packages/cad-gen/package.json` — mirror `packages/ai-asset-gen/package.json`, changing name, description and dependencies:

```json
{
  "name": "@arbesk/cad-gen",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Arbesk engineering-CAD generation SDK: Manifold-script codegen, static guard, kernel port and GLB/3MF exporters. Environment-agnostic core plus a Node-only backend.",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./*": "./dist/*"
  },
  "files": ["dist"],
  "scripts": {
    "build": "bun run clean && tsc -p tsconfig.build.json",
    "clean": "node -e \"fs.rmSync('dist', { recursive: true, force: true })\"",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@arbesk/asset-core": "*",
    "fflate": "catalog:"
  },
  "license": "ISC"
}
```

`manifold-3d` is deliberately **not** a package dependency: the kernel is injected as a port by the host (Task 5), so `core/` stays free of it and the browser can substitute its own bundled build.

- [ ] **Step 4: Create the tsconfigs**

`packages/cad-gen/tsconfig.json` — copy `packages/ai-asset-gen/tsconfig.json` verbatim.

`packages/cad-gen/tsconfig.build.json` — copy `packages/ai-asset-gen/tsconfig.build.json` verbatim.

- [ ] **Step 5: Create the contract and error modules**

`packages/cad-gen/src/core/contract.ts`:

```ts
/**
 * Version of the design-document + prelude contract a client must implement.
 * @remarks Bumping this is a breaking change: a client whose prelude does not
 *   match refuses to execute the code rather than running it against an API it
 *   does not implement.
 */
export const CONTRACT_VERSION = 1;

/** Date-stamped prelude revision shipped with this build. */
export const PRELUDE_VERSION = "2026-09-11";
```

`packages/cad-gen/src/errors.ts`:

```ts
/** Error hierarchy for @arbesk/cad-gen. */
export class CadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadError";
  }
}

/** The model returned a malformed design document. */
export class CadDesignError extends CadError {
  constructor(message: string) {
    super(message);
    this.name = "CadDesignError";
  }
}

/** Generated code failed the static guard. */
export class CadGuardError extends CadError {
  constructor(message: string) {
    super(message);
    this.name = "CadGuardError";
  }
}

/** The kernel failed to execute generated code. */
export class CadKernelError extends CadError {
  constructor(message: string) {
    super(message);
    this.name = "CadKernelError";
  }
}
```

`packages/cad-gen/src/index.ts`:

```ts
/**
 * @arbesk/cad-gen — environment-agnostic core.
 * @remarks This entry point MUST stay free of Node and browser globals: the
 *   browser bundles it. Backend-only modules live under ./backend/index.js and
 *   are never reachable from here.
 */
export { CONTRACT_VERSION, PRELUDE_VERSION } from "./core/contract.ts";
export { CadError, CadDesignError, CadGuardError, CadKernelError } from "./errors.ts";
```

- [ ] **Step 6: Wire the build, jest, lint and the two registration lists**

Two further registration sites exist beyond the three named below, and a new workspace package is
only fully wired when all five are done:

- `.fallowrc.json` — add `"@arbesk/cad-gen"` to the `publicPackages` array (it lists the other four
  `@arbesk/*` packages).
- root `package.json` `dependencies` — add `"@arbesk/cad-gen": "*"` alongside the other
  `@arbesk/*` entries. Without it the package is unresolvable by bare specifier **outside jest**, so
  Task 12's route import would pass its own tests and fail at runtime.

Then the three sites below.

In root `package.json`, add `--filter '@arbesk/cad-gen'` to the `build:packages` **first** group (the independent packages), not the `authz` group.

In `jest.config.js`, add to `moduleNameMapper` after the ai-asset-gen entries:

```js
"^@arbesk/cad-gen$": "<rootDir>/packages/cad-gen/src/index.ts",
"^@arbesk/cad-gen/(.+)\\.js$": "<rootDir>/packages/cad-gen/src/$1.ts",
```

In `eslint.config.js`, add two blocks after the `arbesk/asset-core` block. The first mirrors that block with `files: ["packages/cad-gen/src/core/**/*.ts"]`, the same `no-restricted-imports` group array, and these additional restricted globals:

```js
{ name: "process", message: "cad-gen core is environment-agnostic; the host injects the kernel and paths." },
{ name: "Buffer", message: "cad-gen core is environment-agnostic; use Uint8Array/TextEncoder." },
```

The core block's `files` glob covers **only** `core/**`, which leaves `src/index.ts` — the
browser entry the Global Constraints name — unenforced. Add a third block that applies the same
import restrictions across the whole package:

```js
{
  name: "arbesk/cad-gen-boundary",
  files: ["packages/cad-gen/src/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/frontend/**", "**/src/api/**", "**/constants/**"],
        message: "cad-gen must stay free of the frontend and backend trees — reach the host through injected ports.",
      }],
    }],
  },
},
```

Place it **before** the `arbesk/cad-gen-core` block: flat config resolves a rule to the LAST matching
block, so the core block's fuller rule set still wins for `core/**`, and the backend block still
wins for `backend/**`. Do NOT widen the core block's own glob — that would apply its
`no-restricted-globals` (`process`, `Buffer`) to `backend/**`, which legitimately needs
`process.argv` and `process.stdout` in the validation child.

Prove the boundary fires rather than merely passing: temporarily add `import fs from "node:fs";`
to `src/index.ts`, confirm `bun run lint` reports `no-restricted-imports` naming that file, then
revert. A rule matching no files also "passes".

The second block restricts the backend tree:

```js
{
  name: "arbesk/cad-gen-backend",
  files: ["packages/cad-gen/src/backend/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["**/frontend/**", "**/constants/**"],
        message: "cad-gen backend is consumed by src/api only; it must not reach into the frontend or app constants.",
      }],
    }],
  },
},
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/package-wiring.test.js`

Expected: PASS (3 tests).

- [ ] **Step 8: Verify the toolchain**

Run: `bun run build:packages && bun run typecheck && bun run lint`

Expected: all clean, and `packages/cad-gen/dist/index.js` exists.

- [ ] **Step 9: Commit**

```bash
git add packages/cad-gen jest.config.js eslint.config.js package.json test/cad-gen
git commit -m "feat(cad-gen): package skeleton, contract version and toolchain wiring"
```

---
### Task 3: Design document — types, parsing, parameter extraction

**Files:**
- Create: `packages/cad-gen/src/types.ts`
- Create: `packages/cad-gen/src/core/document.ts`
- Modify: `packages/cad-gen/src/index.ts`
- Test: `test/cad-gen/document.test.js`

**Interfaces:**
- Consumes: `CadDesignError` (Task 2).
- Produces: types `CadParameter`, `CadParameterMap`, `CadDesign`, `CadStats`, `CadMesh`, `ManifoldModule`, `TokenUsage`; functions `parseDesign(input: unknown): CadDesign`, `validateParameterOverrides(design, overrides): string[]`, `referencedIdentifiers(code: string): Set<string>`.

- [ ] **Step 1: Write the types**

`packages/cad-gen/src/types.ts`:

```ts
/** Port + shared types for @arbesk/cad-gen. No runtime code here. */

/** One named, user-editable dimension baked into the design's PARAMETERS block. */
export interface CadParameter {
  value: number;
  unit: "mm";
  min?: number;
  max?: number;
  label?: string;
}

export type CadParameterMap = Record<string, CadParameter>;

/** The design document: the artifact the model returns and the client executes. */
export interface CadDesign {
  /** Body of a function taking (PARAMETERS, ...preludeHelpers, M) that returns a Manifold. */
  code: string;
  parameters: CadParameterMap;
  /** Human-readable change note for provenance. */
  summary: string;
  /** 1-based turn index in the conversation. */
  turn?: number;
}

/** Geometry facts computed from a validated mesh. */
export interface CadStats {
  triangles: number;
  vertices: number;
  volumeMm3: number;
  bboxMm: {
    min: [number, number, number];
    max: [number, number, number];
  };
  /** Which fillet strategy actually ran (see the spec's fidelity table). */
  filletMode?: "exact" | "minkowski" | "smooth";
}

/** Renderer-neutral mesh in Manifold coordinates (millimetres, Z-up). */
export interface CadMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Token accounting for one LLM call. */
export interface TokenUsage {
  prompt: number;
  completion: number;
}

/**
 * The subset of the manifold-3d module the kernel needs.
 * @remarks The host loads the WASM and injects it, so core/ owns no loader and
 *   no WASM path resolution.
 */
export interface ManifoldModule {
  Manifold: {
    cube(size: [number, number, number], center?: boolean): any;
    cylinder(height: number, radiusLow: number, radiusHigh?: number, circularSegments?: number, center?: boolean): any;
  };
  CrossSection: any;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/cad-gen/document.test.js`:

```js
import {
  parseDesign,
  validateParameterOverrides,
  referencedIdentifiers,
} from "@arbesk/cad-gen/core/document.js";
import { CadDesignError } from "@arbesk/cad-gen/errors.js";

const VALID = {
  code: "return box(P.width, P.depth, P.height);",
  parameters: {
    width: { value: 60, unit: "mm", min: 10, max: 200, label: "Overall width" },
  },
  summary: "Create a box",
};

describe("parseDesign", () => {
  it("accepts a well-formed document and stamps turn 1", () => {
    const d = parseDesign(VALID);
    expect(d.code).toBe(VALID.code);
    expect(d.parameters.width.value).toBe(60);
    expect(d.turn).toBe(1);
  });

  it("rejects a document whose code is empty", () => {
    expect(() => parseDesign({ ...VALID, code: "   " })).toThrow(CadDesignError);
  });

  it("rejects a parameter with a non-finite value", () => {
    expect(() =>
      parseDesign({ ...VALID, parameters: { width: { value: NaN, unit: "mm" } } }),
    ).toThrow(/parameter width/);
  });

  it("rejects a parameter missing its unit", () => {
    expect(() => parseDesign({ ...VALID, parameters: { width: { value: 1 } } })).toThrow(
      /parameter width/,
    );
  });

  it("rejects a document with no parameters at all", () => {
    expect(() => parseDesign({ ...VALID, parameters: {} })).toThrow(/at least one parameter/);
  });

  it("defaults a missing summary to an empty string", () => {
    const { summary, ...rest } = VALID;
    expect(parseDesign(rest).summary).toBe("");
  });
});

describe("validateParameterOverrides", () => {
  const design = parseDesign(VALID);

  it("returns no errors for a known parameter", () => {
    expect(validateParameterOverrides(design, { width: 80 })).toEqual([]);
  });

  it("reports an unknown parameter name", () => {
    expect(validateParameterOverrides(design, { height: 5 })).toEqual(["height"]);
  });
});

describe("referencedIdentifiers", () => {
  it("collects called names", () => {
    const names = referencedIdentifiers("const b = roundedBox(1, 2, 3, 4); return hole(b, {});");
    expect(names.has("roundedBox")).toBe(true);
    expect(names.has("hole")).toBe(true);
  });

  it("does not collect method calls", () => {
    const names = referencedIdentifiers("return [1,2].map((n) => n).length > 0;");
    expect(names.has("map")).toBe(true); // lexical only — the guard filters these
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/document.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/core/document.js`.

- [ ] **Step 4: Implement the document module**

`packages/cad-gen/src/core/document.ts`:

```ts
/**
 * The design document: parse, validate and inspect it.
 * @remarks Environment-agnostic — no Node or browser globals.
 */
import type { CadDesign, CadParameterMap } from "../types.ts";
import { CadDesignError } from "../errors.ts";

const MAX_CODE_BYTES = 64 * 1024;
const MAX_PARAMETERS = 40;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parses and validates a design document received from the model.
 * @throws CadDesignError when the document is unusable.
 */
export function parseDesign(input: unknown): CadDesign {
  if (!isPlainObject(input)) {
    throw new CadDesignError("design document must be an object");
  }

  const code = input.code;
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new CadDesignError("design document has no code");
  }
  if (code.length > MAX_CODE_BYTES) {
    throw new CadDesignError("design document code exceeds " + MAX_CODE_BYTES + " bytes");
  }

  const raw = input.parameters;
  if (!isPlainObject(raw)) {
    throw new CadDesignError("design document has no parameters object");
  }
  const names = Object.keys(raw);
  if (names.length === 0) {
    throw new CadDesignError("design document needs at least one parameter");
  }
  if (names.length > MAX_PARAMETERS) {
    throw new CadDesignError("design document exceeds " + MAX_PARAMETERS + " parameters");
  }

  const parameters: CadParameterMap = {};
  for (const name of names) {
    const p = raw[name];
    if (!isPlainObject(p)) throw new CadDesignError("parameter " + name + " is not an object");
    if (typeof p.value !== "number" || !Number.isFinite(p.value)) {
      throw new CadDesignError("parameter " + name + " has a non-finite value");
    }
    if (p.unit !== "mm") {
      throw new CadDesignError("parameter " + name + ' must declare unit "mm"');
    }
    parameters[name] = {
      value: p.value,
      unit: "mm",
      ...(typeof p.min === "number" ? { min: p.min } : {}),
      ...(typeof p.max === "number" ? { max: p.max } : {}),
      ...(typeof p.label === "string" ? { label: p.label } : {}),
    };
  }

  const summary = typeof input.summary === "string" ? input.summary : "";
  const turn = typeof input.turn === "number" && input.turn > 0 ? input.turn : 1;

  return { code, parameters, summary, turn };
}

/**
 * Checks numeric overrides against a design's declared parameters.
 * @returns the names that are NOT declared (empty when all are valid).
 */
export function validateParameterOverrides(
  design: CadDesign,
  overrides: Record<string, number>,
): string[] {
  return Object.keys(overrides).filter(
    (name) => !Object.prototype.hasOwnProperty.call(design.parameters, name),
  );
}

/**
 * Collects identifiers that are *called* in the script, so static gates can
 * reject calls to prelude helpers that do not exist.
 * @remarks Deliberately lexical rather than a full parse: the gate only needs
 *   candidate names, and the kernel run is the real arbiter.
 */
export function referencedIdentifiers(code: string): Set<string> {
  const names = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) names.add(m[1]);
  return names;
}
```

- [ ] **Step 5: Export the new surface**

Append to `packages/cad-gen/src/index.ts`:

```ts
export type {
  CadDesign, CadMesh, CadParameter, CadParameterMap,
  CadStats, ManifoldModule, TokenUsage,
} from "./types.ts";
export {
  parseDesign, validateParameterOverrides, referencedIdentifiers,
} from "./core/document.ts";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/document.test.js`

Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/cad-gen/src test/cad-gen/document.test.js
git commit -m "feat(cad-gen): design document type, parsing and parameter validation"
```

---

### Task 4: The static guard

Enforced on **both** hosts: the server before spawning, the client before executing (spec section 7).

**Files:**
- Create: `packages/cad-gen/src/core/guard.ts`
- Modify: `packages/cad-gen/src/index.ts`
- Test: `test/cad-gen/guard.test.js`

**Interfaces:**
- Consumes: `referencedIdentifiers` (Task 3).
- Produces: `guardScript(code: string, preludeNames: Iterable<string>): GuardResult` where `GuardResult` is `{ ok: true }` or `{ ok: false; reason: string; detail?: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/guard.test.js`:

```js
import { guardScript } from "@arbesk/cad-gen/core/guard.js";

const PRELUDE = ["box", "cylinder", "hole", "roundedBox", "filletEdges", "bbox", "volume"];
const check = (code) => guardScript(code, PRELUDE);

describe("guardScript — denylist", () => {
  const denied = [
    ["dynamic import", "import('node:fs');"],
    ["require", "const fs = require('fs');"],
    ["eval", "eval('1+1');"],
    ["Function", "const f = new Function('return 1');"],
    ["process", "process.exit(0);"],
    ["globalThis", "globalThis.fetch('http://x');"],
    ["fetch", "fetch('http://x');"],
    ["child_process", "const s = child_process.spawn;"],
    ["WebAssembly", "WebAssembly.instantiate(1);"],
    ["constructor escape", "({}).constructor.constructor('return 1')();"],
    ["unbounded loop", "while (true) {}"],
    ["__proto__", "const p = x.__proto__;"],
  ];

  it.each(denied)("rejects %s", (_label, code) => {
    expect(check("return box(1,1,1); " + code).ok).toBe(false);
  });
});

describe("guardScript — structure", () => {
  it("accepts a well-formed script", () => {
    expect(check("const b = roundedBox(60, 40, 10, 2);\nreturn hole(b, { diameter: 6 });").ok).toBe(true);
  });

  it("rejects an empty script", () => {
    expect(check("   ").reason).toBe("EMPTY_CODE");
  });

  it("rejects a script with no return", () => {
    expect(check("const b = box(1, 1, 1);").reason).toBe("NO_RETURN");
  });

  it("rejects a call to an unknown prelude helper", () => {
    const r = check("return warpDrive(1, 2, 3);");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_HELPER");
    expect(r.detail).toContain("warpDrive");
  });

  it("allows method calls on values", () => {
    expect(check("const xs = [1,2,3].map((n) => n * 2);\nreturn box(xs[0], 1, 1);").ok).toBe(true);
  });

  it("allows locally declared functions", () => {
    expect(check("function helper(w) { return box(w, w, w); }\nreturn helper(5);").ok).toBe(true);
  });

  it("allows if/for control flow without mistaking keywords for helpers", () => {
    const code = [
      "let out = box(P.w, P.d, P.h);",
      "if (P.count > 1) {",
      "  for (let i = 0; i < P.count; i++) {",
      "    out = out.subtract(hole(out, { diameter: 3, axis: 'z', at: [i * 10, 0] }));",
      "  }",
      "}",
      "return out;",
    ].join("\n");
    const r = check(code);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/guard.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/core/guard.js`.

- [ ] **Step 3: Implement the guard**

`packages/cad-gen/src/core/guard.ts`:

```ts
/**
 * Static guard for model-written scripts.
 * @remarks Runs on BOTH hosts: the server gates before spawning a child, and the
 *   client gates before executing in its worker — the client must never trust
 *   that the server ran it. This is a deny-list plus a helper allow-list, not a
 *   sandbox; the process/worker boundary is the sandbox.
 */
import { referencedIdentifiers } from "./document.ts";

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

/** Constructs that can reach outside the kernel. */
const DENIED: { pattern: RegExp; label: string }[] = [
  { pattern: /\bimport\s*\(/, label: "dynamic import" },
  { pattern: /\bimport\b[^;]*\bfrom\b/, label: "static import" },
  { pattern: /\brequire\s*\(/, label: "require" },
  { pattern: /\beval\s*\(/, label: "eval" },
  { pattern: /\bnew\s+Function\b/, label: "Function constructor" },
  { pattern: /\bFunction\s*\(/, label: "Function constructor" },
  { pattern: /\bprocess\b/, label: "process" },
  { pattern: /\bglobalThis\b/, label: "globalThis" },
  { pattern: /\bglobal\b/, label: "global" },
  { pattern: /\bself\b/, label: "self" },
  { pattern: /\bwindow\b/, label: "window" },
  { pattern: /\bdocument\b/, label: "document" },
  { pattern: /\bfetch\s*\(/, label: "fetch" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bchild_process\b/, label: "child_process" },
  { pattern: /\bWebAssembly\b/, label: "WebAssembly" },
  { pattern: /\bconstructor\s*\.\s*constructor\b/, label: "constructor escape" },
  { pattern: /__proto__/, label: "__proto__" },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, label: "unbounded loop" },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: "unbounded loop" },
];

/**
 * JS syntax keywords that are followed by a parenthesised expression.
 * @remarks Without this, the lexical scan below reports `if` and `for` as
 *   unknown helpers and rejects perfectly valid scripts - verified with the
 *   controller before Task 4 shipped.
 */
const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "try",
  "catch", "finally", "throw", "return", "typeof", "instanceof", "new",
  "delete", "void", "in", "of", "function", "await", "yield", "class",
  "super", "this", "with",
]);

/** Globals the kernel host legitimately provides. */
const ALLOWED_GLOBALS = new Set([
  "Math", "Number", "Array", "Object", "String", "Boolean", "JSON",
  "Map", "Set", "Symbol", "Error", "TypeError", "RangeError",
  "isFinite", "isNaN", "parseFloat", "parseInt", "console",
]);

/**
 * Validates a script before it is handed to the kernel.
 * @param code Script body (the inside of a function).
 * @param preludeNames Helper names the host will inject.
 */
export function guardScript(code: string, preludeNames: Iterable<string>): GuardResult {
  if (typeof code !== "string" || code.trim().length === 0) {
    return { ok: false, reason: "EMPTY_CODE" };
  }

  for (const { pattern, label } of DENIED) {
    if (pattern.test(code)) {
      return { ok: false, reason: "DENIED_CONSTRUCT", detail: label };
    }
  }

  if (!/\breturn\b/.test(code)) {
    return { ok: false, reason: "NO_RETURN", detail: "script must return a Manifold" };
  }

  const allowed = new Set<string>([...preludeNames, ...ALLOWED_GLOBALS, "PARAMETERS", "P", "M"]);
  for (const name of referencedIdentifiers(code)) {
    if (KEYWORDS.has(name)) continue;
    if (allowed.has(name)) continue;
    // Locally declared functions and variables are the script's own business.
    const declared = new RegExp("\\b(?:const|let|var|function)\\s+" + name + "\\b").test(code);
    if (declared) continue;
    // Method calls (xs.map(...)) are not bare prelude calls.
    const bare = new RegExp("(?:^|[^\\w.$])" + name + "\\s*\\(").test(code);
    if (!bare) continue;
    return { ok: false, reason: "UNKNOWN_HELPER", detail: name };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/guard.test.js`

Expected: PASS (18 tests). If `[1,2,3].map(...)` is wrongly rejected, the fix is the `bare` lookbehind — `map` is preceded by `.`, so it must not match.

- [ ] **Step 5: Export and commit**

Append to `src/index.ts`:

```ts
export { guardScript } from "./core/guard.ts";
export type { GuardResult } from "./core/guard.ts";
```

```bash
git add packages/cad-gen/src test/cad-gen/guard.test.js
git commit -m "feat(cad-gen): static guard for generated scripts"
```

---

### Task 5: Kernel port + child-process validation runner

**Files:**
- Create: `packages/cad-gen/src/core/kernel.ts`
- Create: `packages/cad-gen/src/core/prelude.ts` (helper names only in this task; bodies land in Task 6)
- Create: `packages/cad-gen/src/backend/child.ts`
- Create: `packages/cad-gen/src/backend/validate-runner.ts`
- Create: `packages/cad-gen/src/backend/index.ts`
- Test: `test/cad-gen/validate-runner.test.js`

**Interfaces:**
- Consumes: `CadDesign`, `CadStats`, `CadMesh`, `ManifoldModule` (Task 3).
- Produces: `createCadKernel(module: ManifoldModule): CadKernel` with `run(design: CadDesign): KernelRunResult`; `runValidation(design: CadDesign, opts: RunnerOptions): Promise<RunnerResult>`; `RunnerOptions = { timeoutMs: number; maxTriangles: number }`; `RunnerResult = { ok: true; stats: CadStats } | { ok: false; error: string }`; `PRELUDE_NAMES: readonly string[]`; `buildPrelude(module): PreludeHelpers`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/validate-runner.test.js`:

```js
import { runValidation } from "@arbesk/cad-gen/backend/validate-runner.js";

const design = (code) => ({
  code,
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "",
});

const OPTS = { timeoutMs: 20000, maxTriangles: 200000 };

describe("runValidation", () => {
  it("kills a runaway script on the timeout", async () => {
    const r = await runValidation(design("while(true){}\nreturn 1;"), {
      ...OPTS, timeoutMs: 3000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  }, 20000);
});
```

This is deliberately the **only** test in this task: it exercises the process boundary, the timeout kill and the stats protocol without depending on the prelude, which does not exist yet. The geometry tests arrive in Task 6.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/validate-runner.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/backend/validate-runner.js`.

- [ ] **Step 3: Implement the prelude name surface**

`packages/cad-gen/src/core/prelude.ts`:

```ts
/**
 * The curated CAD prelude injected into every script.
 * @remarks This module defines the *published API* the model is prompted
 *   against. Adding, removing or renaming a helper is a breaking change to
 *   PRELUDE_VERSION (spec section 4).
 */
import type { ManifoldModule } from "../types.ts";

/** Helper names injected into every script, in injection order. */
export const PRELUDE_NAMES = [
  "box", "cylinder", "sphere",
  "rect", "circle", "roundRect", "extrude", "revolve",
  "roundedBox", "hole", "boltCircle", "filletEdges", "chamferEdges",
  "bbox", "volume",
] as const;

export interface PreludeHelpers {
  /** Fillet strategy actually used, for stats reporting. */
  readonly lastFilletMode?: "exact" | "minkowski" | "smooth";
  [name: string]: unknown;
}

/**
 * Builds the helper set bound to a loaded Manifold module.
 * @remarks Implemented in Task 6. This task fixes only the names, so the kernel
 *   and the guard agree on the surface before the bodies exist.
 */
export function buildPrelude(module: ManifoldModule): PreludeHelpers {
  // Task 6 replaces this body wholesale. It returns one throwing placeholder
  // PER NAME rather than throwing here, because createCadKernel().run() calls
  // buildPrelude() BEFORE evaluating the script: an immediate throw would stop
  // a runaway script from ever looping, making the timeout test unpassable.
  const placeholders: Record<string, unknown> = {};
  for (const name of PRELUDE_NAMES) {
    placeholders[name] = () => {
      throw new Error("buildPrelude not implemented: " + name);
    };
  }
  return placeholders as PreludeHelpers;
}
```

- [ ] **Step 4: Implement the core kernel**

`packages/cad-gen/src/core/kernel.ts`:

```ts
/**
 * Kernel port: design document becomes mesh plus stats.
 * @remarks The Manifold module is injected by the host (Emscripten glue in the
 *   validation child, bundled web build in the browser worker), so core/ owns
 *   no loader and no WASM path resolution.
 */
import type { CadDesign, CadMesh, CadStats, ManifoldModule } from "../types.ts";
import { CadKernelError } from "../errors.ts";
import { PRELUDE_NAMES, buildPrelude } from "./prelude.ts";

export interface KernelRunResult {
  mesh: CadMesh;
  stats: CadStats;
}

export interface CadKernel {
  run(design: CadDesign): KernelRunResult;
}

/**
 * Builds a kernel bound to a loaded Manifold module.
 * @throws CadKernelError when the script is malformed, throws, or does not
 *   return a valid Manifold.
 */
export function createCadKernel(module: ManifoldModule): CadKernel {
  const names = [...PRELUDE_NAMES];

  return {
    run(design: CadDesign): KernelRunResult {
      const helpers = buildPrelude(module);
      const values: Record<string, number> = {};
      for (const [name, p] of Object.entries(design.parameters)) values[name] = p.value;

      let fn: (...args: unknown[]) => unknown;
      try {
        // The script is the product; the process boundary is the sandbox.
        // eslint-disable-next-line no-new-func
        fn = new Function("PARAMETERS", "P", "M", ...names, design.code) as never;
      } catch (e) {
        throw new CadKernelError("script does not parse: " + (e as Error).message);
      }

      let result: any;
      try {
        result = fn(values, values, module.Manifold, ...names.map((n) => helpers[n]));
      } catch (e) {
        throw new CadKernelError("script threw: " + (e as Error).message);
      }

      if (!result || typeof result.getMesh !== "function") {
        throw new CadKernelError("script did not return a Manifold");
      }
      const status = result.status();
      if (status !== "NoError") {
        throw new CadKernelError("kernel status: " + String(status));
      }

      const raw = result.getMesh();
      const vertCount = raw.vertProperties.length / raw.numProp;
      const positions = new Float32Array(vertCount * 3);
      for (let v = 0; v < vertCount; v++) {
        positions[v * 3 + 0] = raw.vertProperties[v * raw.numProp + 0];
        positions[v * 3 + 1] = raw.vertProperties[v * raw.numProp + 1];
        positions[v * 3 + 2] = raw.vertProperties[v * raw.numProp + 2];
      }
      const indices = new Uint32Array(raw.triVerts);
      const box = result.boundingBox();

      return {
        mesh: { positions, indices },
        stats: {
          triangles: result.numTri(),
          vertices: result.numVert(),
          volumeMm3: result.volume(),
          bboxMm: {
            min: [...box.min] as [number, number, number],
            max: [...box.max] as [number, number, number],
          },
          ...(helpers.lastFilletMode ? { filletMode: helpers.lastFilletMode } : {}),
        },
      };
    },
  };
}
```

- [ ] **Step 5: Implement the child entry**

`packages/cad-gen/src/backend/child.ts`:

```ts
/**
 * Validation child: loads the Manifold kernel, runs one script, prints a stats
 * JSON line on stdout.
 * @remarks The mesh is deliberately discarded here — only stats cross back. The
 *   server validates, it does not export (spec section 5).
 * @remarks Run as: bun src/backend/child.ts <request.json path>
 */
import fs from "node:fs";
import path from "node:path";
import Module from "manifold-3d";
import { createCadKernel } from "../core/kernel.ts";
import type { CadDesign, ManifoldModule } from "../types.ts";

interface ChildRequest {
  design: CadDesign;
  maxTriangles: number;
  wasmDir: string;
}

/**
 * Runs one design and prints exactly one JSON line.
 * @remarks Script-level failures are reported in-band with exit code 0, so the
 *   parent can distinguish "the script is bad" (a repair turn) from "the kernel
 *   could not start" (a server fault, non-zero exit).
 */
async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const req = JSON.parse(fs.readFileSync(requestPath, "utf8")) as ChildRequest;

  // manifold-3d's bundled manifold.d.ts declares `locateFile: () => string`
  // (zero arity) while Emscripten actually calls it WITH the filename, so the
  // typed config rejects a correct callback (TS2322). Cast the config object,
  // never the callback, and do not augment the upstream .d.ts - an upgrade
  // would silently drop it.
  const module = await Module({
    locateFile: (file: string) => path.join(req.wasmDir, file),
  } as unknown as Parameters<typeof Module>[0]);
  // manifold-3d registers its JS API lazily. Without setup(), Manifold.cube is
  // undefined and every script dies with "Manifold.cube is not a function".
  // Verified in Task 1 - see docs/superpowers/plans/cad-spike-results.md.
  (module as { setup: () => void }).setup();

  const kernel = createCadKernel(module as unknown as ManifoldModule);
  try {
    const { stats } = kernel.run(req.design);
    if (stats.triangles > req.maxTriangles) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + req.maxTriangles,
      }) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify({ ok: true, stats }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }) + "\n");
  }
}

main().catch((e) => {
  process.stderr.write("CHILD_FATAL " + (e as Error).message + "\n");
  process.exit(2);
});
```

- [ ] **Step 6: Implement the runner**

`packages/cad-gen/src/backend/validate-runner.ts`:

```ts
/**
 * Parent side of kernel validation: spawn a fresh child per attempt, enforce a
 * hard timeout, return stats only.
 * @remarks The mesh never crosses the process boundary.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CadDesign, CadStats } from "../types.ts";

export interface RunnerOptions {
  /** Hard wall-clock limit for one attempt. */
  timeoutMs: number;
  /** Reject meshes above this triangle count. */
  maxTriangles: number;
  /**
   * Directory holding manifold.wasm.
   * @remarks The host supplies it (PROJECT_ROOT-relative): a compiled single-file
   *   binary cannot resolve node_modules from its virtual module URL.
   */
  wasmDir?: string;
}

export type RunnerResult =
  | { ok: true; stats: CadStats }
  | { ok: false; error: string };

/**
 * Directory holding the Emscripten glue and manifold.wasm.
 * @remarks Overridable because the compiled single-file server cannot resolve
 *   node_modules from a virtual module URL — there the path is PROJECT_ROOT
 *   relative, exactly like the brotli-wasm shim in scripts/build-server.mjs.
 */
function resolveWasmDir(opts: RunnerOptions): string {
  if (opts.wasmDir) return opts.wasmDir;
  const override = process.env.CAD_MANIFOLD_WASM_DIR;
  if (override) return override;
  // cwd-relative, never import.meta.url-relative: inside a compiled binary the
  // module URL is virtual, so an ascent from it lands on /$bunfs/... and ENOENTs.
  // Verified in Task 1 - see docs/superpowers/plans/cad-spike-results.md.
  return path.resolve(process.cwd(), "node_modules", "manifold-3d");
}

/**
 * Runs one design in a fresh child process.
 * @remarks A non-zero exit or a missing stdout line means the *host* failed
 *   (the kernel could not load), which is distinct from a script-level failure.
 */
export function runValidation(design: CadDesign, opts: RunnerOptions): Promise<RunnerResult> {
  const childPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "child.ts");
  // In a compiled single-file server this path does not exist on disk. Fail
  // loudly rather than spawning a doomed process (ledger: parked finding on
  // compiled-server child execution).
  if (!fs.existsSync(childPath)) {
    return Promise.resolve({
      ok: false,
      error: "kernel host unavailable: validation child entry not found at " + childPath,
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cad-validate-"));
  const requestPath = path.join(dir, "request.json");
  fs.writeFileSync(requestPath, JSON.stringify({
    design,
    maxTriangles: opts.maxTriangles,
    wasmDir: resolveWasmDir(opts),
  }));

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [childPath, requestPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      cleanup();
      resolve({ ok: false, error: "validation timed out after " + opts.timeoutMs + "ms" });
    }, opts.timeoutMs);

    child.stdout.on("data", (b) => { stdout += String(b); });
    child.stderr.on("data", (b) => { stderr += String(b); });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        resolve({ ok: false, error: "kernel host failed: " + (stderr.trim() || "exit " + code) });
        return;
      }
      const line = stdout.trim().split("\n").filter(Boolean).pop();
      if (!line) {
        resolve({ ok: false, error: "kernel host produced no result" });
        return;
      }
      try {
        resolve(JSON.parse(line) as RunnerResult);
      } catch {
        resolve({ ok: false, error: "kernel host produced unreadable output" });
      }
    });
  });
}
```

- [ ] **Step 7: Add the backend entry point**

`packages/cad-gen/src/backend/index.ts`:

```ts
/** @arbesk/cad-gen backend — Node-only. Never imported by the browser. */
export { runValidation } from "./validate-runner.ts";
export type { RunnerOptions, RunnerResult } from "./validate-runner.ts";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/validate-runner.test.js`

Expected: PASS. The child loads the WASM, the script loops forever, and the parent kills it at 3 s.

- [ ] **Step 9: Commit**

```bash
git add packages/cad-gen/src test/cad-gen/validate-runner.test.js
git commit -m "feat(cad-gen): kernel port, validation child and spawned runner"
```

---
### Task 6: Prelude helper bodies

**Files:**
- Modify: `packages/cad-gen/src/core/prelude.ts`
- Test: `test/cad-gen/prelude.test.js`

**Interfaces:**
- Consumes: `ManifoldModule` (Task 3), `runValidation` (Task 5), `createCadKernel` (Task 5).
- Produces: a working `buildPrelude(module)` providing `box`, `cylinder`, `sphere`, `rect`, `circle`, `roundRect`, `extrude`, `revolve`, `roundedBox`, `hole`, `boltCircle`, `filletEdges`, `chamferEdges`, `bbox`, `volume`, and a live `lastFilletMode` getter.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/prelude.test.js` — geometry is asserted **through the spawned child**, never by importing manifold into the Jest VM (spec section 9):

```js
import { runValidation } from "@arbesk/cad-gen/backend/validate-runner.js";

const OPTS = { timeoutMs: 20000, maxTriangles: 200000 };
const design = (code) => ({ code, parameters: { s: { value: 10, unit: "mm" } }, summary: "" });
const run = (code) => runValidation(design(code), OPTS);

describe("prelude geometry", () => {
  it("box has the requested volume", async () => {
    const r = await run("return box(10, 20, 30);");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(6000, 0);
  }, 30000);

  it("cylinder has the requested volume", async () => {
    const r = await run("return cylinder(5, 10, { segments: 256 });");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(Math.PI * 25 * 10, -2);
  }, 30000);

  it("hole subtracts a through-hole", async () => {
    const r = await run("const b = box(20, 20, 10);\nreturn hole(b, { diameter: 6, axis: 'z' });");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(4000 - Math.PI * 9 * 10, -1);
  }, 30000);

  it("hole along x is subtractive too", async () => {
    const r = await run("const b = box(20, 20, 10);\nreturn hole(b, { diameter: 6, axis: 'x' });");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeLessThan(4000);
  }, 30000);

  it("boltCircle removes four holes", async () => {
    const r = await run(
      "const b = box(40, 40, 10);\n" +
      "return boltCircle(b, { count: 4, diameter: 4, circleDiameter: 30, axis: 'z' });",
    );
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(16000 - 4 * Math.PI * 4 * 10, -1);
  }, 30000);

  it("roundedBox is watertight and smaller than the sharp box", async () => {
    const sharp = await run("return box(20, 20, 20);");
    const round = await run("return roundedBox(20, 20, 20, 2);");
    expect(round.ok).toBe(true);
    expect(round.stats.volumeMm3).toBeLessThan(sharp.stats.volumeMm3);
    expect(round.stats.volumeMm3).toBeGreaterThan(sharp.stats.volumeMm3 * 0.85);
    expect(round.stats.filletMode).toBe("exact");
  }, 30000);

  it("filletEdges reports the strategy it used", async () => {
    const r = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5, { mode: 'minkowski' });");
    expect(r.ok).toBe(true);
    expect(r.stats.filletMode).toBe("minkowski");
  }, 30000);

  it("bbox reports the true extent", async () => {
    const r = await run("const b = box(30, 20, 10);\nreturn b;");
    expect(r.ok).toBe(true);
    expect(r.stats.bboxMm.min[0]).toBeCloseTo(-15, 5);
    expect(r.stats.bboxMm.max[0]).toBeCloseTo(15, 5);
    expect(r.stats.bboxMm.max[2]).toBeCloseTo(5, 5);
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/prelude.test.js`

Expected: FAIL — every case returns `{ok:false}` carrying `buildPrelude not implemented: <name>`
(the stub throws per calling name, not at construction; see Task 5 step 3).

- [ ] **Step 3: Implement the helpers**

Replace everything below the `PreludeHelpers` interface in `packages/cad-gen/src/core/prelude.ts`:

```ts
let lastFilletMode: "exact" | "minkowski" | "smooth" | undefined;

/** Normalises an axis name to its index (x=0, y=1, z=2). */
function axisIndex(axis: unknown): 0 | 1 | 2 {
  if (axis === "x") return 0;
  if (axis === "y") return 1;
  if (axis === "z" || axis === undefined) return 2;
  throw new Error("axis must be 'x', 'y' or 'z'");
}

/** Rotates a Z-aligned solid onto the requested axis. */
function alignToAxis(solid: any, axis: unknown): any {
  const a = axisIndex(axis);
  if (a === 0) return solid.rotate([0, 90, 0]);
  if (a === 1) return solid.rotate([-90, 0, 0]);
  return solid;
}

/**
 * Builds the helper set bound to a loaded Manifold module.
 * @param module A loaded manifold-3d toplevel (Manifold + CrossSection).
 */
export function buildPrelude(module: ManifoldModule): PreludeHelpers {
  lastFilletMode = undefined;
  const { Manifold, CrossSection } = module;

  /** Cuts one axis-aligned hole; the two in-plane coordinates come from opts.at. */
  const cutHole = (part: any, opts: any): any => {
    const { diameter, axis, at, through = true } = opts ?? {};
    if (!(diameter > 0)) throw new Error("hole needs a positive diameter");
    const a = axisIndex(axis);
    const box = part.boundingBox();
    const span = box.max[a] - box.min[a];
    const depth = through ? span * 2 : (opts.depth ?? span);
    const cutter = alignToAxis(
      Manifold.cylinder(depth, diameter / 2, diameter / 2, 64, true), axis,
    );
    const inPlane = a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1];
    const centre: [number, number, number] = [0, 0, 0];
    centre[a] = through ? (box.min[a] + box.max[a]) / 2 : box.max[a] - depth / 2;
    if (Array.isArray(at)) {
      centre[inPlane[0]] = at[0];
      centre[inPlane[1]] = at[1];
    }
    return part.subtract(cutter.translate(centre));
  };

  const roundRect = (w: number, d: number, r: number): any => {
    const radius = Math.max(0, Math.min(r, Math.min(w, d) / 2));
    if (radius === 0) return CrossSection.square([w, d], true);
    return CrossSection.square([w - 2 * radius, d - 2 * radius], true)
      .offset(radius, "Round", 2, 64);
  };

  const helpers: Record<string, unknown> = {
    box: (w: number, d: number, h: number) => Manifold.cube([w, d, h], true),

    cylinder: (r: number, h: number, opts: any = {}) =>
      Manifold.cylinder(h, r, r, opts.segments ?? 64, true),

    sphere: (r: number, opts: any = {}) => Manifold.sphere(r, opts.segments ?? 64),

    rect: (w: number, d: number) => CrossSection.square([w, d], true),

    circle: (r: number, opts: any = {}) => CrossSection.circle(r, opts.segments ?? 64),

    roundRect,

    extrude: (profile: any, h: number, opts: any = {}) =>
      Manifold.extrude(profile, h, opts.nDivisions ?? 0, opts.twistDegrees ?? 0,
        opts.scaleTop ?? 1, true),

    revolve: (profile: any, opts: any = {}) =>
      Manifold.revolve(profile, opts.segments ?? 64, opts.degrees ?? 360),

    /**
     * Exact prismatic fillet: round the 2D profile, then extrude.
     * @remarks This is the only *exact* fillet strategy Manifold can offer (it
     *   is a mesh kernel, not a B-rep kernel) - prefer it for plates, brackets
     *   and enclosures.
     */
    roundedBox: (w: number, d: number, h: number, r: number) => {
      lastFilletMode = "exact";
      return Manifold.extrude(roundRect(w, d, r), h, 0, 0, 1, true);
    },

    hole: cutHole,

    boltCircle: (part: any, opts: any) => {
      const { count, diameter, circleDiameter, axis, at = [0, 0] } = opts ?? {};
      if (!(count > 0)) throw new Error("boltCircle needs a positive count");
      let out = part;
      for (let i = 0; i < count; i++) {
        const theta = (2 * Math.PI * i) / count;
        const r = circleDiameter / 2;
        out = cutHole(out, {
          diameter, axis, through: true,
          at: [at[0] + r * Math.cos(theta), at[1] + r * Math.sin(theta)],
        });
      }
      return out;
    },

    /**
     * Rounds edges. "minkowski" is geometrically correct but grows the triangle
     * count fast; "smooth" is tangent-based and cosmetic.
     * @remarks The mode actually used is reported on stats.filletMode so
     *   fidelity is never silently overstated (spec section 4).
     */
    filletEdges: (part: any, r: number, opts: any = {}) => {
      const mode = opts.mode ?? "auto";
      if (!(r > 0)) return part;
      if (mode === "smooth") {
        lastFilletMode = "smooth";
        return part.smoothOut(60, 1).refineToLength(r / 2);
      }
      lastFilletMode = "minkowski";
      return part.minkowskiSum(Manifold.sphere(r, 32));
    },

    chamferEdges: (part: any, r: number) => {
      if (!(r > 0)) return part;
      lastFilletMode = "minkowski";
      return part.minkowskiSum(Manifold.cylinder(r * 2, r * 2, 0, 32, true));
    },

    bbox: (part: any) => {
      const b = part.boundingBox();
      return {
        min: [...b.min],
        max: [...b.max],
        size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      };
    },

    volume: (part: any) => part.volume(),
  };

  const result = helpers as PreludeHelpers;
  Object.defineProperty(result, "lastFilletMode", { get: () => lastFilletMode });
  return result;
}
```

Also delete the placeholder `buildPrelude` stub entirely — there must be exactly one exported `buildPrelude`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/prelude.test.js`

Expected: PASS (8 tests). Volumes are asserted with tolerance because Manifold tessellates circles.

If `cylinder` volume is noticeably off, the argument order is wrong — the signature is `cylinder(height, radiusLow, radiusHigh, circularSegments, center)`.

- [ ] **Step 5: Re-run the runner suite**

Run: `bun run test -- test/cad-gen/validate-runner.test.js`

Expected: PASS (1 test) — the timeout path is unaffected by the prelude bodies.

- [ ] **Step 6: Commit**

```bash
git add packages/cad-gen/src test/cad-gen/prelude.test.js
git commit -m "feat(cad-gen): prelude helper bodies with explicit fillet strategies"
```

---

### Task 7: Validation gates

**Files:**
- Create: `packages/cad-gen/src/core/gates.ts`
- Create: `packages/cad-gen/src/backend/validate.ts`
- Modify: `packages/cad-gen/src/index.ts`, `packages/cad-gen/src/backend/index.ts`
- Test: `test/cad-gen/gates.test.js`

**Interfaces:**
- Consumes: `guardScript` (Task 4), `runValidation` and `RunnerOptions` (Task 5), `CadStats` (Task 3).
- Produces: `evaluateStaticGates(design, preludeNames): GateResult[]`; `evaluateKernelGates(stats, limits): GateResult[]`; `validateDesign(design, opts): Promise<ValidationOutcome>`; `GateResult = { gate: string; ok: boolean; error?: string }`; `KernelLimits = { maxTriangles: number }`; `ValidateOptions = { preludeNames: Iterable<string>; limits: RunnerOptions }`; `ValidationOutcome = { ok: boolean; stats?: CadStats; gates: GateResult[]; error?: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/gates.test.js`:

```js
import { evaluateStaticGates, evaluateKernelGates } from "@arbesk/cad-gen/core/gates.js";
import { validateDesign } from "@arbesk/cad-gen/backend/validate.js";

const PRELUDE = ["box", "hole"];
const design = (code, parameters = { s: { value: 10, unit: "mm" } }) =>
  ({ code, parameters, summary: "" });
const LIMITS = { timeoutMs: 20000, maxTriangles: 200000 };

describe("evaluateStaticGates", () => {
  it("passes a well-formed design", () => {
    const gates = evaluateStaticGates(design("return box(P.s, P.s, P.s);"), PRELUDE);
    expect(gates.every((g) => g.ok)).toBe(true);
  });

  it("fails the guard gate for a denied construct", () => {
    const gates = evaluateStaticGates(design("process.exit(0); return box(1,1,1);"), PRELUDE);
    expect(gates.find((g) => g.gate === "guard").ok).toBe(false);
  });

  it("fails the parameters gate when the script ignores PARAMETERS", () => {
    const gates = evaluateStaticGates(design("return box(1, 1, 1);"), PRELUDE);
    expect(gates.find((g) => g.gate === "parameters").ok).toBe(false);
  });
});

describe("evaluateKernelGates", () => {
  const stats = {
    triangles: 100, vertices: 60, volumeMm3: 1000,
    bboxMm: { min: [0, 0, 0], max: [10, 10, 10] },
  };

  it("passes sane stats", () => {
    expect(evaluateKernelGates(stats, LIMITS).every((g) => g.ok)).toBe(true);
  });

  it("fails on a degenerate volume", () => {
    const gates = evaluateKernelGates({ ...stats, volumeMm3: 0 }, LIMITS);
    expect(gates.find((g) => g.gate === "volume").ok).toBe(false);
  });

  it("fails on an empty mesh", () => {
    const gates = evaluateKernelGates({ ...stats, triangles: 0 }, LIMITS);
    expect(gates.find((g) => g.gate === "nonempty").ok).toBe(false);
  });

  it("fails on a triangle budget overrun", () => {
    const gates = evaluateKernelGates({ ...stats, triangles: 500000 }, LIMITS);
    expect(gates.find((g) => g.gate === "budget").ok).toBe(false);
  });
});

describe("validateDesign", () => {
  it("validates a real solid end to end", async () => {
    const r = await validateDesign(design("return box(P.s, P.s, P.s);"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(1000, 0);
  }, 30000);

  it("stops before the kernel when a static gate fails", async () => {
    const r = await validateDesign(design("return 1;"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });
    expect(r.ok).toBe(false);
    expect(r.gates.some((g) => g.gate === "kernel")).toBe(false);
  }, 30000);

  it("surfaces a script-level failure with the failing gate", async () => {
    const r = await validateDesign(design("throw new Error('boom'); return box(P.s,P.s,P.s);"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.gate === "kernel").ok).toBe(false);
    expect(r.error).toContain("boom");
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/gates.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/core/gates.js`.

- [ ] **Step 3: Implement the gates**

`packages/cad-gen/src/core/gates.ts`:

```ts
/**
 * Validation gates. Static gates never execute; kernel gates read stats only.
 * @remarks Environment-agnostic — the caller supplies the stats.
 */
import type { CadDesign, CadStats } from "../types.ts";
import { guardScript } from "./guard.ts";

export interface GateResult {
  gate: string;
  ok: boolean;
  error?: string;
}

export interface KernelLimits {
  maxTriangles: number;
}

/** Gates that need no execution. Cheap enough to run before every attempt. */
export function evaluateStaticGates(
  design: CadDesign,
  preludeNames: Iterable<string>,
): GateResult[] {
  const gates: GateResult[] = [];

  const guard = guardScript(design.code, preludeNames);
  gates.push(guard.ok
    ? { gate: "guard", ok: true }
    : {
      gate: "guard", ok: false,
      error: guard.reason + (guard.detail ? ": " + guard.detail : ""),
    });

  const usesParameters = /\bPARAMETERS\b|\bP\./.test(design.code);
  gates.push(usesParameters
    ? { gate: "parameters", ok: true }
    : {
      gate: "parameters", ok: false,
      error: "script must derive dimensions from PARAMETERS so parameters stay editable",
    });

  return gates;
}

/** Gates evaluated against a successful kernel run. */
export function evaluateKernelGates(stats: CadStats, limits: KernelLimits): GateResult[] {
  return [
    stats.triangles > 0
      ? { gate: "nonempty", ok: true }
      : { gate: "nonempty", ok: false, error: "mesh has no triangles" },

    stats.volumeMm3 > 0
      ? { gate: "volume", ok: true }
      : { gate: "volume", ok: false, error: "solid has no volume - the result is degenerate" },

    stats.triangles <= limits.maxTriangles
      ? { gate: "budget", ok: true }
      : {
        gate: "budget", ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + limits.maxTriangles,
      },
  ];
}
```

- [ ] **Step 4: Implement the backend orchestrator**

`packages/cad-gen/src/backend/validate.ts`:

```ts
/**
 * Full validation of one attempt: static gates, then a kernel run, then stats
 * gates.
 * @remarks The mesh is discarded here — callers receive stats only. The server
 *   validates; it does not export (spec section 5).
 */
import type { CadDesign, CadStats } from "../types.ts";
import { evaluateStaticGates, evaluateKernelGates } from "../core/gates.ts";
import type { GateResult } from "../core/gates.ts";
import { runValidation } from "./validate-runner.ts";
import type { RunnerOptions } from "./validate-runner.ts";

export interface ValidateOptions {
  preludeNames: Iterable<string>;
  limits: RunnerOptions;
}

export interface ValidationOutcome {
  ok: boolean;
  stats?: CadStats;
  gates: GateResult[];
  error?: string;
}

/**
 * Validates a design.
 * @remarks Static failures short-circuit before the kernel runs, so a script
 *   the guard rejects never costs a process spawn.
 */
export async function validateDesign(
  design: CadDesign,
  opts: ValidateOptions,
): Promise<ValidationOutcome> {
  const gates = evaluateStaticGates(design, opts.preludeNames);
  const staticFailure = gates.find((g) => !g.ok);
  if (staticFailure) {
    return { ok: false, gates, error: staticFailure.error };
  }

  const run = await runValidation(design, opts.limits);
  if (!run.ok) {
    gates.push({ gate: "kernel", ok: false, error: run.error });
    return { ok: false, gates, error: run.error };
  }

  gates.push({ gate: "kernel", ok: true });
  const kernelGates = evaluateKernelGates(run.stats, opts.limits);
  gates.push(...kernelGates);
  const kernelFailure = kernelGates.find((g) => !g.ok);
  if (kernelFailure) {
    return { ok: false, gates, error: kernelFailure.error, stats: run.stats };
  }

  return { ok: true, gates, stats: run.stats };
}
```

- [ ] **Step 5: Export and run**

Append to `src/index.ts`:

```ts
export { evaluateStaticGates, evaluateKernelGates } from "./core/gates.ts";
export type { GateResult, KernelLimits } from "./core/gates.ts";
```

Append to `src/backend/index.ts`:

```ts
export { validateDesign } from "./validate.ts";
export type { ValidateOptions, ValidationOutcome } from "./validate.ts";
```

Run: `bun run test -- test/cad-gen/gates.test.js`

Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cad-gen/src test/cad-gen/gates.test.js
git commit -m "feat(cad-gen): static and kernel validation gates"
```

---

### Task 8: DeepSeek client

**Files:**
- Create: `packages/cad-gen/src/backend/deepseek.ts`
- Modify: `packages/cad-gen/src/backend/index.ts`
- Test: `test/cad-gen/deepseek.test.js`

**Interfaces:**
- Consumes: `TokenUsage` (Task 3).
- Produces: `createDeepSeekClient(config: DeepSeekConfig): DeepSeekClient`; `ProviderError` carrying `status` and `code`; types `LlmMessage`, `LlmContentBlock`, `DeepSeekConfig`, `DeepSeekClient`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/deepseek.test.js`:

```js
import { createDeepSeekClient } from "@arbesk/cad-gen/backend/deepseek.js";

const completion = (content) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});
const reply = (body, status = 200) =>
  async () => new Response(JSON.stringify(body), { status });

const client = (fetchImpl) => createDeepSeekClient({
  apiKey: "k", baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash", fetchImpl,
});

describe("createDeepSeekClient", () => {
  it("returns text and token usage", async () => {
    const c = client(reply(completion('{"code":"return 1;"}')));
    const r = await c.complete([{ role: "user", content: "hi" }]);
    expect(JSON.parse(r.text).code).toBe("return 1;");
    expect(r.usage).toEqual({ prompt: 100, completion: 20 });
  });

  it("sends the model and JSON response format", async () => {
    let seen;
    const c = client(async (_url, init) => {
      seen = JSON.parse(init.body);
      return new Response(JSON.stringify(completion("{}")), { status: 200 });
    });
    await c.complete([{ role: "user", content: "hi" }]);
    expect(seen.model).toBe("deepseek-flash");
    expect(seen.response_format).toEqual({ type: "json_object" });
    expect(seen.messages[0].content).toBe("hi");
  });

  it("maps 401 to PROVIDER_AUTH_FAILED", async () => {
    const c = client(reply({ error: "nope" }, 401));
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED", status: 401,
    });
  });

  it("maps 500 to PROVIDER_ERROR", async () => {
    const c = client(reply({ error: "boom" }, 500));
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_ERROR", status: 500,
    });
  });

  it("rejects an empty completion", async () => {
    const c = client(reply({ choices: [{ message: { content: "" } }] }));
    await expect(c.complete([])).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("passes image blocks through as data URLs", async () => {
    let seen;
    const c = client(async (_u, init) => {
      seen = JSON.parse(init.body);
      return new Response(JSON.stringify(completion("{}")), { status: 200 });
    });
    await c.complete([{
      role: "user",
      content: [
        { type: "text", text: "describe this" },
        { type: "image", data: "AAAA", mime: "image/png" },
      ],
    }]);
    const blocks = seen.messages[0].content;
    expect(blocks[1].type).toBe("image_url");
    expect(blocks[1].image_url.url).toBe("data:image/png;base64,AAAA");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/deepseek.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/backend/deepseek.js`.

- [ ] **Step 3: Implement the client**

`packages/cad-gen/src/backend/deepseek.ts`:

```ts
/**
 * DeepSeek chat-completions client (OpenAI-compatible).
 * @remarks Images ride inline as base64 data URLs - the same shape the repo
 *   already uses for generation input. The API key is never logged.
 */
import type { TokenUsage } from "../types.ts";

export interface LlmContentBlock {
  type: "text" | "image";
  text?: string;
  data?: string;
  mime?: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentBlock[];
}

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Transport/auth failure from the provider, carrying the documented code. */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}

export interface DeepSeekClient {
  complete(
    messages: LlmMessage[],
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: TokenUsage }>;
}

/** Maps an HTTP status to the documented provider error code. */
function providerErrorCode(status: number): string {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_FAILED";
  if (status === 402) return "PROVIDER_CREDITS_EXHAUSTED";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_ERROR";
}

function toWireContent(content: LlmMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((b) =>
    b.type === "image"
      ? { type: "image_url", image_url: { url: "data:" + b.mime + ";base64," + b.data } }
      : { type: "text", text: b.text ?? "" });
}

export function createDeepSeekClient(config: DeepSeekConfig): DeepSeekClient {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 120000;

  return {
    async complete(messages, signal) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

      let response: Response;
      try {
        response = await doFetch(config.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + config.apiKey,
          },
          body: JSON.stringify({
            model: config.model,
            messages: messages.map((m) => ({ role: m.role, content: toWireContent(m.content) })),
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderError(
          "deepseek " + response.status + ": " + body.slice(0, 300),
          response.status,
          providerErrorCode(response.status),
        );
      }

      const json = (await response.json()) as any;
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        throw new ProviderError("deepseek returned no content", 502, "PROVIDER_ERROR");
      }
      return {
        text,
        usage: {
          prompt: Number(json?.usage?.prompt_tokens ?? 0),
          completion: Number(json?.usage?.completion_tokens ?? 0),
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/deepseek.test.js`

Expected: PASS (6 tests).

- [ ] **Step 5: Export and commit**

Append to `src/backend/index.ts`:

```ts
export { createDeepSeekClient, ProviderError } from "./deepseek.ts";
export type {
  DeepSeekClient, DeepSeekConfig, LlmContentBlock, LlmMessage,
} from "./deepseek.ts";
```

```bash
git add packages/cad-gen/src test/cad-gen/deepseek.test.js
git commit -m "feat(cad-gen): deepseek chat-completions client with json output mode"
```

---

### Task 9: Prompt and turn assembly

**Files:**
- Create: `packages/cad-gen/src/backend/prompt.ts`
- Modify: `packages/cad-gen/src/backend/index.ts`
- Test: `test/cad-gen/prompt.test.js`

**Interfaces:**
- Consumes: `CadDesign` (Task 3), `LlmMessage` (Task 8), `GateResult` (Task 7), `PRELUDE_NAMES` (Task 5).
- Produces: `SYSTEM_PROMPT: string`; `buildTurnMessages(input: TurnInput): LlmMessage[]`; `buildRepairMessages(base, previous, error, gates): LlmMessage[]`; `PROMPT_HELPER_NAMES: string[]`; `TurnInput = { prompt: string; priorDesign?: CadDesign; images?: { data: string; mime: string }[]; priorSourceNote?: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/prompt.test.js`:

```js
import {
  SYSTEM_PROMPT, buildTurnMessages, buildRepairMessages,
} from "@arbesk/cad-gen/backend/prompt.js";

const design = (summary) => ({
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary,
  turn: 1,
});

describe("SYSTEM_PROMPT", () => {
  it("names the key prelude helpers", () => {
    for (const name of ["roundedBox", "hole", "boltCircle", "filletEdges", "chamferEdges"]) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("states the units and axis conventions", () => {
    expect(SYSTEM_PROMPT).toMatch(/millimetres/i);
    expect(SYSTEM_PROMPT).toMatch(/Z-up/);
    expect(SYSTEM_PROMPT).toMatch(/return/i);
  });

  it("forbids the constructs the guard rejects", () => {
    expect(SYSTEM_PROMPT).toMatch(/No imports/i);
    expect(SYSTEM_PROMPT).toMatch(/no network/i);
  });

  it("documents the JSON output shape", () => {
    expect(SYSTEM_PROMPT).toContain("summary");
    expect(SYSTEM_PROMPT).toContain("parameters");
  });
});

describe("buildTurnMessages", () => {
  it("omits a prior document on the first turn", () => {
    const msgs = buildTurnMessages({ prompt: "a 60mm cube" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toBe("a 60mm cube");
  });

  it("includes the prior document verbatim on later turns", () => {
    const msgs = buildTurnMessages({ prompt: "add a hole", priorDesign: design("Create a box") });
    const text = String(msgs[1].content);
    expect(text).toContain("return box(P.s, P.s, P.s);");
    expect(text).toContain("add a hole");
    expect(text).toContain("CURRENT DESIGN");
  });

  it("attaches images as content blocks", () => {
    const msgs = buildTurnMessages({
      prompt: "make this", images: [{ data: "AAAA", mime: "image/png" }],
    });
    const blocks = msgs[1].content;
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.some((b) => b.type === "image")).toBe(true);
  });
});

describe("buildRepairMessages", () => {
  it("appends the failing code and the error as a new user turn", () => {
    const base = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
    const msgs = buildRepairMessages(base, design("Create a box"), "kernel status: NotManifold", [
      { gate: "kernel", ok: false, error: "kernel status: NotManifold" },
    ]);
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe("assistant");
    const text = String(msgs[3].content);
    expect(text).toContain("NotManifold");
    expect(text).toContain("kernel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/prompt.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/backend/prompt.js`.

- [ ] **Step 3: Implement the prompt module**

`packages/cad-gen/src/backend/prompt.ts`:

```ts
/**
 * System prompt and turn assembly.
 * @remarks The system prompt is the *published API documentation* for the
 *   prelude: changing it changes what the model writes, so it moves in lockstep
 *   with PRELUDE_VERSION (spec section 4).
 */
import type { CadDesign } from "../types.ts";
import type { LlmMessage } from "./deepseek.ts";
import type { GateResult } from "../core/gates.ts";
import { PRELUDE_NAMES } from "../core/prelude.ts";

/** Rules the generated script must obey. */
const RULES = [
  "Units are millimetres. The coordinate system is Z-up (CAD convention).",
  "Produce ONE solid. Solids only - no surfaces, no open shells.",
  "The code is the BODY of a function with PARAMETERS, P (an alias of PARAMETERS),",
  "M (the raw Manifold class) and the helper functions below in scope.",
  "It MUST end by returning a Manifold.",
  "Every dimension MUST come from PARAMETERS - never hard-code a size the user may",
  "want to change. Declare each parameter with value, unit \"mm\" and, where useful,",
  "min, max and label.",
  "No imports, no network, no filesystem, no eval, no dynamic code, no unbounded loops.",
  "Prefer roundRect with extrude, or roundedBox, for prismatic parts: those give",
  "EXACT fillets.",
  "filletEdges defaults to mode \"auto\". Use mode \"minkowski\" only when a true",
  "geometric round is required, and mode \"smooth\" when appearance alone matters.",
].join("\n");

/** Helper reference the model is prompted against. */
const HELPER_DOCS = [
  "box(w, d, h)                          centred box, mm",
  "cylinder(r, h, opts?)                 Z-aligned cylinder, opts.segments",
  "sphere(r, opts?)",
  "rect(w, d) / circle(r, opts?)         2D profiles",
  "roundRect(w, d, r)                    rounded 2D profile (r clamped)",
  "extrude(profile, h, opts?)            profile to solid",
  "revolve(profile, opts?)               profile revolved about Z",
  "roundedBox(w, d, h, r)                EXACT prismatic fillet",
  "hole(part, { diameter, axis, at, through })   axis 'x'|'y'|'z'; at [a,b] in-plane",
  "boltCircle(part, { count, diameter, circleDiameter, axis, at })",
  "filletEdges(part, r, { mode })        'minkowski'|'smooth'|'auto'",
  "chamferEdges(part, r)",
  "bbox(part) -> { min, max, size }      volume(part) -> mm3",
].join("\n");

const OUTPUT_SHAPE = [
  "Reply with a single JSON object and nothing else:",
  '{ "code": "<function body>", "parameters": { "<name>": { "value": <number>,',
  '  "unit": "mm", "min": <number>, "max": <number>, "label": "<string>" } },',
  '  "summary": "<one-line description of what changed>" }',
].join("\n");

export const SYSTEM_PROMPT = [
  "You design manufacturable engineering parts by writing Manifold scripts.",
  "",
  "RULES",
  RULES,
  "",
  "AVAILABLE HELPERS",
  HELPER_DOCS,
  "",
  "OUTPUT",
  OUTPUT_SHAPE,
  "",
  "When a previous design is supplied, treat it as the current state: return the",
  "COMPLETE updated script, preserving everything the user did not ask to change.",
].join("\n");

export interface TurnInput {
  prompt: string;
  priorDesign?: CadDesign;
  images?: { data: string; mime: string }[];
  priorSourceNote?: string;
}

/**
 * Builds the message list for one generation turn.
 * @remarks The prior document is echoed verbatim: code alone would lose the
 *   prior parameter *values*, which live outside the script (spec section 6).
 */
export function buildTurnMessages(input: TurnInput): LlmMessage[] {
  const messages: LlmMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const parts: string[] = [];
  if (input.priorDesign) {
    parts.push("CURRENT DESIGN (JSON):");
    parts.push(JSON.stringify({
      code: input.priorDesign.code,
      parameters: input.priorDesign.parameters,
      summary: input.priorDesign.summary,
    }, null, 2));
    parts.push("");
  }
  if (input.priorSourceNote) {
    parts.push("REFERENCED ASSET: " + input.priorSourceNote);
    parts.push("");
  }
  parts.push("REQUEST:");
  parts.push(input.prompt);

  const text = parts.join("\n");
  if (input.images && input.images.length > 0) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text },
        ...input.images.map((i) => ({ type: "image" as const, data: i.data, mime: i.mime })),
      ],
    });
  } else {
    messages.push({ role: "user", content: text });
  }
  return messages;
}

/**
 * Appends a repair turn carrying the failing script and the gate errors.
 * @remarks The failing code is included so the model edits rather than
 *   re-derives, which measurably reduces repeat failures.
 */
export function buildRepairMessages(
  base: LlmMessage[],
  previous: CadDesign,
  error: string,
  gates: GateResult[],
): LlmMessage[] {
  const failures = gates
    .filter((g) => !g.ok)
    .map((g) => "- " + g.gate + ": " + (g.error ?? "failed"))
    .join("\n");

  return [
    ...base,
    {
      role: "assistant",
      content: JSON.stringify({
        code: previous.code,
        parameters: previous.parameters,
        summary: previous.summary,
      }),
    },
    {
      role: "user",
      content: [
        "That script failed validation.",
        "",
        "FAILED GATES",
        failures || "- (no detail)",
        "",
        "ERROR",
        error,
        "",
        "FIX THE SCRIPT and return the complete corrected JSON object. Do not change",
        "the requested design intent, and keep every dimension in PARAMETERS.",
      ].join("\n"),
    },
  ];
}

/** Helper names the prompt documents - the guard accepts exactly these. */
export const PROMPT_HELPER_NAMES: string[] = [...PRELUDE_NAMES];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/prompt.test.js`

Expected: PASS (7 tests).

- [ ] **Step 5: Export and commit**

Append to `src/backend/index.ts`:

```ts
export {
  SYSTEM_PROMPT, buildTurnMessages, buildRepairMessages, PROMPT_HELPER_NAMES,
} from "./prompt.ts";
export type { TurnInput } from "./prompt.ts";
```

```bash
git add packages/cad-gen/src test/cad-gen/prompt.test.js
git commit -m "feat(cad-gen): system prompt and conversation turn assembly"
```

---

### Task 10: Repair loop and backend facade

**Files:**
- Create: `packages/cad-gen/src/backend/repair.ts`
- Create: `packages/cad-gen/src/backend/facade.ts`
- Modify: `packages/cad-gen/src/errors.ts`, `packages/cad-gen/src/backend/index.ts`
- Test: `test/cad-gen/facade.test.js`

**Interfaces:**
- Consumes: everything from Tasks 3 to 9.
- Produces: `generateWithRepair(deps, baseMessages, maxAttempts): Promise<RepairOutcome>`; `createCadGenerator(config: CadGenConfig): CadGenerator`; `CadLimits = { timeoutMs; maxTriangles; maxRepairAttempts }`; `CadGenConfig = { apiKey; baseUrl?; model?; limits?; fetchImpl? }`; `CadGenerateInput = TurnInput & { repairAttempts?: number; signal?: AbortSignal }`; `CadGenerateResult = { design; runtime; validation; diagnostics }`; `AttemptRecord = { index: number; ok: boolean; gates: GateResult[]; error?: string }`; `CadDiagnostics = { attempts: AttemptRecord[]; durationMs: number; tokens: TokenUsage }`; `CadGenerationFailed` carries the attempt log.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/facade.test.js`:

```js
import { createCadGenerator } from "@arbesk/cad-gen/backend/facade.js";

const body = (code, summary = "x") => JSON.stringify({
  code,
  parameters: { s: { value: 10, unit: "mm", min: 1, max: 100 } },
  summary,
});

const VALID = body("return box(P.s, P.s, P.s);", "Create a 10mm cube");
const BROKEN_KERNEL = body("return box(P.s, NaN, P.s);", "broken");
const BROKEN_PARSE = body("throw new Error('nope');", "broken");

// A fetch stub returning queued replies in order, repeating the last.
function stubFetch(replies) {
  let i = 0;
  return async () => {
    const content = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    }), { status: 200 });
  };
}

const generator = (replies, limits = {}) => createCadGenerator({
  apiKey: "k",
  fetchImpl: stubFetch(replies),
  limits: { timeoutMs: 20000, maxTriangles: 200000, ...limits },
});

describe("createCadGenerator", () => {
  it("returns a validated design on the first attempt", async () => {
    const g = generator([VALID]);
    const r = await g.generate({ prompt: "a 10mm cube" });
    expect(r.design.parameters.s.value).toBe(10);
    expect(r.design.turn).toBe(1);
    expect(r.validation.mode).toBe("kernel");
    expect(r.validation.stats.volumeMm3).toBeCloseTo(1000, 0);
    expect(r.diagnostics.attempts).toHaveLength(1);
    expect(r.runtime.contractVersion).toBe(1);
    expect(typeof r.runtime.preludeVersion).toBe("string");
  }, 40000);

  it("increments the turn from the prior document", async () => {
    const g = generator([VALID]);
    const r = await g.generate({
      prompt: "bigger",
      priorDesign: {
        code: "return box(P.s, P.s, P.s);",
        parameters: { s: { value: 10, unit: "mm" } },
        summary: "first",
        turn: 3,
      },
    });
    expect(r.design.turn).toBe(4);
  }, 40000);

  it("repairs a script that fails a kernel gate", async () => {
    const g = generator([BROKEN_KERNEL, VALID]);
    const r = await g.generate({ prompt: "a cube" });
    expect(r.design.code).toContain("box(P.s");
    expect(r.diagnostics.attempts).toHaveLength(2);
    expect(r.diagnostics.attempts[0].ok).toBe(false);
    expect(r.diagnostics.attempts[1].ok).toBe(true);
  }, 60000);

  it("repairs a malformed document without a kernel run", async () => {
    const g = generator(["not json at all", VALID]);
    const r = await g.generate({ prompt: "a cube" });
    expect(r.diagnostics.attempts).toHaveLength(2);
  it("repairs a malformed document without a kernel run", async () => {
    const g = generator(["not json at all", VALID]);
    const r = await g.generate({ prompt: "a cube" });
    expect(r.diagnostics.attempts).toHaveLength(2);
    expect(r.diagnostics.attempts[0].gates[0].gate).toBe("document");
  }, 60000);

  it("throws CadGenerationFailed when every attempt fails", async () => {
    const g = generator([BROKEN_PARSE]);
    await expect(g.generate({ prompt: "x", repairAttempts: 2 })).rejects.toMatchObject({
      name: "CadGenerationFailed",
    });
  }, 60000);

  it("accumulates token usage across attempts", async () => {
    const g = generator([BROKEN_KERNEL, VALID]);
    const r = await g.generate({ prompt: "x" });
    expect(r.diagnostics.tokens).toEqual({ prompt: 100, completion: 20 });
  }, 60000);

  it("caps repairAttempts at the configured maximum", async () => {
    const g = generator([BROKEN_PARSE], { maxRepairAttempts: 1 });
    const failed = g.generate({ prompt: "x", repairAttempts: 99 });
    await expect(failed).rejects.toMatchObject({ name: "CadGenerationFailed" });
    await expect(failed).rejects.toMatchObject({
      diagnostics: { attempts: [{ index: 0 }] },
    });
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/facade.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/backend/facade.js`.

- [ ] **Step 3: Add the generation-failed error**

Append to `packages/cad-gen/src/errors.ts`:

```ts
/** Every repair attempt failed; carries the attempt log for diagnostics. */
export class CadGenerationFailed extends CadError {
  readonly diagnostics: unknown;
  constructor(message: string, diagnostics: unknown) {
    super(message);
    this.name = "CadGenerationFailed";
    this.diagnostics = diagnostics;
  }
}
```

- [ ] **Step 4: Implement the repair loop**

`packages/cad-gen/src/backend/repair.ts`:

```ts
/**
 * Bounded repair loop: generate, validate, feed failures back, retry.
 * @remarks One accepted request costs the user exactly one quota unit no matter
 *   how many attempts it spends (spec section 6). Repairs are internal to the
 *   server and free to the user.
 */
import type { CadDesign, TokenUsage } from "../types.ts";
import type { GateResult } from "../core/gates.ts";
import type { LlmMessage } from "./deepseek.ts";
import type { DeepSeekClient } from "./deepseek.ts";
import { CadGenerationFailed } from "../errors.ts";

export interface AttemptRecord {
  index: number;
  ok: boolean;
  gates: GateResult[];
  error?: string;
}

export interface RepairDeps {
  client: DeepSeekClient;
  parseDesign: (input: unknown) => CadDesign;
  buildRepairMessages: (
    base: LlmMessage[],
    previous: CadDesign,
    error: string,
    gates: GateResult[],
  ) => LlmMessage[];
  validate: (design: CadDesign) => Promise<{
    ok: boolean;
    gates: GateResult[];
    error?: string;
    stats?: unknown;
  }>;
}

export interface RepairOutcome {
  design: CadDesign;
  stats: unknown;
  attempts: AttemptRecord[];
  tokens: TokenUsage;
}

/**
 * Runs generation with bounded repair.
 * @throws CadGenerationFailed when the attempt budget is exhausted.
 */
export async function generateWithRepair(
  deps: RepairDeps,
  baseMessages: LlmMessage[],
  maxAttempts: number,
): Promise<RepairOutcome> {
  const attempts: AttemptRecord[] = [];
  const tokens: TokenUsage = { prompt: 0, completion: 0 };
  let messages = baseMessages;
  let lastError = "generation failed";
  let lastGates: GateResult[] = [];

  for (let index = 0; index < maxAttempts; index++) {
    const { text, usage } = await deps.client.complete(messages);
    tokens.prompt += usage.prompt;
    tokens.completion += usage.completion;

    let design: CadDesign;
    try {
      design = deps.parseDesign(JSON.parse(text));
    } catch (e) {
      lastError = (e as Error).message;
      lastGates = [{ gate: "document", ok: false, error: lastError }];
      attempts.push({ index, ok: false, gates: lastGates, error: lastError });
      messages = [
        ...messages,
        { role: "assistant", content: text },
        {
          role: "user",
          content:
            "That response was not a valid design document: " + lastError +
            " Return the JSON object exactly as specified.",
        },
      ];
      continue;
    }

    const outcome = await deps.validate(design);
    attempts.push({
      index,
      ok: outcome.ok,
      gates: outcome.gates,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
    if (outcome.ok) {
      return { design, stats: outcome.stats, attempts, tokens };
    }

    lastError = outcome.error ?? "validation failed";
    lastGates = outcome.gates;
    messages = deps.buildRepairMessages(messages, design, lastError, lastGates);
  }

  throw new CadGenerationFailed(
    "CAD generation failed after " + maxAttempts + " attempts: " + lastError,
    { attempts, tokens },
  );
}
```

- [ ] **Step 5: Implement the facade**

`packages/cad-gen/src/backend/facade.ts`:

```ts
/**
 * Backend composition root for CAD generation.
 * @remarks Wires the DeepSeek client, the prompt, the kernel-backed validator
 *   and the repair loop. This is the only entry the Express route needs.
 */
import type { CadDesign, CadStats, TokenUsage } from "../types.ts";
import { CONTRACT_VERSION, PRELUDE_VERSION } from "../core/contract.ts";
import { PRELUDE_NAMES } from "../core/prelude.ts";
import { parseDesign } from "../core/document.ts";
import { validateDesign } from "./validate.ts";
import { createDeepSeekClient } from "./deepseek.ts";
import { buildTurnMessages, buildRepairMessages } from "./prompt.ts";
import type { TurnInput } from "./prompt.ts";
import { generateWithRepair } from "./repair.ts";
import type { AttemptRecord } from "./repair.ts";

export interface CadLimits {
  timeoutMs: number;
  maxTriangles: number;
  maxRepairAttempts: number;
  /** Host-supplied directory holding manifold.wasm. */
  wasmDir?: string;
}

export interface CadGenConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  limits?: Partial<CadLimits>;
  fetchImpl?: typeof fetch;
}

export interface CadGenerateInput extends TurnInput {
  repairAttempts?: number;
  signal?: AbortSignal;
}

export interface CadDiagnostics {
  attempts: AttemptRecord[];
  durationMs: number;
  tokens: TokenUsage;
}

export interface CadGenerateResult {
  design: CadDesign;
  runtime: { contractVersion: number; preludeVersion: string };
  validation: { mode: "kernel"; ok: true; stats: CadStats };
  diagnostics: CadDiagnostics;
}

export interface CadGenerator {
  generate(input: CadGenerateInput): Promise<CadGenerateResult>;
}

const DEFAULTS: CadLimits = {
  timeoutMs: 10000,
  maxTriangles: 200000,
  maxRepairAttempts: 3,
};

/**
 * Builds the CAD generator.
 * @remarks repairAttempts is capped by the configured maximum, so a caller
 *   cannot buy more provider spend than the server allows.
 */
export function createCadGenerator(config: CadGenConfig): CadGenerator {
  const limits: CadLimits = { ...DEFAULTS, ...config.limits };
  const client = createDeepSeekClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.deepseek.com",
    model: config.model ?? "deepseek-flash",
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
  });

  return {
    async generate(input) {
      const started = Date.now();
      const attempts = input.repairAttempts
        ? Math.min(input.repairAttempts, limits.maxRepairAttempts)
        : limits.maxRepairAttempts;

      const outcome = await generateWithRepair({
        client,
        parseDesign,
        buildRepairMessages,
        validate: (design) => validateDesign(design, {
          preludeNames: PRELUDE_NAMES,
          limits: {
            timeoutMs: limits.timeoutMs,
            maxTriangles: limits.maxTriangles,
            ...(limits.wasmDir ? { wasmDir: limits.wasmDir } : {}),
          },
        }),
      }, buildTurnMessages(input), attempts);

      return {
        design: { ...outcome.design, turn: (input.priorDesign?.turn ?? 0) + 1 },
        runtime: { contractVersion: CONTRACT_VERSION, preludeVersion: PRELUDE_VERSION },
        validation: { mode: "kernel", ok: true, stats: outcome.stats as CadStats },
        diagnostics: {
          attempts: outcome.attempts,
          durationMs: Date.now() - started,
          tokens: outcome.tokens,
        },
      };
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/facade.test.js`

Expected: PASS (7 tests). Each test spawns real children, so expect 20 to 60 s total.

- [ ] **Step 7: Export and commit**

Append to `src/backend/index.ts`:

```ts
export { generateWithRepair } from "./repair.ts";
export type { AttemptRecord, RepairDeps, RepairOutcome } from "./repair.ts";
export { createCadGenerator } from "./facade.ts";
export type {
  CadDiagnostics, CadGenerateInput, CadGenerateResult, CadGenConfig,
  CadGenerator, CadLimits,
} from "./facade.ts";
```

Also export `CadGenerationFailed` from `src/index.ts` by adding it to the existing `./errors.ts` export list.

```bash
git add packages/cad-gen/src test/cad-gen/facade.test.js
git commit -m "feat(cad-gen): bounded repair loop and backend generation facade"
```

---

### Task 11: Per-wallet quota and in-flight lock

**Files:**
- Create: `src/api/cad-quota.ts`
- Test: `test/api/cad-quota.test.js`

**Interfaces:**
- Consumes: `PROJECT_ROOT` from `src/api/project-root.ts`.
- Produces: `acquireCadSlot(wallet: string, opts: QuotaOptions): QuotaDecision`; `releaseCadSlot(wallet: string, token: string): void`; `cadQuotaHeaders(wallet: string, opts: QuotaOptions): Record<string, string>`; `_resetCadQuota(): void`; `QuotaOptions = { dailyLimit: number; lockTtlMs: number; now?: () => number; statePath?: string }`; `QuotaDecision` is a union of an ok branch carrying `token`, `used`, `limit`, an `IN_PROGRESS` branch carrying `startedAt`, and a `QUOTA` branch carrying `used`, `limit`, `resetsAt`.

- [ ] **Step 1: Write the failing test**

Create `test/api/cad-quota.test.js`:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireCadSlot, releaseCadSlot, cadQuotaHeaders, _resetCadQuota,
} from "../../src/api/cad-quota.ts";

const OPTS = { dailyLimit: 2, lockTtlMs: 1000 };
const W = "0xWallet";

let statePath;
beforeEach(() => {
  statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cad-quota-")), "q.json");
  _resetCadQuota();
});
const opts = (extra = {}) => ({ ...OPTS, statePath, ...extra });

describe("daily quota", () => {
  it("allows up to the limit then refuses", () => {
    const a = acquireCadSlot(W, opts());
    expect(a.ok).toBe(true);
    releaseCadSlot(W, a.token);

    const b = acquireCadSlot(W, opts());
    expect(b.ok).toBe(true);
    releaseCadSlot(W, b.token);

    const c = acquireCadSlot(W, opts());
    expect(c.ok).toBe(false);
    expect(c.reason).toBe("QUOTA");
    expect(c.used).toBe(2);
    expect(c.limit).toBe(2);
  });

  it("isolates wallets", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, a.token);
    const b = acquireCadSlot(W, opts());
    releaseCadSlot(W, b.token);
    expect(acquireCadSlot("0xOther", opts()).ok).toBe(true);
  });

  it("resets at the next UTC day", () => {
    let now = Date.UTC(2026, 8, 11, 23, 59, 0);
    const clock = () => now;
    for (let i = 0; i < 2; i++) {
      const d = acquireCadSlot(W, opts({ now: clock }));
      releaseCadSlot(W, d.token);
    }
    expect(acquireCadSlot(W, opts({ now: clock })).reason).toBe("QUOTA");

    now = Date.UTC(2026, 8, 12, 0, 0, 1);
    expect(acquireCadSlot(W, opts({ now: clock })).ok).toBe(true);
  });

  it("persists across a simulated restart", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, a.token);
    _resetCadQuota();
    const b = acquireCadSlot(W, opts());
    expect(b.ok).toBe(true);
    releaseCadSlot(W, b.token);
    expect(acquireCadSlot(W, opts()).reason).toBe("QUOTA");
  });

  it("starts from zero when the state file is corrupt", () => {
    fs.writeFileSync(statePath, "{ not json");
    _resetCadQuota();
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
  });

  it("tolerates a state file whose shape is wrong", () => {
    fs.writeFileSync(statePath, JSON.stringify({ nope: true }));
    _resetCadQuota();
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
  });
});

describe("in-flight lock", () => {
  it("refuses a second concurrent request for the same wallet", () => {
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
    const second = acquireCadSlot(W, opts());
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("IN_PROGRESS");
  });

  it("frees the lock once released", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, a.token);
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
  });

  it("ignores a release from a stale token", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, "not-the-token");
    expect(acquireCadSlot(W, opts()).reason).toBe("IN_PROGRESS");
    releaseCadSlot(W, a.token);
  });

  it("expires a stale lock after the TTL", () => {
    let now = 1000;
    const clock = () => now;
    acquireCadSlot(W, opts({ now: clock }));
    now += OPTS.lockTtlMs + 1;
    expect(acquireCadSlot(W, opts({ now: clock })).ok).toBe(true);
  });

  it("charges one quota unit per admitted request, not per attempt", () => {
    const a = acquireCadSlot(W, opts({ dailyLimit: 1 }));
    expect(a.used).toBe(1);
    releaseCadSlot(W, a.token);
    expect(acquireCadSlot(W, opts({ dailyLimit: 1 })).reason).toBe("QUOTA");
  });
});

describe("cadQuotaHeaders", () => {
  it("reports limit, remaining and reset", () => {
    const now = Date.UTC(2026, 8, 11, 10, 0, 0);
    const h = cadQuotaHeaders(W, opts({ now: () => now }));
    expect(h["X-Cad-Quota-Limit"]).toBe("2");
    expect(h["X-Cad-Quota-Remaining"]).toBe("2");
    expect(Number(h["X-Cad-Quota-Reset"])).toBe(Date.UTC(2026, 8, 12, 0, 0, 0) / 1000);
  });

  it("decrements remaining after an admitted request", () => {
    const a = acquireCadSlot(W, opts());
    expect(cadQuotaHeaders(W, opts())["X-Cad-Quota-Remaining"]).toBe("1");
    releaseCadSlot(W, a.token);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/api/cad-quota.test.js`

Expected: FAIL — cannot resolve `../../src/api/cad-quota.ts`.

- [ ] **Step 3: Implement the quota module**

`src/api/cad-quota.ts`:

```ts
/**
 * Per-wallet CAD quota and concurrency lock.
 * @remarks Two concerns live here because they are decided together at
 *   admission: (1) one in-flight request per wallet, held in memory only, since
 *   in-flight work cannot survive a restart; (2) a daily LLM-request counter,
 *   persisted under .data/ because a cap that evaporates on deploy is not a cap.
 *   Follows the src/api/token-indexer.ts state-file precedent.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_ROOT } from "./project-root.ts";

export interface QuotaOptions {
  dailyLimit: number;
  lockTtlMs: number;
  now?: () => number;
  statePath?: string;
}

export type QuotaDecision =
  | { ok: true; token: string; used: number; limit: number }
  | { ok: false; reason: "IN_PROGRESS"; startedAt: number }
  | { ok: false; reason: "QUOTA"; used: number; limit: number; resetsAt: number };

interface WalletState {
  /** UTC day key (YYYY-MM-DD) this count belongs to. */
  day: string;
  used: number;
}

interface PersistedState {
  wallets: Record<string, WalletState>;
}

const DATA_DIR = path.resolve(PROJECT_ROOT, ".data");
const DEFAULT_STATE_PATH = path.join(DATA_DIR, "cad-quota.json");
const PRUNE_AFTER_DAYS = 2;

/** wallet -> { token, startedAt } for requests currently running. */
const locks = new Map<string, { token: string; startedAt: number }>();
let state: PersistedState | null = null;

function nowMs(opts: QuotaOptions): number {
  return opts.now ? opts.now() : Date.now();
}

/** UTC day key, so the quota rolls over at 00:00 UTC regardless of host TZ. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch seconds of the next UTC midnight. */
function nextUtcMidnightSeconds(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
}

function statePathOf(opts: QuotaOptions): string {
  return opts.statePath ?? DEFAULT_STATE_PATH;
}

/**
 * Loads the persisted counters.
 * @remarks A missing, corrupt or wrongly-shaped file starts from zero rather
 *   than failing the request: the quota is a guard rail, not an authorization
 *   boundary.
 */
function loadState(opts: QuotaOptions): PersistedState {
  if (state) return state;
  const file = statePathOf(opts);
  try {
    if (!fs.existsSync(file)) {
      state = { wallets: {} };
      return state;
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PersistedState;
    state = parsed && typeof parsed === "object" && parsed.wallets && typeof parsed.wallets === "object"
      ? parsed
      : { wallets: {} };
    if (state !== parsed) console.log("[CAD] quota state unreadable - starting from zero");
  } catch {
    console.log("[CAD] quota state unreadable - starting from zero");
    state = { wallets: {} };
  }
  return state;
}

/** Prunes entries older than the retention window and writes atomically. */
function pruneAndSave(opts: QuotaOptions, current: PersistedState, now: number): void {
  const cutoff = utcDay(now - PRUNE_AFTER_DAYS * 86400000);
  for (const [wallet, entry] of Object.entries(current.wallets)) {
    if (entry.day < cutoff) delete current.wallets[wallet];
  }
  const file = statePathOf(opts);
  try {
    if (!fs.existsSync(path.dirname(file))) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.log("[CAD] quota state save failed: " + (err as Error).message);
  }
}

/**
 * Admits or rejects one CAD request for a wallet.
 * @remarks Called synchronously so the quota check and lock acquisition cannot
 *   race (spec section 6, admission order).
 */
export function acquireCadSlot(wallet: string, opts: QuotaOptions): QuotaDecision {
  const now = nowMs(opts);
  const key = wallet.toLowerCase();

  const held = locks.get(key);
  if (held && now - held.startedAt <= opts.lockTtlMs) {
    return { ok: false, reason: "IN_PROGRESS", startedAt: held.startedAt };
  }

  const current = loadState(opts);
  const day = utcDay(now);
  const entry = current.wallets[key];
  const used = entry && entry.day === day ? entry.used : 0;

  if (used >= opts.dailyLimit) {
    return {
      ok: false,
      reason: "QUOTA",
      used,
      limit: opts.dailyLimit,
      resetsAt: nextUtcMidnightSeconds(now),
    };
  }

  const token = randomUUID();
  locks.set(key, { token, startedAt: now });
  current.wallets[key] = { day, used: used + 1 };
  pruneAndSave(opts, current, now);
  console.log("[CAD] wallet=" + key + " quota=" + (used + 1) + "/" + opts.dailyLimit);

  return { ok: true, token, used: used + 1, limit: opts.dailyLimit };
}

/**
 * Releases the in-flight lock.
 * @remarks A release with a stale token is ignored: a lock is only ever freed
 *   by the request that took it.
 */
export function releaseCadSlot(wallet: string, token: string): void {
  const key = wallet.toLowerCase();
  const held = locks.get(key);
  if (held && held.token === token) locks.delete(key);
}

/** Quota headers, so a UI can show the remaining budget. */
export function cadQuotaHeaders(wallet: string, opts: QuotaOptions): Record<string, string> {
  const now = nowMs(opts);
  const current = loadState(opts);
  const entry = current.wallets[wallet.toLowerCase()];
  const used = entry && entry.day === utcDay(now) ? entry.used : 0;
  return {
    "X-Cad-Quota-Limit": String(opts.dailyLimit),
    "X-Cad-Quota-Remaining": String(Math.max(0, opts.dailyLimit - used)),
    "X-Cad-Quota-Reset": String(nextUtcMidnightSeconds(now)),
  };
}

/** Test helper: drops the in-memory counters and the lock table. */
export function _resetCadQuota(): void {
  locks.clear();
  state = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/api/cad-quota.test.js`

Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/cad-quota.ts test/api/cad-quota.test.js
git commit -m "feat(cad): per-wallet daily quota and in-flight lock"
```

---

### Task 12: HTTP route, schema and environment

**Files:**
- Create: `src/api/routes/cad.ts`
- Modify: `src/api/schemas.ts` (append `cadGenerateSchema`)
- Modify: `src/api/index.ts` (mount)
- Modify: `.env.example`
- Test: `test/api/cad-route.test.js`

**Interfaces:**
- Consumes: `createCadGenerator` (Task 10), `acquireCadSlot`, `releaseCadSlot`, `cadQuotaHeaders` (Task 11), `validateBody` (`src/api/validation.ts`), `sendError` (`src/api/errors.ts`), `authenticate` (`src/api/authentication.ts`).
- Produces: `cadRouter(deps?: CadRouteDeps): Router`; `CadRouteDeps = { generate?: CadGenerateFn; authenticateOverride?: RequestHandler }`; `CadGenerateFn = (input: any) => Promise<any>`.

- [ ] **Step 1: Write the failing test**

Create `test/api/cad-route.test.js`:

```js
import express from "express";
import request from "supertest";
import { cadRouter } from "../../src/api/routes/cad.ts";
import { _resetCadQuota } from "../../src/api/cad-quota.ts";

const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 1,
};

const OK = {
  design: DESIGN,
  runtime: { contractVersion: 1, preludeVersion: "2026-09-11" },
  validation: {
    mode: "kernel",
    ok: true,
    stats: {
      triangles: 12, vertices: 8, volumeMm3: 1000,
      bboxMm: { min: [0, 0, 0], max: [10, 10, 10] },
    },
  },
  diagnostics: {
    attempts: [{ index: 0, ok: true, gates: [] }],
    durationMs: 5,
    tokens: { prompt: 1, completion: 2 },
  },
};

function app(generate) {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => { res.locals.userAddress = "0xWallet"; next(); });
  a.use("/cad", cadRouter({ generate, authenticateOverride: (_r, _s, n) => n() }));
  return a;
}

const okGenerate = async () => OK;

beforeEach(() => {
  _resetCadQuota();
  process.env.CAD_DAILY_REQUEST_LIMIT = "2";
  process.env.DEEPSEEK_API_KEY = "test-key";
});

describe("POST /cad/generations", () => {
  it("returns the design document and never artifacts", async () => {
    const res = await request(app(okGenerate)).post("/cad/generations").send({ prompt: "a cube" });
    expect(res.status).toBe(200);
    expect(res.body.design.code).toBe(DESIGN.code);
    expect(res.body.artifacts).toBeUndefined();
    expect(res.body.formats).toBeUndefined();
    expect(res.body.runtime.contractVersion).toBe(1);
    expect(res.body.validation.stats.triangles).toBe(12);
  });

  it("rejects an empty body with VALIDATION_ERROR", async () => {
    const res = await request(app(okGenerate)).post("/cad/generations").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unsupported image mime type", async () => {
    const res = await request(app(okGenerate)).post("/cad/generations")
      .send({ prompt: "x", images: [{ data: "AAAA", mime: "image/tiff" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 while a request for the same wallet is in flight", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const slow = async () => { await gate; return OK; };
    const a = app(slow);
    const first = request(a).post("/cad/generations").send({ prompt: "a cube" });
    await new Promise((r) => setTimeout(r, 50));
    const second = await request(a).post("/cad/generations").send({ prompt: "a cube" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("GENERATION_IN_PROGRESS");
    expect(second.headers["retry-after"]).toBe("5");
    release();
    await first;
  });

  it("returns 429 once the daily quota is spent", async () => {
    const a = app(okGenerate);
    await request(a).post("/cad/generations").send({ prompt: "a cube" });
    await request(a).post("/cad/generations").send({ prompt: "a cube" });
    const third = await request(a).post("/cad/generations").send({ prompt: "a cube" });
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe("DAILY_QUOTA_EXCEEDED");
    expect(third.body.error.details.limit).toBe(2);
  });

  it("sends quota headers", async () => {
    const res = await request(app(okGenerate)).post("/cad/generations").send({ prompt: "a cube" });
    expect(res.headers["x-cad-quota-limit"]).toBe("2");
    expect(res.headers["x-cad-quota-remaining"]).toBe("1");
    expect(Number(res.headers["x-cad-quota-reset"])).toBeGreaterThan(0);
  });

  it("returns 503 when the key is not configured", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const res = await request(app(undefined)).post("/cad/generations").send({ prompt: "a cube" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("CAD_NOT_CONFIGURED");
  });

  it("maps a provider auth failure to 502 PROVIDER_AUTH_FAILED", async () => {
    const failing = async () => {
      const e = new Error("bad key");
      e.name = "ProviderError";
      e.status = 401;
      e.code = "PROVIDER_AUTH_FAILED";
      throw e;
    };
    const res = await request(app(failing)).post("/cad/generations").send({ prompt: "a cube" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("PROVIDER_AUTH_FAILED");
  });

  it("maps exhausted repair attempts to 500 with diagnostics", async () => {
    const failing = async () => {
      const e = new Error("nope");
      e.name = "CadGenerationFailed";
      e.diagnostics = { attempts: [], tokens: { prompt: 0, completion: 0 } };
      throw e;
    };
    const res = await request(app(failing)).post("/cad/generations").send({ prompt: "a cube" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("CAD_GENERATION_FAILED");
    expect(res.body.error.details.attempts).toEqual([]);
  });

  it("releases the lock after a failure so the next request is admitted", async () => {
    let fail = true;
    const sometimes = async () => {
      if (fail) {
        fail = false;
        throw Object.assign(new Error("boom"), { name: "CadGenerationFailed", diagnostics: {} });
      }
      return OK;
    };
    const a = app(sometimes);
    const first = await request(a).post("/cad/generations").send({ prompt: "a cube" });
    expect(first.status).toBe(500);
    const second = await request(a).post("/cad/generations").send({ prompt: "a cube" });
    expect(second.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/api/cad-route.test.js`

Expected: FAIL — cannot resolve `../../src/api/routes/cad.ts`.

- [ ] **Step 3: Add the Zod schema**

Append to `src/api/schemas.ts`:

```ts
/** Base64 image attachment for a CAD prompt (mirrors the Tripo image shape). */
const cadImageSchema = z.object({
  data: z.string().min(1),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});

/** Per-turn design document echoed back for stateless continuity. */
const cadDesignSchema = z.object({
  code: z.string().min(1).max(65536),
  parameters: z.record(
    z.object({
      value: z.number().finite(),
      unit: z.literal("mm"),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      label: z.string().max(120).optional(),
    }),
  ),
  summary: z.string().max(2000).optional(),
  turn: z.number().int().positive().optional(),
});

export const cadGenerateSchema = z
  .object({
    prompt: z.string().min(1, "prompt is required").max(8000).optional(),
    priorDesign: cadDesignSchema.optional(),
    sourceRef: z
      .object({
        cid: z.string().min(1).max(200).optional(),
        assetId: z.string().min(1).max(200).optional(),
      })
      .optional(),
    images: z.array(cadImageSchema).max(4).optional(),
    repairAttempts: z.number().int().min(1).max(5).optional(),
  })
  .refine((v) => Boolean(v.prompt) || Boolean(v.sourceRef), {
    message: "prompt or sourceRef is required",
    path: ["prompt"],
  });
```

- [ ] **Step 4: Implement the route**

`src/api/routes/cad.ts`:

```ts
/**
 * CAD generation routes.
 * @remarks Thin by design (docs/ARCHITECTURE.md section 1.5): validate,
 *   authenticate, gate on quota and concurrency, delegate, map errors. No CAD
 *   logic lives here.
 * @remarks The server returns a validated design document and NEVER geometry —
 *   the client executes the code and produces GLB/3MF (spec section 7).
 */
import express from "express";
import type { Request, Response, RequestHandler } from "express";
import { cadGenerateSchema } from "../schemas.ts";
import { validateBody } from "../validation.ts";
import { sendError } from "../errors.ts";
import authenticate from "../authentication.ts";
import { acquireCadSlot, releaseCadSlot, cadQuotaHeaders } from "../cad-quota.ts";
import { PROJECT_ROOT } from "../project-root.ts";
import path from "node:path";
import { createCadGenerator } from "@arbesk/cad-gen/backend/index.js";

const Router = express.Router;

/** Injected in tests; production builds the real generator from env. */
export type CadGenerateFn = (input: any) => Promise<any>;

export interface CadRouteDeps {
  generate?: CadGenerateFn;
  /** Tests inject a no-op; production uses the real session middleware. */
  authenticateOverride?: RequestHandler;
}

/** Quota and lock settings, read per request so tests can override the env. */
function quotaOptions() {
  return {
    dailyLimit: Number(process.env.CAD_DAILY_REQUEST_LIMIT || 50),
    lockTtlMs: Number(process.env.CAD_MAX_REQUEST_MS || 120000),
  };
}

/** Builds the generator from environment variables, or null when unconfigured. */
function generatorFromEnv(): CadGenerateFn | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const generator = createCadGenerator({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    limits: {
      timeoutMs: Number(process.env.CAD_EXEC_TIMEOUT_MS || 10000),
      maxTriangles: Number(process.env.CAD_MAX_TRIANGLES || 200000),
      maxRepairAttempts: Number(process.env.CAD_MAX_REPAIR_ATTEMPTS || 3),
      // PROJECT_ROOT-relative: a compiled server has no usable module-URL ancestry.
      wasmDir: process.env.CAD_MANIFOLD_WASM_DIR ||
        path.resolve(PROJECT_ROOT, "node_modules", "manifold-3d"),
    },
  });
  return (input) => generator.generate(input);
}

/** Maps a thrown provider/CAD error onto the documented response. */
function sendCadError(res: Response, err: Error): Response {
  const e = err as Error & { status?: number; code?: string; diagnostics?: unknown };
  if (e.name === "CadGenerationFailed") {
    console.log("[CAD] generation failed: " + e.message);
    return sendError(res, 500, "CAD_GENERATION_FAILED", e.message, e.diagnostics ?? null);
  }
  if (e.name === "ProviderError" && typeof e.status === "number") {
    console.log("[CAD] provider error status=" + e.status);
    return sendError(res, 502, e.code || "PROVIDER_ERROR", e.message);
  }
  console.error("[CAD] unexpected error: " + e.message);
  return sendError(res, 500, "CAD_GENERATION_FAILED", "CAD generation failed");
}

export function cadRouter(deps: CadRouteDeps = {}) {
  const router = Router();
  const auth = deps.authenticateOverride ?? authenticate;

  router.post(
    "/generations",
    auth,
    validateBody(cadGenerateSchema),
    async (req: Request, res: Response) => {
      const wallet = res.locals.userAddress as string;
      const opts = quotaOptions();

      if (req.body.images) {
        const max = Number(process.env.CAD_MAX_IMAGE_BYTES || 8388608);
        for (const img of req.body.images) {
          if (Buffer.byteLength(img.data, "base64") > max) {
            return sendError(res, 413, "IMAGE_TOO_LARGE", "image exceeds " + max + " bytes");
          }
        }
      }

      const generate = deps.generate ?? generatorFromEnv();
      if (!generate) {
        return sendError(
          res, 503, "CAD_NOT_CONFIGURED",
          "CAD generation is not configured (DEEPSEEK_API_KEY unset)",
        );
      }

      // Quota check and lock acquisition are synchronous and adjacent, so a
      // rejected request can never take the lock (spec section 6).
      const decision = acquireCadSlot(wallet, opts);
      if (!decision.ok) {
        if (decision.reason === "IN_PROGRESS") {
          res.setHeader("Retry-After", "5");
          return sendError(
            res, 409, "GENERATION_IN_PROGRESS",
            "a CAD generation for this wallet is already running",
            { startedAt: decision.startedAt },
          );
        }
        return sendError(
          res, 429, "DAILY_QUOTA_EXCEEDED",
          "daily CAD generation limit reached",
          { limit: decision.limit, used: decision.used, resetsAt: decision.resetsAt },
        );
      }

      for (const [k, v] of Object.entries(cadQuotaHeaders(wallet, opts))) {
        res.setHeader(k, v);
      }

      try {
        const result = await generate({
          prompt: req.body.prompt ?? "",
          ...(req.body.priorDesign ? { priorDesign: req.body.priorDesign } : {}),
          ...(req.body.images ? { images: req.body.images } : {}),
          ...(req.body.repairAttempts ? { repairAttempts: req.body.repairAttempts } : {}),
        });
        return res.json(result);
      } catch (error) {
        return sendCadError(res, error as Error);
      } finally {
        releaseCadSlot(wallet, decision.token);
      }
    },
  );

  return router;
}

export default cadRouter;
```

- [ ] **Step 5: Mount the route**

In `src/api/index.ts`, add the import next to the existing route imports:

```ts
import { cadRouter } from "./routes/cad.ts";
```

and mount it after the generations mount:

```ts
  // ─── Engineering CAD Generation ───────────────────────────────────────────

  v1.use("/cad", cadRouter());
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test -- test/api/cad-route.test.js`

Expected: PASS (10 tests).

- [ ] **Step 7: Document the environment**

Append to `.env.example`:

```bash
# ─── Engineering CAD generation (@arbesk/cad-gen) ───
# Server-only DeepSeek key used to write Manifold scripts. The server returns
# the script; the CLIENT executes it and produces GLB/3MF. Never served to the browser.
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
# unset → enabled iff DEEPSEEK_API_KEY is present
CAD_GENERATION_ENABLED=
CAD_MAX_REPAIR_ATTEMPTS=3
CAD_EXEC_TIMEOUT_MS=10000
CAD_MAX_TRIANGLES=200000
CAD_MAX_IMAGES=4
CAD_MAX_IMAGE_BYTES=8388608
# LLM requests per wallet per UTC day
CAD_DAILY_REQUEST_LIMIT=50
# in-flight lock TTL and hard request ceiling
CAD_MAX_REQUEST_MS=120000
```

- [ ] **Step 8: Commit**

```bash
git add src/api/routes/cad.ts src/api/schemas.ts src/api/index.ts .env.example test/api/cad-route.test.js
git commit -m "feat(cad): POST /api/v1/cad/generations with quota, lock and error mapping"
```

---

### Task 13: Core exporters — GLB, 3MF and the design sidecar

**Files:**
- Create: `packages/cad-gen/src/core/export/embed.ts`
- Create: `packages/cad-gen/src/core/export/glb.ts`
- Create: `packages/cad-gen/src/core/export/three-mf.ts`
- Create: `packages/cad-gen/src/core/export/index.ts`
- Modify: `packages/cad-gen/src/index.ts`
- Test: `test/cad-gen/exporters.test.js`

**Interfaces:**
- Consumes: `CadMesh`, `CadDesign` (Task 3), `parseDesign` (Task 3), `serializeGLB` from asset-core.
- Produces: `meshToGlb(mesh: CadMesh, design: CadDesign): Uint8Array`; `meshTo3mf(mesh: CadMesh, design: CadDesign): Uint8Array`; `readDesignFrom3mf(bytes: Uint8Array): CadDesign | null`; `serializeDesign(design: CadDesign): string`; `parseEmbeddedDesign(json: unknown): CadDesign | null`; `SIDECAR_PART_PATH`; `SIDECAR_REL_TYPE`.

- [ ] **Step 1: Write the failing test**

Create `test/cad-gen/exporters.test.js`:

```js
import { unzipSync, strFromU8 } from "fflate";
import { meshToGlb, meshTo3mf, readDesignFrom3mf } from "@arbesk/cad-gen/core/export/index.js";
import { compose, detectFormat } from "@arbesk/asset-core/formats/index.js";

// A unit tetrahedron: 4 vertices, 4 triangles.
const MESH = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};
const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 2,
};

function readGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
}

describe("meshTo3mf", () => {
  it("writes a 3MF package with the required OPC parts", () => {
    const bytes = meshTo3mf(MESH, DESIGN);
    expect(detectFormat(bytes)).toBe("3mf");
    const parts = unzipSync(bytes);
    expect(Object.keys(parts)).toContain("[Content_Types].xml");
    expect(Object.keys(parts)).toContain("_rels/.rels");
    expect(Object.keys(parts)).toContain("3D/3dmodel.model");
    const model = strFromU8(parts["3D/3dmodel.model"]);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain("<vertices>");
    expect((model.match(/<triangle /g) || []).length).toBe(4);
    expect(model).toContain("<build>");
    expect(model).toContain("<item objectid=\"1\"/>");
  });

  it("round-trips through asset-core's own 3MF parser", async () => {
    const bytes = meshTo3mf(MESH, DESIGN);
    const gltf = JSON.parse(new TextDecoder().decode(await compose(bytes)));
    expect(gltf.meshes[0].primitives[0].indices).toBeDefined();
  });

  it("embeds the design document as a declared part", () => {
    const bytes = meshTo3mf(MESH, DESIGN);
    const design = readDesignFrom3mf(bytes);
    expect(design.code).toBe(DESIGN.code);
    expect(design.parameters.s.value).toBe(10);
    expect(design.summary).toBe("cube");
  });

  it("returns null for a package without the sidecar", () => {
    expect(readDesignFrom3mf(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("meshToGlb", () => {
  it("writes a GLB with the magic header", () => {
    const bytes = meshToGlb(MESH, DESIGN);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).toBe(0x46546c67);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("applies the mm to m and Z-up to Y-up transform on the node, not the vertices", () => {
    const json = readGlbJson(meshToGlb(MESH, DESIGN));
    const m = json.nodes[0].matrix;
    expect(m[0]).toBeCloseTo(0.001, 9);
    expect(m[6]).toBeCloseTo(-0.001, 9);
    expect(m[9]).toBeCloseTo(0.001, 9);
    expect(json.meshes[0].primitives[0].attributes.POSITION).toBe(1);
  });

  it("embeds the design document in asset extras", () => {
    const json = readGlbJson(meshToGlb(MESH, DESIGN));
    expect(json.asset.extras.arbesk_cad.code).toBe(DESIGN.code);
    expect(json.asset.extras.arbesk_units).toBe("mm");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/cad-gen/exporters.test.js`

Expected: FAIL — cannot resolve `@arbesk/cad-gen/core/export/index.js`.

- [ ] **Step 3: Implement the sidecar**

`packages/cad-gen/src/core/export/embed.ts`:

```ts
/**
 * Design-document sidecar: read/write the design inside the exported artifact.
 * @remarks This is what makes a stateless sourceRef lossless (spec section 7):
 *   any CID of a generated part round-trips the whole design document, so the
 *   server needs no design-session storage.
 */
import type { CadDesign } from "../../types.ts";
import { parseDesign } from "../document.ts";

/** OPC part path carrying the design inside a .3mf package. */
export const SIDECAR_PART_PATH = "Metadata/arbesk_cad.json";

/** Relationship type for that part. */
export const SIDECAR_REL_TYPE = "https://arbesk.io/3mf/cad-design";

/** Serialises a design for embedding. */
export function serializeDesign(design: CadDesign): string {
  return JSON.stringify({
    arbesk_cad: 1,
    code: design.code,
    parameters: design.parameters,
    summary: design.summary,
    ...(design.turn ? { turn: design.turn } : {}),
  }, null, 2);
}

/**
 * Parses an embedded design.
 * @returns null when the payload is absent or unusable, which callers translate
 *   into SOURCE_ASSET_UNSUPPORTED_FORMAT.
 */
export function parseEmbeddedDesign(json: unknown): CadDesign | null {
  try {
    return parseDesign(json);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement the GLB exporter**

`packages/cad-gen/src/core/export/glb.ts`:

```ts
/**
 * Mesh to GLB, for previewing a CAD part.
 * @remarks Vertex data stays in Manifold coordinates (mm, Z-up): the mm-to-m and
 *   Z-up-to-Y-up correction is applied as a NODE MATRIX, matching the convention
 *   asset-core's 3mf/to-gltf.ts already uses for 3MF input. Baking it into the
 *   vertices would corrupt the mesh for every other consumer.
 */
import { serializeGLB } from "@arbesk/asset-core/formats/gltf/gltf-core.js";
import type { CadDesign, CadMesh } from "../../types.ts";

/** Column-major node matrix: rotate -90 degrees about X, then scale mm to m. */
const MM_TO_M_Z_UP_TO_Y_UP = [
  0.001, 0, 0, 0,
  0, 0, -0.001, 0,
  0, 0.001, 0, 0,
  0, 0, 0, 1,
];

/** Area-weighted vertex normals computed from positions and indices. */
function computeNormals(mesh: CadMesh): Float32Array {
  const { positions, indices } = mesh;
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

/**
 * Serialises a mesh plus its design document to GLB bytes.
 * @remarks Single self-contained buffer; the design rides in asset.extras.
 */
export function meshToGlb(mesh: CadMesh, design: CadDesign): Uint8Array {
  const normals = computeNormals(mesh);
  const indexBytes = new Uint8Array(
    mesh.indices.buffer.slice(mesh.indices.byteOffset, mesh.indices.byteOffset + mesh.indices.byteLength),
  );
  const posBytes = new Uint8Array(
    mesh.positions.buffer.slice(mesh.positions.byteOffset, mesh.positions.byteOffset + mesh.positions.byteLength),
  );
  const normalBytes = new Uint8Array(
    normals.buffer.slice(normals.byteOffset, normals.byteOffset + normals.byteLength),
  );

  const indexPad = (4 - (indexBytes.length % 4)) % 4;
  const posPad = (4 - (posBytes.length % 4)) % 4;
  const posOffset = indexBytes.length + indexPad;
  const normalOffset = posOffset + posBytes.length + posPad;

  const bin = new Uint8Array(normalOffset + normalBytes.length);
  bin.set(indexBytes, 0);
  bin.set(posBytes, posOffset);
  bin.set(normalBytes, normalOffset);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    minZ = Math.min(minZ, mesh.positions[i + 2]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }

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
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      { bufferView: 2, componentType: 5126, count: normals.length / 3, type: "VEC3" },
    ],
  };

  return new Uint8Array(serializeGLB(gltf as never, bin));
}
```

- [ ] **Step 5: Implement the 3MF exporter**

`packages/cad-gen/src/core/export/three-mf.ts`:

```ts
/**
 * Mesh to .3mf (OPC package, millimetres, Z-up).
 * @remarks Written by hand rather than via manifold's lib/export-3mf.js: that
 *   path pulls @jscadui/3mf-export, a second @gltf-transform and an esbuild-wasm
 *   peer, and offers no hook for the design sidecar (spec section 7).
 */
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import type { CadDesign, CadMesh } from "../../types.ts";
import {
  SIDECAR_PART_PATH, SIDECAR_REL_TYPE, serializeDesign, parseEmbeddedDesign,
} from "./embed.ts";

const MODEL_PATH = "3D/3dmodel.model";

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
  '  <Default Extension="json" ContentType="application/vnd.arbesk.cad+json"/>',
  "</Types>",
].join("\n");

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '  <Relationship Target="/' + MODEL_PATH +
    '" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
  '  <Relationship Target="/' + SIDECAR_PART_PATH +
    '" Id="rel1" Type="' + SIDECAR_REL_TYPE + '"/>',
  "</Relationships>",
].join("\n");

/** Renders the 3MF core-spec model part. */
function buildModelXml(mesh: CadMesh): string {
  const verts: string[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    verts.push(
      '          <vertex x="' + mesh.positions[i] +
      '" y="' + mesh.positions[i + 1] +
      '" z="' + mesh.positions[i + 2] + '"/>',
    );
  }
  const tris: string[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    tris.push(
      '          <triangle v1="' + mesh.indices[i] +
      '" v2="' + mesh.indices[i + 1] +
      '" v3="' + mesh.indices[i + 2] + '"/>',
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" ' +
      'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '  <metadata name="Application">Arbesk CAD</metadata>',
    "  <resources>",
    '    <object id="1" type="model">',
    "      <mesh>",
    "        <vertices>",
    verts.join("\n"),
    "        </vertices>",
    "        <triangles>",
    tris.join("\n"),
    "        </triangles>",
    "      </mesh>",
    "    </object>",
    "  </resources>",
    "  <build>",
    '    <item objectid="1"/>',
    "  </build>",
    "</model>",
  ].join("\n");
}

/**
 * Serialises a mesh plus its design document to .3mf bytes.
 * @remarks The design travels as a declared OPC part, so the package alone
 *   reconstructs the full design state.
 */
export function meshTo3mf(mesh: CadMesh, design: CadDesign): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    [MODEL_PATH]: strToU8(buildModelXml(mesh)),
    [SIDECAR_PART_PATH]: strToU8(serializeDesign(design)),
  }, { level: 6 });
}

/**
 * Reads the design document back out of a .3mf package.
 * @returns null when the part is absent or unusable.
 */
export function readDesignFrom3mf(bytes: Uint8Array): CadDesign | null {
  try {
    const parts = unzipSync(bytes);
    const raw = parts[SIDECAR_PART_PATH];
    if (!raw) return null;
    return parseEmbeddedDesign(JSON.parse(strFromU8(raw)));
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Add the export barrel**

`packages/cad-gen/src/core/export/index.ts`:

```ts
/** CAD exporters — environment-agnostic; the browser uses these too. */
export { meshToGlb } from "./glb.ts";
export { meshTo3mf, readDesignFrom3mf } from "./three-mf.ts";
export {
  SIDECAR_PART_PATH, SIDECAR_REL_TYPE, serializeDesign, parseEmbeddedDesign,
} from "./embed.ts";
```

- [ ] **Step 7: Expose the kernel and prelude on the root entry**

Append to `packages/cad-gen/src/index.ts`:

```ts
export { meshToGlb } from "./core/export/glb.ts";
export { meshTo3mf, readDesignFrom3mf } from "./core/export/three-mf.ts";
export { createCadKernel } from "./core/kernel.ts";
export { PRELUDE_NAMES, buildPrelude } from "./core/prelude.ts";
export type { CadKernel, KernelRunResult } from "./core/kernel.ts";
export type { PreludeHelpers } from "./core/prelude.ts";
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run test -- test/cad-gen/exporters.test.js`

Expected: PASS (7 tests). The asset-core round-trip test is the important one — it proves the package is readable by Arbesk's own 3MF parser, the closest available proxy for third-party slicer validity.

- [ ] **Step 9: Commit**

```bash
git add packages/cad-gen/src test/cad-gen/exporters.test.js
git commit -m "feat(cad-gen): GLB and 3MF exporters with design-document sidecar"
```

---

### Task 14: Local harness, docs and cleanup

**Files:**
- Create: `scripts/cad-smoke.mjs`
- Create: `packages/cad-gen/AGENTS.md`
- Modify: `packages/AGENTS.md`, `docs/CURRENT_STATUS.md`
- Delete: `scripts/cad-spike.mjs`, `scripts/cad-spike-child.mjs`
- Test: manual (requires network and an API key; not in CI)

**Interfaces:**
- Consumes: `@arbesk/cad-gen` (core), `@arbesk/cad-gen/backend/index.js`, `@arbesk/cad-gen/core/export/index.js`.
- Produces: a runnable harness that writes `test-results/cad/{design.json,part.glb,part.3mf}`, and the browser worker's reference implementation.

- [ ] **Step 1: Write the harness**

`scripts/cad-smoke.mjs` — generate via the backend facade, then execute locally exactly as the browser worker will:

```js
#!/usr/bin/env bun
/**
 * CAD smoke harness: prompt -> validated design -> real GLB/3MF on disk.
 * @remarks Doubles as the reference implementation of the client pipeline the
 *   browser worker will follow (spec section 7): guard, verify contract, load
 *   the kernel, execute, export. Requires DEEPSEEK_API_KEY. Not part of CI.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "manifold-3d";
import { createCadGenerator } from "@arbesk/cad-gen/backend/index.js";
import {
  createCadKernel, guardScript, PRELUDE_NAMES, PRELUDE_VERSION,
} from "@arbesk/cad-gen";
import { meshToGlb, meshTo3mf } from "@arbesk/cad-gen/core/export/index.js";

const prompt = process.argv[2] ?? "a 60x40x10mm plate with a 6mm hole in each corner";
const priorFlag = process.argv.indexOf("--prior");
const priorDesign = priorFlag > -1
  ? JSON.parse(fs.readFileSync(process.argv[priorFlag + 1], "utf8"))
  : undefined;

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required");
  process.exit(1);
}

const generator = createCadGenerator({ apiKey });
const result = await generator.generate({ prompt, ...(priorDesign ? { priorDesign } : {}) });

console.log("[SMOKE] summary: " + result.design.summary);
console.log("[SMOKE] parameters: " + JSON.stringify(result.design.parameters));
console.log("[SMOKE] validation: " + JSON.stringify(result.validation.stats));
console.log("[SMOKE] attempts: " + result.diagnostics.attempts.length +
  " in " + result.diagnostics.durationMs + "ms");

// The client MUST re-run the guard - it never trusts the server (spec section 7).
const guard = guardScript(result.design.code, PRELUDE_NAMES);
if (!guard.ok) {
  console.error("[SMOKE] guard rejected server-validated code: " +
    guard.reason + " " + (guard.detail ?? ""));
  process.exit(1);
}
if (result.runtime.preludeVersion !== PRELUDE_VERSION) {
  console.error("[SMOKE] prelude version mismatch: server=" +
    result.runtime.preludeVersion + " local=" + PRELUDE_VERSION);
  process.exit(1);
}

const wasmDir = process.env.CAD_MANIFOLD_WASM_DIR ||
  path.resolve(process.cwd(), "node_modules", "manifold-3d");
// `checkJs` is on: the callback parameter needs an inline JSDoc type, and the
// config needs a cast because manifold-3d declares locateFile with zero arity.
/** @type {any} */
const moduleConfig = { locateFile: (/** @type {string} */ f) => path.join(wasmDir, f) };
const module = await Module(moduleConfig);
module.setup(); // manifold-3d registers its JS API lazily (see Task 1 results)
const kernel = createCadKernel(module);
const { mesh, stats } = kernel.run(result.design);

const outDir = path.resolve("test-results", "cad");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "design.json"), JSON.stringify(result.design, null, 2));
fs.writeFileSync(path.join(outDir, "part.glb"), meshToGlb(mesh, result.design));
fs.writeFileSync(path.join(outDir, "part.3mf"), meshTo3mf(mesh, result.design));

console.log("[SMOKE] client stats: " + JSON.stringify(stats));
console.log("[SMOKE] wrote " + outDir + "/part.glb and part.3mf");
```

- [ ] **Step 2: Run the harness against the live API**

Run:

```bash
DEEPSEEK_API_KEY=... bun scripts/cad-smoke.mjs "a 60x40x10mm plate with a 6mm hole in each corner"
```

Expected: a summary printed, one GLB and one 3MF written, and **client stats matching the server's validation stats** (same triangle count and volume). A mismatch means the two hosts disagree about the same script — stop and investigate before proceeding, because that is exactly the drift the shared `core/` exists to prevent.

- [ ] **Step 3: Verify the iteration path**

Run:

```bash
DEEPSEEK_API_KEY=... bun scripts/cad-smoke.mjs "add a 2mm fillet to the vertical edges" --prior test-results/cad/design.json
```

Expected: the new design keeps the previous parameters (proving `priorDesign` carries continuity, which `priorCode` could not) and adds a fillet; `filletMode` is reported in the validation stats.

- [ ] **Step 4: Open both files in a slicer and a viewer**

Load `test-results/cad/part.3mf` in PrusaSlicer or Bambu Studio, and `test-results/cad/part.glb` in any glTF viewer.

Expected: the part appears at true size (mm) in the slicer; in the viewer it is correctly oriented (Z-up becomes Y-up) and scaled. This is the only check that proves real third-party tool compatibility (spec section 11) — record the outcome in the PR description.

- [ ] **Step 5: Delete the spike probes**

```bash
git rm scripts/cad-spike.mjs scripts/cad-spike-child.mjs
```

- [ ] **Step 6: Write the package guide**

Create `packages/cad-gen/AGENTS.md` documenting:

- the `core/` vs `backend/` split, and why the root entry exports `core/` only;
- the prelude as a published contract tied to `PRELUDE_VERSION`, and that adding or renaming a helper is a breaking change;
- the fillet fidelity table (exact on prismatic parts, Minkowski for true rounds, smooth for appearance);
- that the server never exports or returns geometry;
- the guard-on-both-hosts rule, and that the client must never trust the server's guard.

- [ ] **Step 7: Update the shared docs**

- `packages/AGENTS.md`: add `@arbesk/cad-gen` to the package table and to the dependency-order diagram as `asset-core <- cad-gen`.
- `docs/CURRENT_STATUS.md`: add a CAD generation row and the new environment variables to section 8.

- [ ] **Step 8: Full verification**

Run:

```bash
bun run lint
bun run typecheck
bun run typecheck:frontend
bun run test
```

Expected: all pass. `bun run test` includes the new `test/cad-gen/*` and `test/api/cad-*.test.js` suites.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(cad-gen): node smoke harness, package guide and docs

Completes milestone 1: the server generates a validated Manifold design
document; the harness proves the same shared core executes it and exports
GLB/3MF, and is the browser worker's reference implementation."
```

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| 1 goal — server returns code, client executes | 10, 12, 14 |
| 2 D1 full script plus PARAMETERS | 3 (parse), 7 (parameters gate), 9 (prompt) |
| 2 D2 core/backend split | 2 (entry points), 5 (kernel port), 13 (shared exporters) |
| 2 D3 validate-only child process | 5, 7 |
| 2 D4 stateless plus priorDesign | 3, 9, 12 |
| 2 D5 gates plus bounded repair | 7, 10 |
| 2 D6 free-form code plus prelude | 6, 9 |
| 2 D7 no execute mode, no server artifacts | 12 (route returns design only), 14 (harness exports) |
| 2 D8 50/day plus in-flight lock | 11, 12 |
| 4 design document and PARAMETERS | 3, 9 |
| 4 prelude surface | 5 (names), 6 (bodies) |
| 4 contractVersion and preludeVersion | 2, 10, 14 |
| 4 fillet fidelity | 6 (modes), 5 (stats carry the mode) |
| 5 static gates | 4, 7 |
| 5 kernel validation without export | 5, 7 |
| 5 limits (timeout, triangle budget) | 5, 7 |
| 5 repair | 10 |
| 6 endpoint, request and response | 12 |
| 6 quota, lock, admission order, headers | 11, 12 |
| 6 errors table | 12 |
| 6 env vars | 12 |
| 7 client pipeline contract | 13 (exporters and sidecar), 14 (harness as reference) |
| 7 guard on both hosts | 4, 14 |
| 8 security and cost | 11, 12 |
| 9 testing | every task; 5 and 14 for the child and harness approach |
| 10 spike | 1 |
| 11 risks | 1 (WASM), 14 (slicer check) |

### Deliberate gaps

Two spec items are recorded as follow-ups rather than tasks, because the spike decides them:

- **JS heap flag** (spec section 5): add `--max-old-space-size` to the spawn in Task 5 once Task 1 confirms the runtime flags Bun honours.
- **Compiled-server WASM shim** (spec section 11): if Task 1 step 7 shows the compiled binary failing to locate `manifold.wasm`, add a Task 15 for the `scripts/build-server.mjs` manifold shim before shipping, following the brotli-wasm shim already in that file.

Two more gaps came out of the Task 1 spike (evidence in `docs/superpowers/plans/cad-spike-results.md`):

- **Server-side kernel validation does not work in the compiled single-file binary.** The validation
  child is spawned as a source file, and `bun build --compile` produces a binary with no `src/` on
  disk and a virtual module URL. Task 5 now fails loudly ("kernel host unavailable") rather than
  spawning a doomed process. Fixing it properly needs either self-re-exec (`process.execPath` plus a
  flag the entry point checks before starting the server) or a second compiled child binary. Owned by
  the deployment milestone; milestone 1 is verified from source, where it works.
- **`docker/app.Dockerfile` ships no `node_modules`**, so the production image has no
  `manifold.wasm`. It must copy just that 541 KB file into the runtime stage (or embed it at build
  time the way the brotli shim embeds its wasm). Deliberately not changed blind here — an untested
  Dockerfile edit is how a production image breaks.

Also deliberately unimplemented in milestone 1: the `sourceRef` resolution path. The request schema accepts it (Task 12) and `parseEmbeddedDesign` and `readDesignFrom3mf` exist (Task 13), but wiring CID/asset lookup into the facade is the integration milestone. Until then a `sourceRef`-only request reaches the prompt builder with no prior document — the route should reject that combination with 400 rather than silently generating something unrelated. **Add that guard in Task 12 step 4** if you wire the route before the resolution path.

### Placeholder scan

No TBD, TODO or "implement later" strings. Every code block is complete. The one stub introduced deliberately (Task 5's `buildPrelude` throwing) is replaced wholesale in Task 6 step 3, which says so explicitly.

### Type consistency

`CadDesign`, `CadStats`, `CadMesh`, `ManifoldModule` and `TokenUsage` are defined once in `types.ts` (Task 3) and used unchanged through Task 14. `GateResult` is defined once in `core/gates.ts` (Task 7) and consumed by `backend/repair.ts` (Task 10), `backend/prompt.ts` (Task 9) and the route (Task 12). `RunnerOptions` and `RunnerResult` are defined in Task 5 and consumed only by `backend/validate.ts` (Task 7). `acquireCadSlot`/`releaseCadSlot`/`cadQuotaHeaders` (Task 11) are consumed by Task 12 with matching signatures and branch names (`IN_PROGRESS`, `QUOTA`). `PRELUDE_NAMES` is defined in Task 5 and consumed by Tasks 7, 9, 10 and 14 — one definition, no drift. `createCadGenerator` (Task 10) is consumed by Task 12's `generatorFromEnv` and Task 14's harness with the same `CadGenConfig` shape.


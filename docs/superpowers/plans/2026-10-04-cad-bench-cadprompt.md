# CADPrompt Benchmark Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bun scripts/cad-bench.mjs` runs the 200-sample CADPrompt benchmark through cad-gen's shipped generation loop and writes paper-comparable scores, exact IoU, and a Jev-triaged "where to improve" table.

**Architecture:** One Bun CLI orchestrates small single-purpose modules in `scripts/lib/`. Pure maths lives in `mesh-metrics.mjs`. Manifold is used only in `bench-iou.mjs`. Each sample runs through `bench-sample.mjs`, with the generator, kernel and scorer injected. Jev triage, aggregation and markdown rendering are separate modules. The client repair loop and STL I/O move out of `scripts/cad-eval.mjs`, so both harnesses share one copy.

**Tech Stack:** Bun (runtime + `bun:test`), JS with JSDoc under `checkJs`, `manifold-3d` (already a dependency), cad-gen package source (`packages/cad-gen/src/...`), TypeSafe Jev via the existing `askJev`.

**Spec:** `docs/superpowers/specs/2026-10-04-cad-bench-cadprompt-design.md`

## Global Constraints

- The dataset is pinned to `github.com/Kamel773/CAD_Code_Generation` commit `33dcecd6087ff7b8a4454b1ba4d56504a6364399` and fetched into gitignored `test-results/cadprompt/`. **The repo has no licence: never commit or redistribute CADPrompt data.** Test fixtures are synthetic.
- The run output root is `test-results/cad-bench/run#N/<variant>/`, which is gitignored (`test-results/` is in `.gitignore`).
- Scripts import cad-gen **source** (`../../packages/cad-gen/src/...ts`), never the bare `@arbesk/cad-gen` specifier. Harnesses run under Bun before any build.
- No new npm dependencies. Spreadsheet reading uses the system `unzip`.
- Client loop constants match the browser worker: `CLIENT_REPAIR_ROUNDS = 2`, `MAX_TRIANGLES = 200000`.
- Paper penalty for a failed sample: chamfer = hausdorff = √3, IoGT 0 (and our IoU 0).
- Metrics: 8192 surface samples, seed 1, the same seed for generated and ground truth.
- Jev triage: a sample is triaged when its outcome ≠ `built`, or when `(iou ?? iogt) < 0.5`. A choice answer with confidence < 0.6 is `unsure`.
- Per-sample wall clock is 10 minutes. It is enforced through `generate()`'s `signal` only; the in-process kernel cannot be interrupted.
- After 3 consecutive `provider_error` outcomes the run aborts. `--resume` continues it.
- Tests run with `bun scripts/run-tests.mjs <path>`, one process per file. They need no network and no API keys.
- Code style: JSDoc on every export, `@remarks` for the *why*, and comment density like `scripts/cad-eval.mjs`. `bun run lint` and `bun run typecheck` must stay clean (`tsconfig.json` includes `scripts/**/*` with `checkJs`).

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/stl.mjs` (create) | `readStl` (ASCII or binary), `readBinaryStl`, `writeBinaryStl` |
| `scripts/lib/client-repair.mjs` (create) | `buildWithClientRepair`, `CLIENT_REPAIR_ROUNDS`, `MAX_TRIANGLES` |
| `scripts/cad-eval.mjs` (modify) | uses the two modules above; behaviour unchanged |
| `scripts/lib/mesh-metrics.mjs` (create) | sampling, k-d tree, Horn ICP, chamfer, hausdorff, iogt, `alignAndScore` |
| `scripts/lib/bench-iou.mjs` (create) | `manifoldFrom`, `exactIoU`, `createScorer` |
| `scripts/lib/cadprompt.mjs` (create) | `rewritePrompt`, `parseStrata`, `readStrata`, `loadSamples`, `fetchCadPrompt` |
| `scripts/lib/bench-sample.mjs` (create) | `runSample`, `classifyError`, `PENALTY` |
| `scripts/lib/bench-triage.mjs` (create) | `needsTriage`, `triageState`, `questionsFor`, `readTriage`, `triage` |
| `scripts/lib/bench-summary.mjs` (create) | `medianIqr`, `summarise`, `compareSummaries`, `agreementTemplate`, `parseAgreement`, `renderMarkdown` |
| `scripts/cad-bench.mjs` (create) | CLI: args, pool, resume, abort, atomic writes, summary files |
| `test/cad-gen/helpers/bench-meshes.js` (create) | `box()`, `moved()` test meshes (`helpers/` is skipped by the test runner) |
| `test/cad-gen/bench-*.test.js` (create) | one file per module |
| `packages/cad-gen/AGENTS.md` (modify) | Harnesses section: add cad-bench |

---

### Task 1: Extract STL I/O and the client repair loop from cad-eval

**Files:**
- Create: `scripts/lib/stl.mjs`
- Create: `scripts/lib/client-repair.mjs`
- Modify: `scripts/cad-eval.mjs` (remove `readAsciiStl`, `readBinaryStl`, `MAX_TRIANGLES`, `CLIENT_REPAIR_ROUNDS`, `buildWithClientRepair`; update `main` and `runScenario`)
- Test: `test/cad-gen/bench-stl.test.js`, `test/cad-gen/bench-client-repair.test.js`

**Interfaces:**
- Produces:
  - `readStl(file: string): { positions: Float32Array, indices: Uint32Array }`
  - `writeBinaryStl(file: string, mesh: { positions: ArrayLike<number>, indices: ArrayLike<number> }): void`
  - `buildWithClientRepair(ctx: { generator, kernel, prompt: string, signal?: AbortSignal, onRepair?: (round: number, failure: RoundFailure) => void, onDesign?: (design) => void }, first: CadGenerateResult): Promise<{ run: KernelRunResult | null, design: CadDesign, failures: RoundFailure[], results: CadGenerateResult[] }>`, where `RoundFailure = { gate: string, error: string }` and `gate` is `"kernel"` for a kernel throw, otherwise the failing gate's name
  - `CLIENT_REPAIR_ROUNDS = 2`, `MAX_TRIANGLES = 200000`

- [ ] **Step 1: Write the failing STL test**

`test/cad-gen/bench-stl.test.js`:

```js
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStl, writeBinaryStl } from "../../scripts/lib/stl.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bench-stl-"));

describe("stl", () => {
  it("round-trips a mesh through binary STL as a triangle soup", () => {
    const file = path.join(tmp(), "t.stl");
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    writeBinaryStl(file, mesh);
    const back = readStl(file);
    expect(back.indices.length).toBe(6);
    expect(Array.from(back.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("reads ASCII STL", () => {
    const file = path.join(tmp(), "a.stl");
    fs.writeFileSync(file, [
      "solid t", " facet normal 0 0 1", "  outer loop",
      "   vertex 0 0 0", "   vertex 1.5e+00 0 0", "   vertex 0 -2 0",
      "  endloop", " endfacet", "endsolid t",
    ].join("\n"));
    const mesh = readStl(file);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1.5, 0, 0, 0, -2, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-stl.test.js`
Expected: FAIL, `Cannot find module '../../scripts/lib/stl.mjs'`.

- [ ] **Step 3: Create `scripts/lib/stl.mjs`**

Move the two readers out of `scripts/cad-eval.mjs` (lines ~296–356), rename `readAsciiStl` to `readStl`, export both, and add the writer:

```js
/**
 * STL reading and writing for the CAD harnesses.
 * @remarks Moved out of scripts/cad-eval.mjs so the benchmark reads ground
 *   truth with the same code the eval renders references with.
 */
import fs from "node:fs";

/** @typedef {{ positions: Float32Array, indices: Uint32Array }} Mesh */

/**
 * Reads an STL - ASCII or binary - into a triangle-soup mesh.
 * @remarks Ground truth for comparison has to go through the SAME code as our
 *   own output, or the comparison is of two different readings rather than of
 *   two different parts. ASCII is a facet normal line, an outer loop, three
 *   vertex lines, an endloop; a binary file's first five bytes are not "solid".
 * @param {string} file Path to an .stl.
 * @returns {Mesh} Positions and triangle indices.
 */
export function readStl(file) {
  const buf = fs.readFileSync(file);
  if (!/^\s*solid/.test(buf.subarray(0, 5).toString("utf8"))) {
    return readBinaryStl(buf);
  }
  const text = buf.toString("utf8");
  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const indices = [];
  for (const line of text.split("\n")) {
    const m = /^\s*vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/.exec(line);
    if (!m) continue;
    positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
    if (positions.length % 9 === 0) {
      const v = positions.length / 3 - 3;
      indices.push(v, v + 1, v + 2);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Reads a binary STL into a mesh.
 * @remarks 80-byte header, a triangle count, then 50 bytes each: a normal the
 *   renderer recomputes anyway, three vertices, and a trailing attribute.
 * @param {Buffer} buf The whole file.
 * @returns {Mesh} Positions and triangle indices.
 */
export function readBinaryStl(buf) {
  const count = buf.readUInt32LE(80);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      positions[o] = buf.readFloatLE(at + v * 12);
      positions[o + 1] = buf.readFloatLE(at + v * 12 + 4);
      positions[o + 2] = buf.readFloatLE(at + v * 12 + 8);
      indices[t * 3 + v] = t * 3 + v;
    }
  }
  return { positions, indices };
}

/**
 * Writes a mesh as binary STL.
 * @remarks Normals are left zero: every reader, ours included, recomputes them.
 *   The header must not start with "solid" or readers take it for ASCII.
 * @param {string} file Destination path.
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} mesh
 */
export function writeBinaryStl(file, mesh) {
  const count = mesh.indices.length / 3;
  const buf = Buffer.alloc(84 + count * 50);
  buf.write("arbesk cad-bench", 0, "ascii");
  buf.writeUInt32LE(count, 80);
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const i = mesh.indices[t * 3 + v] * 3;
      for (let a = 0; a < 3; a++) buf.writeFloatLE(mesh.positions[i + a], at + v * 12 + a * 4);
    }
  }
  fs.writeFileSync(file, buf);
}
```

- [ ] **Step 4: Run the STL test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-stl.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing client-repair test**

`test/cad-gen/bench-client-repair.test.js`:

```js
import { describe, expect, it } from "bun:test";
import { CLIENT_REPAIR_ROUNDS, buildWithClientRepair } from "../../scripts/lib/client-repair.mjs";

/** Stats that pass every kernel gate. */
const GOOD = {
  triangles: 12, vertices: 8, volumeMm3: 1,
  bboxMm: { min: [0, 0, 0], max: [1, 1, 1] }, bodies: { count: 1, boxes: [] },
};

const design = (code) => ({ code, parameters: {}, summary: "a box" });
const first = () => ({ design: design("return cube(1)"), diagnostics: { selection: {} } });

/** A kernel replaying outcomes: stats objects are returned, Errors thrown. */
function kernelOf(outcomes) {
  let i = 0;
  return {
    run() {
      const o = outcomes[Math.min(i++, outcomes.length - 1)];
      if (o instanceof Error) throw o;
      return { mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) }, stats: o };
    },
  };
}

/** A generator that records its inputs and returns numbered designs. */
function generatorOf() {
  /** @type {any[]} */
  const calls = [];
  return {
    calls,
    async generate(/** @type {any} */ input) {
      calls.push(input);
      return { design: design("return cube(" + (calls.length + 1) + ")"), diagnostics: { tokens: { prompt: 10, completion: 5 } } };
    },
  };
}

describe("buildWithClientRepair", () => {
  it("returns the first build when it passes the gates", async () => {
    const generator = generatorOf();
    const out = await buildWithClientRepair({ generator, kernel: kernelOf([GOOD]), prompt: "p" }, first());
    expect(out.run?.stats).toEqual(GOOD);
    expect(out.failures).toEqual([]);
    expect(out.results).toEqual([]);
    expect(generator.calls).toHaveLength(0);
  });

  it("repairs a kernel throw, sending the kernel's own error back", async () => {
    const generator = generatorOf();
    const repairs = [];
    const out = await buildWithClientRepair({
      generator, kernel: kernelOf([new Error("cube: size must be positive"), GOOD]), prompt: "p",
      onRepair: (round, failure) => repairs.push([round, failure.gate]),
    }, first());
    expect(out.run?.stats).toEqual(GOOD);
    expect(out.failures).toEqual([{ gate: "kernel", error: "cube: size must be positive" }]);
    expect(generator.calls[0].priorDesign.code).toBe("return cube(1)");
    expect(generator.calls[0].failures).toEqual([{ gate: "kernel", error: "cube: size must be positive" }]);
    expect(out.design.code).toBe("return cube(2)");
    expect(out.results).toHaveLength(1);
    expect(repairs).toEqual([[1, "kernel"]]);
  });

  it("names the failing gate", async () => {
    const out = await buildWithClientRepair(
      { generator: generatorOf(), kernel: kernelOf([{ ...GOOD, triangles: 0 }, GOOD]), prompt: "p" }, first());
    expect(out.failures[0].gate).toBe("nonempty");
    expect(out.failures[0].error.startsWith("nonempty: ")).toBe(true);
  });

  it("gives up after CLIENT_REPAIR_ROUNDS repairs", async () => {
    const generator = generatorOf();
    const out = await buildWithClientRepair(
      { generator, kernel: kernelOf([new Error("boom")]), prompt: "p" }, first());
    expect(out.run).toBeNull();
    expect(out.failures).toHaveLength(CLIENT_REPAIR_ROUNDS + 1);
    expect(generator.calls).toHaveLength(CLIENT_REPAIR_ROUNDS);
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-client-repair.test.js`
Expected: FAIL, module not found.

- [ ] **Step 7: Create `scripts/lib/client-repair.mjs`**

```js
/**
 * The browser worker's build loop, for the offline harnesses.
 * @remarks Moved out of scripts/cad-eval.mjs so cad-eval and cad-bench run the
 *   SAME client loop. The server never runs the kernel, so a design that throws
 *   in it - a helper refusing its arguments, say - can only be repaired by this
 *   round trip. Without it a harness reports failures a real client would fix.
 */
import { bodyAllowance, bodyFloor, evaluateKernelGates } from "../../packages/cad-gen/src/core/gates.ts";

/** The delivery triangle budget the browser worker enforces. */
export const MAX_TRIANGLES = 200000;

/** Client repair rounds after the first build, as the browser worker spends. */
export const CLIENT_REPAIR_ROUNDS = 2;

/** One failed build: `gate` is "kernel" when the script threw. @typedef {{ gate: string, error: string }} RoundFailure */

/**
 * Builds a design the way the browser worker does: run the kernel, and on a
 * failure send it back as a repair turn carrying the kernel's own error.
 * @param {{ generator: any, kernel: any, prompt: string, signal?: AbortSignal,
 *   onRepair?: (round: number, failure: RoundFailure) => void,
 *   onDesign?: (design: any) => void }} ctx Run context.
 * @param {any} first The first generation (a CadGenerateResult).
 * @returns {Promise<{ run: any, design: any, failures: RoundFailure[], results: any[] }>}
 *   `run` is null when every round failed; `failures` lists each failed build
 *   in order; `results` holds the repair generations, for token accounting.
 */
export async function buildWithClientRepair(ctx, first) {
  let design = first.design;
  // Jev's judgement from the FIRST call: a repair round skips Jev, and whether
  // the request wants separate pieces does not change between rounds.
  const { expectedPieces: pieces, piecesSeparate } = first.diagnostics.selection;
  const minBodies = bodyFloor(pieces, piecesSeparate);
  /** @type {RoundFailure[]} */
  const failures = [];
  /** @type {any[]} */
  const results = [];
  for (let round = 0; ; round++) {
    /** @type {RoundFailure} */
    let failure;
    try {
      const run = ctx.kernel.run(design);
      const maxBodies = bodyAllowance(design.code, pieces);
      const failed = evaluateKernelGates(run.stats, { maxTriangles: MAX_TRIANGLES, maxBodies, minBodies })
        .find((g) => !g.ok);
      if (!failed) return { run, design, failures, results };
      failure = { gate: failed.gate, error: failed.gate + ": " + failed.error };
    } catch (e) {
      failure = { gate: "kernel", error: e instanceof Error ? e.message : String(e) };
    }
    failures.push(failure);
    if (round >= CLIENT_REPAIR_ROUNDS) return { run: null, design, failures, results };
    ctx.onRepair?.(round + 1, failure);
    const repaired = await ctx.generator.generate({
      prompt: ctx.prompt, priorDesign: design,
      failures: [{ gate: "kernel", error: failure.error }],
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    results.push(repaired);
    design = repaired.design;
    ctx.onDesign?.(design);
  }
}
```

- [ ] **Step 8: Run the client-repair test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-client-repair.test.js`
Expected: PASS (4 tests).

- [ ] **Step 9: Switch `scripts/cad-eval.mjs` to the shared modules**

1. Delete the `readAsciiStl` and `readBinaryStl` functions and their JSDoc (the block under `// ... STL` around lines 296–356). Also delete `MAX_TRIANGLES`, `CLIENT_REPAIR_ROUNDS` and the whole `buildWithClientRepair` function with its JSDoc (around lines 559–616).
2. Replace the gates import line with these imports:

```js
import { bodyFloor } from "../packages/cad-gen/src/core/gates.ts";
import { buildWithClientRepair } from "./lib/client-repair.mjs";
import { readStl } from "./lib/stl.mjs";
```

3. In `main`, change `const mesh = readAsciiStl(rest[1]);` to `const mesh = readStl(rest[1]);`.
4. In `runScenario`, replace `const built = await buildWithClientRepair(ctx, result);` and the `if (!built) return;` after it with the block below. The "expected pieces" log moves here from the old helper:

```js
    const { expectedPieces: pieces, piecesSeparate } = result.diagnostics.selection;
    if (pieces !== undefined) {
      console.log("expected pieces " + (pieces >= 5 ? "5+" : pieces) +
        (piecesSeparate === undefined ? "" : "  separate " + piecesSeparate.toFixed(2)) +
        "  min bodies " + bodyFloor(pieces, piecesSeparate));
    }
    const built = await buildWithClientRepair({
      generator, kernel: ctx.kernel, prompt: scenario.prompt,
      onRepair: (round, failure) => console.log("client repair " + round + ": " + failure.error.slice(0, 160)),
      onDesign: (design) => fs.writeFileSync(path.join(outDir, stem + ".json"), JSON.stringify(design, null, 2)),
    }, result);
    if (!built.run) {
      const last = built.failures[built.failures.length - 1];
      console.log("FAILED after " + (built.failures.length - 1) + " client repair(s): " + last.error);
      return;
    }
```

The lines that follow (`const { mesh, stats } = built.run; result.design = built.design;`) stay as they are.

5. Update the `runScenario` JSDoc `ctx` type if it mentions the removed helper. Remove any import that is now unused (lint will name it).

- [ ] **Step 10: Verify nothing else regressed**

Run: `bun scripts/run-tests.mjs test/cad-gen/ && bun run lint && bun run typecheck`
Expected: all cad-gen suites PASS, and lint and typecheck report no errors.

Run: `bun scripts/cad-eval.mjs --stl "$(ls test-results/reference/*.stl 2>/dev/null | head -1)"` if a reference STL exists. Otherwise skip, because it needs no key and only exercises `readStl`.
Expected: prints `reference …`, `triangles`, `size mm`, `png`.

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/stl.mjs scripts/lib/client-repair.mjs scripts/cad-eval.mjs \
  test/cad-gen/bench-stl.test.js test/cad-gen/bench-client-repair.test.js
git commit -m "refactor(cad-eval): extract STL I/O and client repair loop into scripts/lib

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Geometry metrics (`mesh-metrics.mjs`)

**Files:**
- Create: `scripts/lib/mesh-metrics.mjs`
- Create: `test/cad-gen/helpers/bench-meshes.js`
- Test: `test/cad-gen/bench-metrics.test.js`

**Interfaces:**
- Produces (all pure, flat xyz arrays):
  - `PENALTY_DISTANCE = Math.sqrt(3)`
  - `boundsOf(points): { min: number[], max: number[] }`
  - `boxNormaliser(box): Normaliser`, `momentNormaliser(points): Normaliser`, where `Normaliser = { center: number[], scale: number }`
  - `applySteps(points, steps: (Normaliser | Rigid)[]): Float64Array`, where `Rigid = { R: number[9] /* row-major */, t: number[3] }`
  - `samplePoints(mesh, n, seed): Float64Array`
  - `class KdTree { constructor(points: Float64Array); nearest(x, y, z): [index, squaredDistance] }`
  - `bestRigid(P, Q): Rigid`, `icp(source, target, { iterations?, tolerance? }): Rigid`
  - `chamfer(P, Q): number`, `hausdorff(P, Q): number`, `iogt(generatedBox, truthBox): number`
  - `alignAndScore(generated: Mesh, truth: Mesh, { samples = 8192, seed = 1 }?): { metrics: { chamfer, hausdorff, iogt }, generatedSteps: Step[], truthSteps: Step[] }`

This code was prototyped and its tests passed (9/9) before the plan was written. All 200 CADPrompt ground truths scored against a ×100 copy of themselves at about 80 ms each.

- [ ] **Step 1: Create the shared test meshes**

`test/cad-gen/helpers/bench-meshes.js`:

```js
/**
 * Closed test meshes for the benchmark suites.
 * @remarks Winding is outward (verified: Manifold reports volume +1 for a unit
 *   box), so the same helper serves the pure metrics and the Manifold IoU tests.
 */

/**
 * An axis-aligned box as a closed 12-triangle mesh.
 * @param {number[]} size [x, y, z] side lengths.
 * @param {number[]} [at] Minimum corner.
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function box(size, at = [0, 0, 0]) {
  const positions = [];
  for (let i = 0; i < 8; i++) {
    positions.push(at[0] + (i & 1 ? size[0] : 0), at[1] + (i & 2 ? size[1] : 0), at[2] + (i & 4 ? size[2] : 0));
  }
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const indices = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Rotates a mesh about Z by deg, then scales and translates it.
 * @param {{ positions: Float32Array, indices: Uint32Array }} mesh
 * @param {number} deg @param {number} scale @param {number[]} offset
 */
export function moved(mesh, deg, scale, offset) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const p = Float32Array.from(mesh.positions);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    p[i] = (c * x - s * y) * scale + offset[0];
    p[i + 1] = (s * x + c * y) * scale + offset[1];
    p[i + 2] = p[i + 2] * scale + offset[2];
  }
  return { positions: p, indices: mesh.indices };
}
```

- [ ] **Step 2: Write the failing test**

`test/cad-gen/bench-metrics.test.js`:

```js
import { describe, expect, it } from "bun:test";
import {
  KdTree, alignAndScore, applySteps, bestRigid, boundsOf, chamfer, hausdorff, iogt, samplePoints,
} from "../../scripts/lib/mesh-metrics.mjs";
import { box, moved } from "./helpers/bench-meshes.js";

describe("samplePoints", () => {
  it("is reproducible for a seed and lies on the surface", () => {
    const a = samplePoints(box([1, 1, 1]), 500, 7);
    expect(samplePoints(box([1, 1, 1]), 500, 7)).toEqual(a);
    const { min, max } = boundsOf(a);
    expect(min.every((v) => v >= -1e-9)).toBe(true);
    expect(max.every((v) => v <= 1 + 1e-9)).toBe(true);
  });

  it("weights by area: a 4x1x1 box puts ~11% of samples on its end faces", () => {
    const pts = samplePoints(box([4, 1, 1]), 4000, 3);
    let ends = 0;
    for (let i = 0; i < pts.length; i += 3) if (pts[i] < 1e-9 || pts[i] > 4 - 1e-9) ends++;
    expect(ends / 4000).toBeGreaterThan(0.08);
    expect(ends / 4000).toBeLessThan(0.14);
  });
});

describe("KdTree", () => {
  it("agrees with brute force", () => {
    const pts = samplePoints(box([3, 2, 1]), 2000, 11);
    const tree = new KdTree(pts);
    const queries = samplePoints(box([4, 4, 4], [-0.5, -1, -1.5]), 200, 12);
    for (let q = 0; q < queries.length; q += 3) {
      let best = Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const d = (pts[i] - queries[q]) ** 2 + (pts[i + 1] - queries[q + 1]) ** 2 + (pts[i + 2] - queries[q + 2]) ** 2;
        if (d < best) best = d;
      }
      expect(tree.nearest(queries[q], queries[q + 1], queries[q + 2])[1]).toBeCloseTo(best, 12);
    }
  });
});

describe("bestRigid", () => {
  it("recovers a known rotation and translation exactly", () => {
    const P = samplePoints(box([2, 1, 0.5]), 300, 5);
    const r = 0.7, c = Math.cos(r), s = Math.sin(r);
    const truth = { R: [c, 0, s, 0, 1, 0, -s, 0, c], t: [3, -2, 1] };
    const fit = bestRigid(P, applySteps(P, [truth]));
    fit.R.forEach((v, i) => expect(v).toBeCloseTo(truth.R[i], 9));
    fit.t.forEach((v, i) => expect(v).toBeCloseTo(truth.t[i], 9));
  });
});

describe("chamfer / hausdorff / iogt", () => {
  it("are 0, 0 and 1 for identical meshes", () => {
    const { metrics } = alignAndScore(box([2, 1, 0.5]), box([2, 1, 0.5]), { samples: 2048 });
    expect(metrics.chamfer).toBe(0);
    expect(metrics.hausdorff).toBe(0);
    expect(metrics.iogt).toBeCloseTo(1, 12);
  });

  it("match hand-computed values (paper Eq. 8 and 9)", () => {
    const P = new Float64Array([0, 0, 0, 1, 0, 0]);
    const Q = new Float64Array([0, 0, 0, 3, 0, 0]);
    // P->Q nearest: 0, 1 (mean 0.5). Q->P nearest: 0, 2 (mean 1). 0.5*0.5 + 0.5*1.
    expect(chamfer(P, Q)).toBeCloseTo(0.75, 12);
    expect(hausdorff(P, Q)).toBeCloseTo(2, 12);
  });

  it("iogt is the bbox overlap over the truth bbox (paper Eq. 10)", () => {
    expect(iogt({ min: [0.5, 0, 0], max: [1.5, 1, 1] }, { min: [0, 0, 0], max: [1, 1, 1] })).toBeCloseTo(0.5, 12);
    expect(iogt({ min: [2, 2, 2], max: [3, 3, 3] }, { min: [0, 0, 0], max: [1, 1, 1] })).toBe(0);
  });
});

describe("alignAndScore", () => {
  it("recovers a box rotated 15 degrees, scaled x100 and moved", () => {
    const truth = box([2, 1, 0.5]);
    const { metrics } = alignAndScore(moved(truth, 15, 100, [40, -25, 7]), truth);
    expect(metrics.chamfer).toBeLessThan(0.02);
    expect(metrics.iogt).toBeGreaterThan(0.97);
  });

  it("scores a cube against a flat slab as far apart (negative control)", () => {
    const { metrics } = alignAndScore(box([1, 1, 1]), box([1, 1, 0.1]));
    expect(metrics.chamfer).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-metrics.test.js`
Expected: FAIL, module not found.

- [ ] **Step 4: Create `scripts/lib/mesh-metrics.mjs`**

```js
/**
 * Geometry metrics for the CADPrompt benchmark. Pure maths: no I/O, no Manifold.
 * @remarks Reproduces section 5 of Alrashedy et al., ICLR 2025 ("Generating CAD
 *   Code with Vision-Language Models for 3D Designs"): ICP alignment, unit-cube
 *   normalisation, Point Cloud (Chamfer) distance, Hausdorff distance and
 *   bounding-box IoGT. One deliberate deviation: both clouds are first
 *   normalised by centroid and RMS radius, because our parts are ~100x the
 *   ground truth and ICP from raw coordinates cannot converge. That scale is
 *   rotation-invariant, so a rotated copy of a part gets the same scale; a
 *   bounding-box scale would not. See the spec's deviations list.
 */

/** @typedef {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} Mesh */
/** @typedef {{ min: number[], max: number[] }} Box */
/** Maps p to (p - center) * scale. @typedef {{ center: number[], scale: number }} Normaliser */
/** Maps p to R p + t, R row-major 3x3. @typedef {{ R: number[], t: number[] }} Rigid */
/** @typedef {Normaliser | Rigid} Step */

/** Distance a failed sample scores: the diagonal of the unit cube (paper section 5). */
export const PENALTY_DISTANCE = Math.sqrt(3);

/**
 * Axis-aligned bounds of a flat xyz array.
 * @param {ArrayLike<number>} points
 * @returns {Box}
 */
export function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = points[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Normaliser that puts a box in the unit cube, centred, longest side 1.
 * @param {Box} box
 * @returns {Normaliser}
 */
export function boxNormaliser(box) {
  const center = [0, 1, 2].map((a) => (box.min[a] + box.max[a]) / 2);
  const extent = Math.max(...[0, 1, 2].map((a) => box.max[a] - box.min[a]));
  return { center, scale: extent > 0 ? 1 / extent : 1 };
}

/**
 * Rotation-invariant normaliser: centroid to the origin, RMS radius to 1.
 * @param {ArrayLike<number>} points Surface samples (not vertices: vertex
 *   density follows tessellation, not area).
 * @returns {Normaliser}
 */
export function momentNormaliser(points) {
  const n = points.length / 3;
  const center = [0, 0, 0];
  for (let i = 0; i < points.length; i += 3) for (let a = 0; a < 3; a++) center[a] += points[i + a] / n;
  let sum = 0;
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) sum += (points[i + a] - center[a]) ** 2;
  }
  const rms = Math.sqrt(sum / n);
  return { center, scale: rms > 0 ? 1 / rms : 1 };
}

/**
 * Applies a sequence of normalisers and rigid motions to a flat xyz array.
 * @param {ArrayLike<number>} points
 * @param {Step[]} steps Applied in order.
 * @returns {Float64Array} A new array.
 */
export function applySteps(points, steps) {
  const out = Float64Array.from(points);
  for (const step of steps) {
    if ("R" in step) {
      const { R, t } = step;
      for (let i = 0; i < out.length; i += 3) {
        const x = out[i], y = out[i + 1], z = out[i + 2];
        out[i] = R[0] * x + R[1] * y + R[2] * z + t[0];
        out[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
        out[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
      }
    } else {
      const { center, scale } = step;
      for (let i = 0; i < out.length; i += 3) {
        for (let a = 0; a < 3; a++) out[i + a] = (out[i + a] - center[a]) * scale;
      }
    }
  }
  return out;
}

/**
 * mulberry32: a small seeded PRNG, so a run's samples are reproducible.
 * @param {number} seed
 * @returns {() => number} Uniform in [0, 1).
 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Area-weighted uniform samples on a mesh surface.
 * @param {Mesh} mesh
 * @param {number} n Sample count.
 * @param {number} seed PRNG seed.
 * @returns {Float64Array} 3n coordinates.
 * @throws {Error} When the mesh has no surface area.
 */
export function samplePoints(mesh, n, seed) {
  const { positions: p, indices: ix } = mesh;
  const triangles = ix.length / 3;
  const cumulative = new Float64Array(triangles);
  let total = 0;
  for (let t = 0; t < triangles; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    cumulative[t] = total;
  }
  if (!(total > 0)) throw new Error("mesh has no surface area");
  const rand = prng(seed);
  const out = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const r = rand() * total;
    let lo = 0, hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1; else hi = mid;
    }
    const a = ix[lo * 3] * 3, b = ix[lo * 3 + 1] * 3, c = ix[lo * 3 + 2] * 3;
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    for (let ax = 0; ax < 3; ax++) {
      out[k * 3 + ax] = p[a + ax] + u * (p[b + ax] - p[a + ax]) + v * (p[c + ax] - p[a + ax]);
    }
  }
  return out;
}

/** A static 3-d tree over a flat xyz array, for nearest-neighbour queries. */
export class KdTree {
  /** @param {Float64Array} points */
  constructor(points) {
    this.points = points;
    this.order = Uint32Array.from({ length: points.length / 3 }, (_, i) => i);
    this.#build(0, this.order.length, 0);
  }

  /**
   * Median-splits order[lo, hi) on axis depth % 3, recursively.
   * @param {number} lo @param {number} hi @param {number} depth
   */
  #build(lo, hi, depth) {
    if (hi - lo <= 1) return;
    const axis = depth % 3, p = this.points;
    const sorted = Array.from(this.order.subarray(lo, hi)).sort((i, j) => p[i * 3 + axis] - p[j * 3 + axis]);
    this.order.set(sorted, lo);
    const mid = (lo + hi) >> 1;
    this.#build(lo, mid, depth + 1);
    this.#build(mid + 1, hi, depth + 1);
  }

  /**
   * Nearest stored point to (x, y, z).
   * @param {number} x @param {number} y @param {number} z
   * @returns {[number, number]} [point index, squared distance]
   */
  nearest(x, y, z) {
    const p = this.points, order = this.order, q = [x, y, z];
    let best = Infinity, bestIndex = -1;
    /** @param {number} lo @param {number} hi @param {number} depth */
    const visit = (lo, hi, depth) => {
      if (lo >= hi) return;
      const mid = (lo + hi) >> 1, i = order[mid], axis = depth % 3;
      const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bestIndex = i; }
      const diff = q[axis] - p[i * 3 + axis];
      if (diff < 0) {
        visit(lo, mid, depth + 1);
        if (diff * diff < best) visit(mid + 1, hi, depth + 1);
      } else {
        visit(mid + 1, hi, depth + 1);
        if (diff * diff < best) visit(lo, mid, depth + 1);
      }
    };
    visit(0, order.length, 0);
    return [bestIndex, best];
  }
}

/**
 * Eigen-decomposition of a symmetric 4x4 matrix by cyclic Jacobi rotations.
 * @param {number[][]} m Symmetric 4x4; not modified.
 * @returns {{ values: number[], vectors: number[][] }} vectors[k][i] is
 *   component k of eigenvector i.
 */
function jacobiEigen4(m) {
  const a = m.map((row) => row.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const kp = a[k][p], kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < 4; k++) {
          const pk = a[p][k], qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < 4; k++) {
          const kp = v[k][p], kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
  }
  return { values: [0, 1, 2, 3].map((i) => a[i][i]), vectors: v };
}

/**
 * Least-squares rigid motion taking P onto Q (pairs by index), by Horn's
 * closed-form quaternion method.
 * @remarks Horn rather than SVD/Kabsch because a 4x4 symmetric eigenproblem
 *   is a few dozen lines of Jacobi, where a 3x3 SVD with reflection handling
 *   is not; the quaternion is always a proper rotation.
 * @param {Float64Array} P @param {Float64Array} Q Same length.
 * @returns {Rigid}
 */
export function bestRigid(P, Q) {
  const n = P.length / 3;
  const cp = [0, 0, 0], cq = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) { cp[a] += P[i + a] / n; cq[a] += Q[i + a] / n; }
  }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) S[a][b] += (P[i + a] - cp[a]) * (Q[i + b] - cq[b]);
    }
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = jacobiEigen4(N);
  const top = values.indexOf(Math.max(...values));
  const [w, x, y, z] = [0, 1, 2, 3].map((k) => vectors[k][top]);
  const R = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
  const t = [0, 1, 2].map((r) => cq[r] - (R[r * 3] * cp[0] + R[r * 3 + 1] * cp[1] + R[r * 3 + 2] * cp[2]));
  return { R, t };
}

/**
 * Point-to-point ICP from identity, as the paper does.
 * @param {Float64Array} source Moved onto target.
 * @param {Float64Array} target
 * @param {{ iterations?: number, tolerance?: number }} [options]
 * @returns {Rigid} The accumulated motion taking source onto target.
 */
export function icp(source, target, { iterations = 50, tolerance = 1e-9 } = {}) {
  const tree = new KdTree(target);
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], t = [0, 0, 0];
  let current = Float64Array.from(source);
  let previous = Infinity;
  for (let it = 0; it < iterations; it++) {
    const matched = new Float64Array(current.length);
    let error = 0;
    for (let i = 0; i < current.length; i += 3) {
      const [j, d] = tree.nearest(current[i], current[i + 1], current[i + 2]);
      matched[i] = target[j * 3]; matched[i + 1] = target[j * 3 + 1]; matched[i + 2] = target[j * 3 + 2];
      error += d;
    }
    error /= current.length / 3;
    if (previous - error < tolerance) break;
    previous = error;
    const step = bestRigid(current, matched);
    current = applySteps(current, [step]);
    // Compose: the new total is step after (R, t).
    const Rs = step.R;
    R = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) =>
      Rs[r * 3] * R[c] + Rs[r * 3 + 1] * R[3 + c] + Rs[r * 3 + 2] * R[6 + c]));
    t = [0, 1, 2].map((r) => Rs[r * 3] * t[0] + Rs[r * 3 + 1] * t[1] + Rs[r * 3 + 2] * t[2] + step.t[r]);
  }
  return { R, t };
}

/**
 * Nearest-neighbour distances from every point of A to the cloud in tree.
 * @param {Float64Array} A @param {KdTree} tree
 * @returns {Float64Array}
 */
function distancesTo(A, tree) {
  const out = new Float64Array(A.length / 3);
  for (let i = 0; i < A.length; i += 3) out[i / 3] = Math.sqrt(tree.nearest(A[i], A[i + 1], A[i + 2])[1]);
  return out;
}

/**
 * Point Cloud distance, paper Eq. 8: the mean of both directed mean
 * nearest-neighbour distances.
 * @param {Float64Array} P @param {Float64Array} Q
 * @returns {number}
 */
export function chamfer(P, Q) {
  const mean = (/** @type {Float64Array} */ d) => d.reduce((s, x) => s + x, 0) / d.length;
  return 0.5 * mean(distancesTo(P, new KdTree(Q))) + 0.5 * mean(distancesTo(Q, new KdTree(P)));
}

/**
 * Hausdorff distance, paper Eq. 9.
 * @param {Float64Array} P @param {Float64Array} Q
 * @returns {number}
 */
export function hausdorff(P, Q) {
  const max = (/** @type {Float64Array} */ d) => d.reduce((m, x) => Math.max(m, x), 0);
  return Math.max(max(distancesTo(P, new KdTree(Q))), max(distancesTo(Q, new KdTree(P))));
}

/**
 * IoGT, paper Eq. 10, computed as the paper does: on bounding boxes.
 * @param {Box} generated @param {Box} truth
 * @returns {number} |gen ∩ truth| / |truth|
 */
export function iogt(generated, truth) {
  let inter = 1, vol = 1;
  for (let a = 0; a < 3; a++) {
    inter *= Math.max(0, Math.min(generated.max[a], truth.max[a]) - Math.max(generated.min[a], truth.min[a]));
    vol *= truth.max[a] - truth.min[a];
  }
  return vol > 0 ? inter / vol : 0;
}

/**
 * The whole protocol: sample, normalise, align, normalise, measure.
 * @param {Mesh} generated
 * @param {Mesh} truth
 * @param {{ samples?: number, seed?: number }} [options]
 * @returns {{ metrics: { chamfer: number, hausdorff: number, iogt: number },
 *   generatedSteps: Step[], truthSteps: Step[] }} The steps map each mesh's
 *   vertices into the shared frame the metrics were taken in; exact IoU
 *   (bench-iou.mjs) applies them so it measures the same alignment.
 */
export function alignAndScore(generated, truth, { samples = 8192, seed = 1 } = {}) {
  const rawP = samplePoints(generated, samples, seed);
  const rawQ = samplePoints(truth, samples, seed);
  const genPre = momentNormaliser(rawP);
  const truthPre = momentNormaliser(rawQ);
  const rigid = icp(applySteps(rawP, [genPre]), applySteps(rawQ, [truthPre]));
  const genPost = boxNormaliser(boundsOf(applySteps(generated.positions, [genPre, rigid])));
  const truthPost = boxNormaliser(boundsOf(applySteps(truth.positions, [truthPre])));
  const generatedSteps = [genPre, rigid, genPost];
  const truthSteps = [truthPre, truthPost];
  const P = applySteps(rawP, generatedSteps);
  const Q = applySteps(rawQ, truthSteps);
  return {
    metrics: {
      chamfer: chamfer(P, Q),
      hausdorff: hausdorff(P, Q),
      iogt: iogt(boundsOf(applySteps(generated.positions, generatedSteps)),
        boundsOf(applySteps(truth.positions, truthSteps))),
    },
    generatedSteps,
    truthSteps,
  };
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-metrics.test.js`
Expected: PASS (9 tests, about 4 s).

- [ ] **Step 6: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors. If `checkJs` flags the `"R" in step` narrowing, annotate `/** @type {Rigid} */` on the destructure, or cast `step` the same way.

```bash
git add scripts/lib/mesh-metrics.mjs test/cad-gen/helpers/bench-meshes.js test/cad-gen/bench-metrics.test.js
git commit -m "feat(cad-bench): point-cloud metrics, ICP and IoGT per the CADPrompt protocol

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Exact IoU and the scorer (`bench-iou.mjs`)

**Files:**
- Create: `scripts/lib/bench-iou.mjs`
- Test: `test/cad-gen/bench-iou.test.js`

**Interfaces:**
- Consumes: `applySteps`, `alignAndScore` (Task 2); `readStl` (Task 1)
- Produces:
  - `manifoldFrom(module, mesh): Manifold` (the caller must `.delete()` it; throws `Error("Not manifold")`)
  - `exactIoU(module, generated: Mesh, truth: Mesh, frame: { generatedSteps, truthSteps }): { iou: number | null, reason: string | null }`
  - `createScorer(module, readTruth = readStl): (mesh: Mesh, truthPath: string) => { chamfer, hausdorff, iogt, iou, iouReason }`

Verified before planning: under `bun test`, manifold-3d loads in about 20 ms; `Mesh.merge()` welds a triangle soup; a non-manifold mesh makes `new Manifold()` throw `Error("Not manifold")`; and all 200 CADPrompt ground-truth STLs are accepted after `merge()`.

- [ ] **Step 1: Write the failing test**

`test/cad-gen/bench-iou.test.js`:

```js
import { beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "manifold-3d";
import { createScorer, exactIoU } from "../../scripts/lib/bench-iou.mjs";
import { alignAndScore } from "../../scripts/lib/mesh-metrics.mjs";
import { writeBinaryStl } from "../../scripts/lib/stl.mjs";
import { box, moved } from "./helpers/bench-meshes.js";

const WASM_DIR = path.resolve(import.meta.dirname, "..", "..", "node_modules", "manifold-3d");
/** @type {any} */
let module;
const IDENTITY = { generatedSteps: [], truthSteps: [] };

beforeAll(async () => {
  module = await Module(/** @type {any} */ ({ locateFile: (/** @type {string} */ f) => path.join(WASM_DIR, f) }));
  module.setup();
});

describe("exactIoU", () => {
  it("is 1 for identical solids", () => {
    expect(exactIoU(module, box([1, 1, 1]), box([1, 1, 1]), IDENTITY).iou).toBeCloseTo(1, 9);
  });

  it("is 1/3 for unit cubes offset by half a side", () => {
    const out = exactIoU(module, box([1, 1, 1]), box([1, 1, 1], [0.5, 0, 0]), IDENTITY);
    expect(out.iou).toBeCloseTo(1 / 3, 9);
    expect(out.reason).toBeNull();
  });

  it("returns null with a reason for a non-manifold mesh", () => {
    const sheet = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    const out = exactIoU(module, sheet, box([1, 1, 1]), IDENTITY);
    expect(out.iou).toBeNull();
    expect(out.reason).toContain("generated not manifold");
  });

  it("measures in the frame alignAndScore found", () => {
    const truth = box([2, 1, 0.5]);
    const generated = moved(truth, 15, 100, [40, -25, 7]);
    const frame = alignAndScore(generated, truth);
    expect(exactIoU(module, generated, truth, frame).iou).toBeGreaterThan(0.95);
  });
});

describe("createScorer", () => {
  it("scores a mesh against a ground-truth STL on disk", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bench-iou-")), "gt.stl");
    writeBinaryStl(file, box([2, 1, 0.5]));
    const metrics = createScorer(module)(moved(box([2, 1, 0.5]), 0, 100, [0, 0, 0]), file);
    expect(metrics.chamfer).toBeLessThan(1e-6);
    expect(metrics.iogt).toBeCloseTo(1, 6);
    expect(metrics.iou).toBeCloseTo(1, 6);
    expect(metrics.iouReason).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-iou.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `scripts/lib/bench-iou.mjs`**

```js
/**
 * Exact volumetric IoU through Manifold, and the per-sample scorer.
 * @remarks Our addition to the paper's metrics. The paper's IoGT is a
 *   bounding-box ratio, so two parts with the same box and different holes
 *   score alike; Manifold's booleans are exact, so intersect / union volume
 *   measures the solids themselves. Measured in the frame alignAndScore found,
 *   so IoU and the paper metrics describe the same alignment.
 */
import { alignAndScore, applySteps } from "./mesh-metrics.mjs";
import { readStl } from "./stl.mjs";

/** @typedef {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} Mesh */

/**
 * A Manifold from a triangle soup, coincident vertices welded.
 * @param {any} module Loaded manifold-3d module (setup() already called).
 * @param {Mesh} mesh
 * @returns {any} A Manifold; the caller deletes it.
 * @throws {Error} "Not manifold" when the mesh is not a closed 2-manifold.
 */
export function manifoldFrom(module, mesh) {
  const m = new module.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(mesh.positions),
    triVerts: Uint32Array.from(mesh.indices),
  });
  m.merge();
  return new module.Manifold(m);
}

/**
 * Intersection over union of two solids, after mapping each into the shared frame.
 * @param {any} module Loaded manifold-3d module.
 * @param {Mesh} generated
 * @param {Mesh} truth
 * @param {{ generatedSteps: import("./mesh-metrics.mjs").Step[],
 *   truthSteps: import("./mesh-metrics.mjs").Step[] }} frame From alignAndScore.
 * @returns {{ iou: number | null, reason: string | null }} iou is null when a
 *   mesh is not a closed solid; reason says which.
 */
export function exactIoU(module, generated, truth, frame) {
  /** @type {any[]} */
  const owned = [];
  const keep = (/** @type {any} */ x) => (owned.push(x), x);
  try {
    let a;
    try {
      a = keep(manifoldFrom(module, { positions: applySteps(generated.positions, frame.generatedSteps), indices: generated.indices }));
      keep(manifoldFrom(module, { positions: applySteps(truth.positions, frame.truthSteps), indices: truth.indices }));
    } catch (e) {
      return { iou: null, reason: (a ? "ground truth" : "generated") + " not manifold: " + (e instanceof Error ? e.message : String(e)) };
    }
    const [x, y] = owned;
    const union = keep(x.add(y)).volume();
    const inter = keep(x.intersect(y)).volume();
    return { iou: union > 0 ? inter / union : 0, reason: null };
  } finally {
    for (const m of owned) m.delete();
  }
}

/**
 * Builds the scorer one benchmark run uses for every sample.
 * @param {any} module Loaded manifold-3d module.
 * @param {(file: string) => Mesh} [readTruth] Ground-truth reader.
 * @returns {(mesh: Mesh, truthPath: string) => { chamfer: number, hausdorff: number,
 *   iogt: number, iou: number | null, iouReason: string | null }}
 */
export function createScorer(module, readTruth = readStl) {
  return (mesh, truthPath) => {
    const truth = readTruth(truthPath);
    const frame = alignAndScore(mesh, truth);
    const { iou, reason } = exactIoU(module, mesh, truth, frame);
    return { ...frame.metrics, iou, iouReason: reason };
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-iou.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add scripts/lib/bench-iou.mjs test/cad-gen/bench-iou.test.js
git commit -m "feat(cad-bench): exact volumetric IoU via Manifold and the sample scorer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dataset loading and prompt rewriting (`cadprompt.mjs`)

**Files:**
- Create: `scripts/lib/cadprompt.mjs`
- Test: `test/cad-gen/bench-cadprompt.test.js`

**Interfaces:**
- Produces:
  - `CADPROMPT_REPO`, `CADPROMPT_PIN`, `CADPROMPT_DIR`
  - `rewritePrompt(text, variant: "measured" | "abstract"): { prompt: string, rewrite: "scaled" | "fallback" | "none", suspect: boolean }`
  - `parseStrata(sharedStringsXml, sheetXml): Map<string /* 8-digit id */, Strata>`, where `Strata = { geometric: string, mesh: string, compiled: number, difficulty: "Easy" | "Hard" }`
  - `readStrata(xlsxPath): Map<string, Strata> | null` (null when the file or `unzip` is missing)
  - `loadSamples(dir, variant): Sample[]`, where `Sample = { id, variant, prompt, rewrite, suspect, gtStlPath, gtJson, strata: Strata | null }`
  - `fetchCadPrompt(dir = CADPROMPT_DIR): string` (network; returns dir)

The rewrite rules were prototyped on all 200 prompts at the pin. Measured gives 179 `scaled` and 21 `fallback`; abstract gives 200 `none`, with none left starting "Create Write…".

- [ ] **Step 1: Write the failing test**

`test/cad-gen/bench-cadprompt.test.js`:

```js
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSamples, parseStrata, rewritePrompt } from "../../scripts/lib/cadprompt.mjs";

describe("rewritePrompt (measured)", () => {
  it("strips the CadQuery prefix and scales 'N units' to mm", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create a 3D model by extruding a circular sketch. " +
      "The circle should have a radius of 0.75 units and the extrusion should be 0.20923 units high.", "measured");
    expect(out.prompt).toBe("Create a 3D model by extruding a circular sketch. The circle should have a radius of " +
      "75 mm and the extrusion should be 20.923 mm high. Dimensions are in millimetres.");
    expect(out).toMatchObject({ rewrite: "scaled", suspect: false });
  });

  it("scales every member of an 'A by B units' list", () => {
    expect(rewritePrompt("Write Python code using CADQuery to create a rectangle with dimensions 0.0075 by 0.750037 units.",
      "measured").prompt).toContain("0.75 by 75.0037 mm");
  });

  it("leaves degrees, meters, ratios and counts alone", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create a plate 0.5 units wide with 4 holes, " +
      "0.61135 meters long, about 1.5 times its width, rotated by -90 degrees.", "measured");
    expect(out.prompt).toContain("50 mm wide with 4 holes, 0.61135 meters long, about 1.5 times its width, rotated by -90 degrees");
    expect(out.rewrite).toBe("scaled");
  });

  it("handles the observed prefix variants", () => {
    expect(rewritePrompt("Write a Python script using CADQuery to create a cube of 1 unit.", "measured").prompt)
      .toBe("Create a cube of 100 mm. Dimensions are in millimetres.");
    expect(rewritePrompt("Write Python code using CADQuery for a 3D model that looks like a workbench.", "abstract").prompt)
      .toBe("Create a 3D model that looks like a workbench. Dimensions are in millimetres.");
  });

  it("falls back, unscaled, when coordinates carry lengths", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create a parallelogram defined by the points " +
      "[(0.6147, 0), (1.500795, 0)] extruded by 0.1 units.", "measured");
    expect(out.rewrite).toBe("fallback");
    expect(out.suspect).toBe(true);
    expect(out.prompt).toContain("(0.6147, 0)");
    expect(out.prompt).toContain("extruded by 0.1 units");
    expect(out.prompt).toContain("1 unit = 100 mm");
  });

  it("falls back when a unit number is the tail of an expression", () => {
    const out = rewritePrompt("Write Python code using CADQuery to create rectangles 0.636792 + 0.113207*2 units long.", "measured");
    expect(out.rewrite).toBe("fallback");
    expect(out.prompt).not.toContain("*200");
  });
});

describe("rewritePrompt (abstract)", () => {
  it("only strips the prefix", () => {
    expect(rewritePrompt(" write a python code using CADQuery to create an extruded sketch of a circle.", "abstract"))
      .toEqual({ prompt: "Create an extruded sketch of a circle. Dimensions are in millimetres.", rewrite: "none", suspect: false });
  });
});

describe("parseStrata", () => {
  const shared = '<sst><si><t>ID</t></si><si><t>Simple</t></si><si><t>Moderate</t></si>' +
    '<si><t xml:space="preserve"> Complex</t></si></sst>';
  const sheet = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="A2"><v>7</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>3</v></c><c r="D2"><v>6</v></c></row>' +
    '<row r="3"><c r="A3"><v>633</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>1</v></c><c r="D3"><v>3</v></c></row>' +
    '</sheetData>';

  it("keys by 8-digit id, trims labels, and splits difficulty at 4 of 6", () => {
    const strata = parseStrata(shared, sheet);
    expect(strata.get("00000007")).toEqual({ geometric: "Simple", mesh: "Complex", compiled: 6, difficulty: "Easy" });
    expect(strata.get("00000633")).toEqual({ geometric: "Moderate", mesh: "Simple", compiled: 3, difficulty: "Hard" });
    expect(strata.size).toBe(2);
  });
});

describe("loadSamples", () => {
  it("loads samples from a CADPrompt-shaped directory without strata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cadprompt-"));
    for (const id of ["00000002", "00000001"]) {
      const d = path.join(dir, "CADPrompt", id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "Natural_Language_Descriptions_Prompt.txt"), "write python code using CADQuery to create a cube.");
      fs.writeFileSync(path.join(d, "Natural_Language_Descriptions_Prompt_with_specific_measurements.txt"),
        "Write Python code using CADQuery to create a cube of 0.5 units.");
      fs.writeFileSync(path.join(d, "Ground_Truth.json"), JSON.stringify({ Ground_Truth: { Width_mm: 0.5 } }));
      fs.writeFileSync(path.join(d, "Ground_Truth.stl"), "solid x\nendsolid x\n");
    }
    const samples = loadSamples(dir, "measured");
    expect(samples.map((s) => s.id)).toEqual(["00000001", "00000002"]);
    expect(samples[0]).toMatchObject({
      variant: "measured", rewrite: "scaled", suspect: false, strata: null,
      gtJson: { Width_mm: 0.5 }, gtStlPath: path.join(dir, "CADPrompt", "00000001", "Ground_Truth.stl"),
    });
    expect(samples[0].prompt).toBe("Create a cube of 50 mm. Dimensions are in millimetres.");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-cadprompt.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `scripts/lib/cadprompt.mjs`**

```js
/**
 * The CADPrompt benchmark dataset: fetch, load, stratify, rewrite.
 * @remarks CADPrompt (Alrashedy et al., ICLR 2025) is 200 text prompts with
 *   ground-truth meshes. The repository has NO licence, so it is fetched at run
 *   time into gitignored test-results/ for local evaluation only and is never
 *   committed or redistributed. Pinned to one commit so scores stay comparable.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CADPROMPT_REPO = "https://github.com/Kamel773/CAD_Code_Generation";
export const CADPROMPT_PIN = "33dcecd6087ff7b8a4454b1ba4d56504a6364399";
export const CADPROMPT_DIR = path.resolve(import.meta.dirname, "..", "..", "test-results", "cadprompt");

const MEASURED_FILE = "Natural_Language_Descriptions_Prompt_with_specific_measurements.txt";
const ABSTRACT_FILE = "Natural_Language_Descriptions_Prompt.txt";

/** Paper section 4: Easy when at least 4 of its 6 attempts compiled. */
const EASY_FROM = 4;

/** A number as CADPrompt writes one: optional sign, decimals, exponent. */
const NUM = String.raw`-?\d+(?:\.\d+)?(?:[eE]-?\d+)?`;

/** "0.5 units", "0.5 by 0.3 units", "1 x 2 x 3 unit" - a length list in benchmark units. */
const UNIT_LIST = new RegExp(String.raw`(${NUM}(?:\s*(?:by|x|×)\s*${NUM})*)\s*units?\b`, "gi");

/** The CadQuery instruction every CADPrompt prompt opens with, in its observed spellings. */
const PREFIX = /^\s*write (?:a )?python (?:code|script) (?:using|in|with) cad ?query\s*(?:to|for|that)?\s*/i;

/**
 * A decimal the rewrite left alone that is still a length: not followed by a
 * unit the model can act on, by "times" (a ratio), or by "by <n>" (a list
 * whose last member was scaled).
 */
const UNSCALED = /\d+\.\d+(?!\d)(?!\s*(?:mm|degrees?|°|meters?|metres?|inch(?:es)?|times)\b)(?!\s*(?:by|x|×)\s*-?\d)/i;

/** An arithmetic operator just before a number: "0.6 + 0.1*2 units" must not become "...*200 mm". */
const OPERATOR_BEFORE = /[*+/-]\s*$/;

/** Verbs a stripped prompt may already start with. */
const VERB = /^(?:create|make|build|design|generate|model|draw|construct)\b/i;

const MM_NOTE = " Dimensions are in millimetres.";
const FALLBACK_NOTE = " Lengths are given in units where 1 unit = 100 mm; build the part at that scale, in millimetres.";

/**
 * Multiplies a benchmark length by 100 and prints it without float noise.
 * @param {string} n
 * @returns {string}
 */
const scaled = (n) => String(Number((Number(n) * 100).toPrecision(6)));

/**
 * Drops the CadQuery instruction and leaves an imperative request.
 * @param {string} text
 * @returns {string}
 */
function stripPrefix(text) {
  const body = text.trim().replace(PREFIX, "");
  return VERB.test(body) ? body[0].toUpperCase() + body.slice(1) : "Create " + body;
}

/**
 * Turns a CADPrompt prompt into a request cad-gen can take.
 * @remarks Measured prompts state lengths in tiny unitless "units"; cad-gen's
 *   system prompt and helpers are written for millimetre parts, so lengths are
 *   scaled x100. Where scaling cannot be done safely - coordinate tuples,
 *   arithmetic on lengths - the prompt keeps its numbers and states the
 *   conversion instead ("fallback"), rather than mixing scaled and unscaled
 *   lengths in one request.
 * @param {string} text Raw prompt file contents.
 * @param {"measured" | "abstract"} variant
 * @returns {{ prompt: string, rewrite: "scaled" | "fallback" | "none", suspect: boolean }}
 *   suspect: a human may want to read this one.
 */
export function rewritePrompt(text, variant) {
  const body = stripPrefix(text);
  const leftover = /cad ?query|python/i.test(body);
  if (variant === "abstract") return { prompt: body + MM_NOTE, rewrite: "none", suspect: leftover };
  let expression = false;
  const scaledBody = body.replace(UNIT_LIST, (match, list, offset, whole) => {
    if (OPERATOR_BEFORE.test(whole.slice(0, offset))) {
      expression = true;
      return match;
    }
    return list.replace(new RegExp(NUM, "g"), scaled) + " mm";
  });
  if (expression || UNSCALED.test(scaledBody)) {
    return { prompt: body + FALLBACK_NOTE, rewrite: "fallback", suspect: true };
  }
  return { prompt: scaledBody + MM_NOTE, rewrite: "scaled", suspect: leftover };
}

/** @typedef {{ geometric: string, mesh: string, compiled: number, difficulty: "Easy" | "Hard" }} Strata */

/**
 * Reads Data_Stratification.xlsx's one sheet from its raw XML parts.
 * @remarks Columns: A id (numeric: 7 for directory 00000007), B semantic /
 *   geometric complexity, C mesh complexity, D how many of the paper's 6
 *   attempts compiled. String cells index the shared-strings table and carry
 *   stray leading spaces.
 * @param {string} sharedXml xl/sharedStrings.xml
 * @param {string} sheetXml xl/worksheets/sheet1.xml
 * @returns {Map<string, Strata>} Keyed by 8-digit sample id.
 */
export function parseStrata(sharedXml, sheetXml) {
  const strings = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("").trim());
  /** @type {Map<string, Strata>} */
  const strata = new Map();
  for (const row of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    /** @type {Record<string, string | number>} */
    const cells = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/g)) {
      const [, col, attrs, v] = c;
      if (v === undefined) continue;
      cells[col] = /t="s"/.test(attrs) ? strings[Number(v)] : Number(v);
    }
    if (typeof cells.A !== "number") continue; // the header row
    const compiled = Number(cells.D);
    strata.set(String(cells.A).padStart(8, "0"), {
      geometric: String(cells.B), mesh: String(cells.C), compiled,
      difficulty: compiled >= EASY_FROM ? "Easy" : "Hard",
    });
  }
  return strata;
}

/**
 * Reads the stratification spreadsheet with the system unzip.
 * @param {string} xlsx Path to Data_Stratification.xlsx.
 * @returns {Map<string, Strata> | null} null when the file or unzip is missing;
 *   the run then reports unstratified and says so.
 */
export function readStrata(xlsx) {
  if (!fs.existsSync(xlsx)) return null;
  try {
    const part = (/** @type {string} */ name) => execFileSync("unzip", ["-p", xlsx, name], { encoding: "utf8" });
    return parseStrata(part("xl/sharedStrings.xml"), part("xl/worksheets/sheet1.xml"));
  } catch {
    return null;
  }
}

/** @typedef {{ id: string, variant: "measured" | "abstract", prompt: string,
 *   rewrite: "scaled" | "fallback" | "none", suspect: boolean, gtStlPath: string,
 *   gtJson: any, strata: Strata | null }} Sample */

/**
 * Loads every sample of one prompt variant, sorted by id.
 * @param {string} dir Dataset checkout (holds CADPrompt/ and the xlsx).
 * @param {"measured" | "abstract"} variant
 * @returns {Sample[]}
 */
export function loadSamples(dir, variant) {
  const root = path.join(dir, "CADPrompt");
  const strata = readStrata(path.join(dir, "Data_Stratification.xlsx"));
  const file = variant === "measured" ? MEASURED_FILE : ABSTRACT_FILE;
  return fs.readdirSync(root).filter((n) => /^\d+$/.test(n)).sort().map((id) => {
    const d = path.join(root, id);
    const { prompt, rewrite, suspect } = rewritePrompt(fs.readFileSync(path.join(d, file), "utf8"), variant);
    return {
      id, variant, prompt, rewrite, suspect,
      gtStlPath: path.join(d, "Ground_Truth.stl"),
      gtJson: JSON.parse(fs.readFileSync(path.join(d, "Ground_Truth.json"), "utf8")).Ground_Truth,
      strata: strata?.get(id) ?? null,
    };
  });
}

/**
 * Ensures the pinned dataset is checked out in dir; the only network access.
 * @param {string} [dir]
 * @returns {string} dir
 * @throws {Error} When the checkout does not end at the pin.
 */
export function fetchCadPrompt(dir = CADPROMPT_DIR) {
  const head = () => {
    try {
      return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  if (head() === CADPROMPT_PIN) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["init", "-q", dir]);
  // GitHub serves fetch-by-SHA, so a shallow fetch of exactly the pin works.
  execFileSync("git", ["-C", dir, "fetch", "-q", "--depth", "1", CADPROMPT_REPO, CADPROMPT_PIN], { stdio: "inherit" });
  execFileSync("git", ["-C", dir, "checkout", "-q", "FETCH_HEAD"]);
  if (head() !== CADPROMPT_PIN) throw new Error("CADPrompt checkout is not at " + CADPROMPT_PIN);
  return dir;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-cadprompt.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Check against the real dataset (network)**

Run:

```bash
bun -e '
import { fetchCadPrompt, loadSamples } from "./scripts/lib/cadprompt.mjs";
const dir = fetchCadPrompt();
for (const v of ["measured", "abstract"]) {
  const s = loadSamples(dir, v);
  const by = (k) => s.reduce((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {});
  console.log(v, s.length, JSON.stringify(by("rewrite")), "strata", s.filter((x) => x.strata).length,
    JSON.stringify(s.reduce((m, x) => ({ ...m, [x.strata?.difficulty]: (m[x.strata?.difficulty] ?? 0) + 1 }), {})));
}'
```

Expected:
```
measured 200 {"scaled":179,"fallback":21} strata 200 {"Easy":…,"Hard":…}
abstract 200 {"none":200} strata 200 {…}
```
If the counts differ, investigate before going on: the rules were tuned on this exact pin.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add scripts/lib/cadprompt.mjs test/cad-gen/bench-cadprompt.test.js
git commit -m "feat(cad-bench): CADPrompt loader, stratification and mm prompt rewrite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: One sample end to end (`bench-sample.mjs`)

**Files:**
- Create: `scripts/lib/bench-sample.mjs`
- Test: `test/cad-gen/bench-sample.test.js`

**Interfaces:**
- Consumes: `buildWithClientRepair` (Task 1), `PENALTY_DISTANCE` (Task 2), the `Sample` shape (Task 4), the scorer signature `(mesh, truthPath) => metrics` (Task 3)
- Produces:
  - `SAMPLE_TIMEOUT_MS = 600000`
  - `PENALTY = { chamfer: √3, hausdorff: √3, iogt: 0, iou: 0, iouReason: null }`
  - `classifyError(error, signal): "timeout" | "refused" | "static_failed" | "provider_error"`
  - `runSample({ generator, kernel, score, sample, timeoutMs? }): Promise<{ result: SampleResult, mesh: Mesh | null }>`
  - `SampleResult` fields: `id, variant, prompt, rewrite, suspect, strata, groundTruth, outcome, error, design, diagnostics, clientFailures, firstPass, stats, metrics, tokens, jevTokens, durationMs, triage`

- [ ] **Step 1: Write the failing test**

`test/cad-gen/bench-sample.test.js`:

```js
import { describe, expect, it } from "bun:test";
import { CadGenerationFailed, CadRequestUnsuitable } from "../../packages/cad-gen/src/errors.ts";
import { CLIENT_REPAIR_ROUNDS } from "../../scripts/lib/client-repair.mjs";
import { PENALTY, runSample } from "../../scripts/lib/bench-sample.mjs";

const GOOD = {
  triangles: 12, vertices: 8, volumeMm3: 1,
  bboxMm: { min: [0, 0, 0], max: [1, 1, 1] }, bodies: { count: 1, boxes: [] },
};
const MESH = { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) };
const SAMPLE = {
  id: "00000007", variant: "measured", prompt: "Create a cube of 50 mm.", rewrite: "scaled", suspect: false,
  gtStlPath: "/gt.stl", gtJson: { Width_mm: 0.5 }, strata: null,
};
const METRICS = { chamfer: 0.1, hausdorff: 0.3, iogt: 0.9, iou: 0.8, iouReason: null };

/** A generator returning designs, or throwing what `fail` gives it. */
function generatorOf(/** @type {() => any} */ fail = () => null) {
  let n = 0;
  return {
    async generate() {
      const e = fail();
      if (e) throw e;
      n++;
      return {
        design: { code: "return cube(" + n + ")", parameters: {}, summary: "cube" },
        diagnostics: { selection: { jevTokens: { prompt: 3, completion: 0 } }, attempts: [], tokens: { prompt: 100, completion: 50 } },
      };
    },
  };
}
const kernelOf = (/** @type {any[]} */ outcomes) => {
  let i = 0;
  return { run() { const o = outcomes[Math.min(i++, outcomes.length - 1)]; if (o instanceof Error) throw o; return { mesh: MESH, stats: o }; } };
};
const score = () => METRICS;

describe("runSample", () => {
  it("scores a first-pass build", async () => {
    const { result, mesh } = await runSample({ generator: generatorOf(), kernel: kernelOf([GOOD]), score, sample: SAMPLE });
    expect(result.outcome).toBe("built");
    expect(result.firstPass).toBe(true);
    expect(result.metrics).toEqual(METRICS);
    expect(result.tokens).toEqual({ prompt: 100, completion: 50 });
    expect(result.jevTokens).toEqual({ prompt: 3, completion: 0 });
    expect(mesh).toBe(MESH);
  });

  it("counts repair tokens and is not first-pass after a client repair", async () => {
    const { result } = await runSample({ generator: generatorOf(), kernel: kernelOf([new Error("bad"), GOOD]), score, sample: SAMPLE });
    expect(result.outcome).toBe("built");
    expect(result.firstPass).toBe(false);
    expect(result.clientFailures).toEqual([{ gate: "kernel", error: "bad" }]);
    expect(result.tokens).toEqual({ prompt: 200, completion: 100 });
    expect(result.design.code).toBe("return cube(2)");
  });

  it("classifies an unsuitability refusal and applies the penalty", async () => {
    const { result, mesh } = await runSample({
      generator: generatorOf(() => new CadRequestUnsuitable("organic", 0.1)), kernel: kernelOf([GOOD]), score, sample: SAMPLE,
    });
    expect(result.outcome).toBe("refused");
    expect(result.metrics).toEqual(PENALTY);
    expect(mesh).toBeNull();
  });

  it("classifies exhausted static repair and keeps its tokens", async () => {
    const { result } = await runSample({
      generator: generatorOf(() => new CadGenerationFailed("failed", { tokens: { prompt: 7, completion: 2 } })),
      kernel: kernelOf([GOOD]), score, sample: SAMPLE,
    });
    expect(result.outcome).toBe("static_failed");
    expect(result.tokens).toEqual({ prompt: 7, completion: 2 });
  });

  it("classifies a kernel throw that survives every repair", async () => {
    const { result } = await runSample({ generator: generatorOf(), kernel: kernelOf([new Error("boom")]), score, sample: SAMPLE });
    expect(result.outcome).toBe("kernel_error");
    expect(result.clientFailures).toHaveLength(CLIENT_REPAIR_ROUNDS + 1);
    expect(result.metrics).toEqual(PENALTY);
  });

  it("classifies a gate failure that survives every repair", async () => {
    const { result } = await runSample({ generator: generatorOf(), kernel: kernelOf([{ ...GOOD, triangles: 0 }]), score, sample: SAMPLE });
    expect(result.outcome).toBe("gate_failed");
    expect(result.error.startsWith("nonempty: ")).toBe(true);
  });

  it("classifies a provider error", async () => {
    const { result } = await runSample({ generator: generatorOf(() => new Error("HTTP 500")), kernel: kernelOf([GOOD]), score, sample: SAMPLE });
    expect(result.outcome).toBe("provider_error");
    expect(result.error).toBe("HTTP 500");
  });

  it("times out through the generate signal", async () => {
    const generator = {
      generate: (/** @type {any} */ input) => new Promise((_, reject) =>
        input.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const { result } = await runSample({ generator, kernel: kernelOf([GOOD]), score, sample: SAMPLE, timeoutMs: 10 });
    expect(result.outcome).toBe("timeout");
    expect(result.metrics).toEqual(PENALTY);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-sample.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `scripts/lib/bench-sample.mjs`**

```js
/**
 * One CADPrompt sample through the shipped loop: generate, build with client
 * repair, score against ground truth.
 * @remarks Generator, kernel and scorer are injected, so outcome
 *   classification and the paper's penalty rule are testable without a
 *   provider or WASM. Scoring sits OUTSIDE the error classification on
 *   purpose: a scorer that throws is a harness bug, and must stop the run
 *   rather than be booked against the generator as a provider error.
 */
import { CadGenerationFailed, CadRequestUnsuitable } from "../../packages/cad-gen/src/errors.ts";
import { buildWithClientRepair } from "./client-repair.mjs";
import { PENALTY_DISTANCE } from "./mesh-metrics.mjs";

/** Per-sample wall clock. Enforced through generate()'s signal only. */
export const SAMPLE_TIMEOUT_MS = 10 * 60 * 1000;

/** What a sample that produced no part scores: paper section 5, plus IoU 0. */
export const PENALTY = Object.freeze({
  chamfer: PENALTY_DISTANCE, hausdorff: PENALTY_DISTANCE, iogt: 0, iou: 0, iouReason: null,
});

/** @typedef {{ prompt: number, completion: number }} Tokens */

/**
 * @param {Tokens} a @param {Tokens | undefined} b
 * @returns {Tokens}
 */
const addTokens = (a, b) => ({ prompt: a.prompt + (b?.prompt ?? 0), completion: a.completion + (b?.completion ?? 0) });

/**
 * Names why generation produced no design.
 * @param {unknown} error
 * @param {AbortSignal} signal The sample's wall-clock signal.
 * @returns {"timeout" | "refused" | "static_failed" | "provider_error"}
 */
export function classifyError(error, signal) {
  if (signal.aborted) return "timeout";
  if (error instanceof CadRequestUnsuitable) return "refused";
  if (error instanceof CadGenerationFailed) return "static_failed";
  return "provider_error";
}

/**
 * Runs one sample.
 * @param {{ generator: any, kernel: any,
 *   score: (mesh: any, truthPath: string) => any,
 *   sample: import("./cadprompt.mjs").Sample, timeoutMs?: number }} ctx
 * @returns {Promise<{ result: any, mesh: any }>} mesh is the delivered part,
 *   or null when none was built.
 */
export async function runSample(ctx) {
  const { sample } = ctx;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs ?? SAMPLE_TIMEOUT_MS);
  /** @type {any} */
  const result = {
    id: sample.id, variant: sample.variant, prompt: sample.prompt, rewrite: sample.rewrite,
    suspect: sample.suspect, strata: sample.strata, groundTruth: sample.gtJson,
    outcome: "provider_error", error: null, design: null, diagnostics: null,
    clientFailures: [], firstPass: false, stats: null, metrics: { ...PENALTY },
    tokens: { prompt: 0, completion: 0 }, jevTokens: { prompt: 0, completion: 0 },
    durationMs: 0, triage: null,
  };
  /** @type {any} */
  let built;
  try {
    const first = await ctx.generator.generate({ prompt: sample.prompt, signal: controller.signal });
    result.diagnostics = first.diagnostics;
    result.tokens = addTokens(result.tokens, first.diagnostics?.tokens);
    result.jevTokens = addTokens(result.jevTokens, first.diagnostics?.selection?.jevTokens);
    built = await buildWithClientRepair(
      { generator: ctx.generator, kernel: ctx.kernel, prompt: sample.prompt, signal: controller.signal }, first);
    for (const r of built.results) result.tokens = addTokens(result.tokens, r.diagnostics?.tokens);
    result.design = built.design;
    result.clientFailures = built.failures;
  } catch (e) {
    result.outcome = classifyError(e, controller.signal);
    result.error = e instanceof Error ? e.message : String(e);
    if (e instanceof CadGenerationFailed) {
      result.tokens = addTokens(result.tokens, /** @type {any} */ (e.diagnostics)?.tokens);
    }
    return finish(result, null, started, timer);
  }
  if (!built.run) {
    const last = built.failures[built.failures.length - 1];
    result.outcome = last.gate === "kernel" ? "kernel_error" : "gate_failed";
    result.error = last.error;
    return finish(result, null, started, timer);
  }
  result.outcome = "built";
  result.firstPass = built.failures.length === 0;
  result.stats = built.run.stats;
  result.metrics = ctx.score(built.run.mesh, sample.gtStlPath);
  return finish(result, built.run.mesh, started, timer);
}

/**
 * Stamps the duration and releases the wall clock.
 * @param {any} result @param {any} mesh @param {number} started
 * @param {ReturnType<typeof setTimeout>} timer
 * @returns {{ result: any, mesh: any }}
 */
function finish(result, mesh, started, timer) {
  clearTimeout(timer);
  result.durationMs = Date.now() - started;
  return { result, mesh };
}
```

Note: if `ctx.score` throws, the timer is still cleared when the process exits. The CLI treats a scorer throw as fatal, so no `finally` is needed.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-sample.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add scripts/lib/bench-sample.mjs test/cad-gen/bench-sample.test.js
git commit -m "feat(cad-bench): per-sample runner with outcome classification and paper penalty

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Jev triage (`bench-triage.mjs`)

**Files:**
- Create: `scripts/lib/bench-triage.mjs`
- Test: `test/cad-gen/bench-triage.test.js`

**Interfaces:**
- Consumes: `askJev(config, state, questions, signal?)` from `packages/cad-gen/src/backend/jev.ts`. It POSTs `{ model, state, questions }` and returns the raw body `{ answers: { [id]: { choice, confidence } | { noul } }, usage: { input_tokens, output_tokens } }`. It throws `JevError`. `config.fetchImpl` is honoured. The `SampleResult` shape comes from Task 5.
- Produces:
  - `LOW_SCORE = 0.5`, `UNSURE_BELOW = 0.6`, `FAILURE_CAUSES`, `SHAPE_MISMATCHES`
  - `needsTriage(result): boolean`
  - `triageState(result): object`
  - `questionsFor(result): Record<string, object>`
  - `readTriage(body): Triage`, where `Triage = { failureCause?: Label, shapeMismatch?: Label, gateFalsePositive?: number, promptFixable?: number, usage: Tokens }` and `Label = { label: string, confidence: number, unsure: boolean }`
  - `triage(jevConfig, result): Promise<Triage | { error: string }>`

- [ ] **Step 1: Write the failing test**

`test/cad-gen/bench-triage.test.js`:

```js
import { describe, expect, it } from "bun:test";
import {
  FAILURE_CAUSES, needsTriage, questionsFor, readTriage, triage, triageState,
} from "../../scripts/lib/bench-triage.mjs";

const base = {
  id: "00000007", prompt: "Create a cube of 50 mm.", variant: "measured",
  groundTruth: { Width_mm: 0.5, Height_mm: 0.5, Depth_mm: 0.5, Volume_cubic_mm: 0.125, Is_Solid: true },
  design: { code: "return cube(50)", parameters: { side: { value: 50 } }, summary: "a cube" },
  diagnostics: { attempts: [{ index: 0, ok: false, gates: [{ gate: "guard", ok: false, error: "fs denied" }] }] },
  clientFailures: [], error: null, stats: null,
  metrics: { chamfer: 1.732, hausdorff: 1.732, iogt: 0, iou: 0 },
};
const built = {
  ...base, outcome: "built",
  stats: { triangles: 12, volumeMm3: 250000, bboxMm: { min: [0, 0, 0], max: [100, 50, 50] }, bodies: { count: 1, boxes: [] } },
  metrics: { chamfer: 0.2, hausdorff: 0.5, iogt: 0.6, iou: 0.4 },
};
const gateFailed = {
  ...base, outcome: "gate_failed", error: "connected: 2 bodies",
  clientFailures: [{ gate: "connected", error: "connected: 2 bodies" }],
};

describe("needsTriage", () => {
  it("triages every failure and low-IoU builds; IoGT stands in when IoU is null", () => {
    expect(needsTriage(gateFailed)).toBe(true);
    expect(needsTriage(built)).toBe(true);
    expect(needsTriage({ ...built, metrics: { ...built.metrics, iou: 0.9 } })).toBe(false);
    expect(needsTriage({ ...built, metrics: { ...built.metrics, iou: null, iogt: 0.95 } })).toBe(false);
  });
});

describe("triageState", () => {
  it("puts ground truth in mm, generated size and volume ratio, and every round", () => {
    const s = /** @type {any} */ (triageState(built));
    expect(s.ground_truth_mm).toEqual({ width: 50, height: 50, depth: 50, volume_mm3: 125000, is_solid: true });
    expect(s.generated).toEqual({ size_mm: [100, 50, 50], volume_ratio_to_ground_truth: 2, bodies: 1, triangles: 12 });
    expect(s.rounds).toEqual([{ stage: "server", error: "guard: fs denied" }]);
    expect(s.code_excerpt).toBe("return cube(50)");
  });

  it("says when sizes are not comparable (abstract prompts give none)", () => {
    expect(/** @type {any} */ (triageState({ ...built, variant: "abstract" })).scale_note).toContain("proportions");
  });
});

describe("questionsFor", () => {
  it("asks failure_cause, gate_false_positive and prompt_fixable for a gate failure", () => {
    expect(Object.keys(questionsFor(gateFailed)).sort()).toEqual(["failure_cause", "gate_false_positive", "prompt_fixable"]);
    expect(/** @type {any} */ (questionsFor(gateFailed)).failure_cause.criteria).toEqual(FAILURE_CAUSES);
  });

  it("asks shape_mismatch and prompt_fixable for a low-scoring build", () => {
    expect(Object.keys(questionsFor(built)).sort()).toEqual(["prompt_fixable", "shape_mismatch"]);
  });
});

describe("readTriage", () => {
  it("reads labels, flags low confidence as unsure, and reads usage", () => {
    const t = readTriage({
      answers: {
        failure_cause: { type: "choice", choice: "helper_misuse", confidence: 0.55 },
        gate_false_positive: { type: "noul", noul: 0.2 },
        prompt_fixable: { type: "noul", noul: 0.8 },
      },
      usage: { input_tokens: 900, output_tokens: 0 },
    });
    expect(t).toEqual({
      failureCause: { label: "helper_misuse", confidence: 0.55, unsure: true },
      gateFalsePositive: 0.2, promptFixable: 0.8, usage: { prompt: 900, completion: 0 },
    });
  });
});

describe("triage", () => {
  it("posts state and questions to Jev and reads the answer", async () => {
    /** @type {any} */
    let sent;
    const fetchImpl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({
        answers: { shape_mismatch: { choice: "orientation", confidence: 0.9 }, prompt_fixable: { noul: 0.3 } },
        usage: { input_tokens: 10, output_tokens: 0 },
      }));
    };
    const t = await triage({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, built);
    expect(Object.keys(sent.questions).sort()).toEqual(["prompt_fixable", "shape_mismatch"]);
    expect(sent.state.prompt_sent).toBe("Create a cube of 50 mm.");
    expect(t).toMatchObject({ shapeMismatch: { label: "orientation", unsure: false }, promptFixable: 0.3 });
  });

  it("returns an error record instead of throwing", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const t = await triage({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, built);
    expect(t).toEqual({ error: expect.stringContaining("401") });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-triage.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `scripts/lib/bench-triage.mjs`**

```js
/**
 * Jev triage of benchmark failures: why did this sample fail, or score low?
 * @remarks Jev (TypeSafe AI's decision model; see
 *   packages/cad-gen/src/backend/jev.ts) answers typed questions about one
 *   shared state with calibrated probabilities. It reads text only, so the
 *   state is the prompt, the ground-truth facts, the part's stats and the
 *   design - never the mesh. Its labels are judgements, not facts: the summary
 *   treats the cause table as advisory until a hand-labelled agreement check
 *   (bench-summary.mjs) has been recorded.
 */
import { askJev } from "../../packages/cad-gen/src/backend/jev.ts";

/** A build scoring below this (IoU, else IoGT) is triaged. */
export const LOW_SCORE = 0.5;

/** A choice answer below this confidence is reported as unsure. */
export const UNSURE_BELOW = 0.6;

const CODE_EXCERPT_CHARS = 3000;

/** Why a sample produced no acceptable part. */
export const FAILURE_CAUSES = {
  misread_prompt: "The design builds something other than what the prompt describes",
  unit_or_scale: "Dimensions are off through a units or scale mistake",
  helper_misuse: "A CAD helper function was called with wrong, missing or out-of-range arguments",
  degenerate_boolean: "A boolean, extrusion or revolve produced an empty, zero-volume or broken solid",
  gate_too_strict: "The part is reasonable but a validation gate rejected it",
  kernel_limit: "The script hit a resource limit such as the triangle budget or time",
  wrong_refusal: "The request was refused as unsuitable although it is a plain mechanical part",
  other: "None of the above",
};

/** How a built part differs from the ground truth. */
export const SHAPE_MISMATCHES = {
  orientation: "Right shape, but rotated or lying on a different axis than the ground truth",
  missing_feature: "A hole, cut, boss or other feature the prompt asks for is absent",
  extra_feature: "The part has features the prompt does not ask for",
  proportions: "The overall length, width and height ratios differ from the ground truth",
  scale_interpretation: "Dimensions were read at a different scale or as different quantities",
};

/**
 * @param {any} result A SampleResult.
 * @returns {boolean}
 */
export function needsTriage(result) {
  if (result.outcome !== "built") return true;
  return (result.metrics.iou ?? result.metrics.iogt) < LOW_SCORE;
}

/**
 * Server attempts and client builds that failed, in order.
 * @param {any} result
 * @returns {{ stage: string, gate?: string, error: string }[]}
 */
function roundsOf(result) {
  const server = (result.diagnostics?.attempts ?? []).filter((/** @type {any} */ a) => !a.ok)
    .map((/** @type {any} */ a) => ({
      stage: "server",
      error: a.error ?? a.gates.filter((/** @type {any} */ g) => !g.ok).map((/** @type {any} */ g) => g.gate + ": " + g.error).join("; "),
    }));
  const client = result.clientFailures.map((/** @type {any} */ f) => ({ stage: "client", gate: f.gate, error: f.error }));
  const final = result.error && result.clientFailures.length === 0 ? [{ stage: "final", error: result.error }] : [];
  return [...server, ...client, ...final];
}

/**
 * The state Jev reads for one sample.
 * @remarks Ground truth is scaled x100 into the mm the prompt was rewritten
 *   to, so sizes compare directly; volume scales by 100^3.
 * @param {any} result A SampleResult.
 * @returns {object}
 */
export function triageState(result) {
  const gt = result.groundTruth ?? {};
  const s = result.stats;
  const gtVolume = (gt.Volume_cubic_mm ?? 0) * 1e6;
  return {
    prompt_sent: result.prompt,
    outcome: result.outcome,
    ...(result.variant === "abstract"
      ? { scale_note: "The prompt gave no dimensions: compare proportions, not absolute size." }
      : {}),
    ground_truth_mm: {
      width: (gt.Width_mm ?? 0) * 100, height: (gt.Height_mm ?? 0) * 100, depth: (gt.Depth_mm ?? 0) * 100,
      volume_mm3: gtVolume, is_solid: gt.Is_Solid ?? null,
    },
    generated: s ? {
      size_mm: [0, 1, 2].map((a) => Number((s.bboxMm.max[a] - s.bboxMm.min[a]).toFixed(3))),
      volume_ratio_to_ground_truth: gtVolume > 0 ? Number((s.volumeMm3 / gtVolume).toFixed(4)) : null,
      bodies: s.bodies?.count ?? 1,
      triangles: s.triangles,
    } : "none",
    metrics: { iou: result.metrics.iou, iogt: result.metrics.iogt, chamfer: result.metrics.chamfer },
    design_summary: result.design?.summary ?? "none",
    parameters: result.design?.parameters ?? {},
    rounds: roundsOf(result),
    code_excerpt: (result.design?.code ?? "").slice(0, CODE_EXCERPT_CHARS),
  };
}

/**
 * The questions that apply to this sample's outcome.
 * @param {any} result A SampleResult.
 * @returns {Record<string, object>}
 */
export function questionsFor(result) {
  /** @type {Record<string, object>} */
  const q = {};
  if (result.outcome === "built") {
    q.shape_mismatch = {
      type: "choice",
      instructions: "The part was built but differs from the ground truth. What is the main difference? " +
        "Compare the generated size and volume ratio with the ground truth, and the design with the prompt.",
      criteria: SHAPE_MISMATCHES,
    };
  } else {
    q.failure_cause = {
      type: "choice",
      instructions: "Why did this CAD generation fail to produce an acceptable part? " +
        "Judge from the errors in rounds, the design and the prompt.",
      criteria: FAILURE_CAUSES,
    };
  }
  if (result.outcome === "gate_failed") {
    q.gate_false_positive = {
      type: "noul",
      instructions: "Was the part as designed acceptable for what the prompt asks, so that the validation " +
        "gate named in the last round rejected it wrongly?",
      criteria: { true: "The gate rejected an acceptable part", false: "The gate caught a real defect" },
    };
  }
  q.prompt_fixable = {
    type: "noul",
    instructions: "Would clearer system-prompt instructions, or better documentation of the CAD helper " +
      "library, likely have prevented this problem?",
    criteria: {
      true: "Better instructions or documentation would likely have prevented it",
      false: "The problem lies elsewhere: model capability, a gate, or the request itself",
    },
  };
  return q;
}

/** @typedef {{ label: string, confidence: number, unsure: boolean }} Label */

/**
 * Reads Jev's reply into the triage record.
 * @param {any} body Raw askJev reply.
 * @returns {{ failureCause?: Label, shapeMismatch?: Label, gateFalsePositive?: number,
 *   promptFixable?: number, usage: { prompt: number, completion: number } }}
 */
export function readTriage(body) {
  const a = body?.answers ?? {};
  /** @param {any} x @returns {Label | undefined} */
  const choice = (x) => (typeof x?.choice === "string"
    ? { label: x.choice, confidence: x.confidence ?? 0, unsure: (x.confidence ?? 0) < UNSURE_BELOW }
    : undefined);
  /** @param {any} x @returns {number | undefined} */
  const noul = (x) => (typeof x?.noul === "number" ? x.noul : undefined);
  const fields = {
    failureCause: choice(a.failure_cause), shapeMismatch: choice(a.shape_mismatch),
    gateFalsePositive: noul(a.gate_false_positive), promptFixable: noul(a.prompt_fixable),
  };
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    usage: { prompt: body?.usage?.input_tokens ?? 0, completion: body?.usage?.output_tokens ?? 0 },
  };
}

/**
 * Asks Jev about one sample. Never throws: a Jev failure must not fail the run.
 * @param {import("../../packages/cad-gen/src/backend/jev.ts").JevConfig} jev
 * @param {any} result A SampleResult.
 * @returns {Promise<any>} The triage record, or { error }.
 */
export async function triage(jev, result) {
  try {
    return readTriage(await askJev(jev, triageState(result), questionsFor(result)));
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-triage.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add scripts/lib/bench-triage.mjs test/cad-gen/bench-triage.test.js
git commit -m "feat(cad-bench): Jev triage of failed and low-scoring samples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Aggregation and the report (`bench-summary.mjs`)

**Files:**
- Create: `scripts/lib/bench-summary.mjs`
- Test: `test/cad-gen/bench-summary.test.js`

**Interfaces:**
- Consumes: the `SampleResult` shape (Task 5), including `triage` (Task 6) and `strata` (Task 4)
- Produces:
  - `PAPER_BASELINES: { name, iogt: [median, iqr], chamfer: [median, iqr], hausdorff: [median, iqr], compileRate }[]`
  - `quantile(sorted, q)`, `medianIqr(values): { median, iqr, n }`, where nulls and non-finite values are dropped
  - `summarise(results, config): Summary`
  - `compareSummaries(current, other): Record<string, { current, other, delta }>`
  - `agreementTemplate(results, max = 20): string`, `parseAgreement(markdown): { labelled, agreed, rate }`
  - `renderMarkdown(summary, { compare? }): string`

- [ ] **Step 1: Write the failing test**

`test/cad-gen/bench-summary.test.js`:

```js
import { describe, expect, it } from "bun:test";
import {
  agreementTemplate, compareSummaries, medianIqr, parseAgreement, renderMarkdown, summarise,
} from "../../scripts/lib/bench-summary.mjs";

const PENALTY = { chamfer: Math.sqrt(3), hausdorff: Math.sqrt(3), iogt: 0, iou: 0, iouReason: null };
const tokens = { prompt: 100, completion: 10 };
const r = (/** @type {any} */ over) => ({
  id: "x", outcome: "built", firstPass: true, rewrite: "scaled", suspect: false,
  strata: { geometric: "Simple", mesh: "Simple", compiled: 6, difficulty: "Easy" },
  metrics: { chamfer: 0.1, hausdorff: 0.2, iogt: 0.9, iou: 0.8, iouReason: null },
  clientFailures: [], tokens, jevTokens: { prompt: 5, completion: 0 }, durationMs: 1000, triage: null,
  ...over,
});
const RESULTS = [
  r({ id: "a" }),
  r({ id: "b", firstPass: false, metrics: { chamfer: 0.3, hausdorff: 0.4, iogt: 0.7, iou: null, iouReason: "x" } }),
  r({
    id: "c", outcome: "gate_failed", firstPass: false, metrics: PENALTY,
    strata: { geometric: "Complex", mesh: "Complex", compiled: 2, difficulty: "Hard" },
    clientFailures: [{ gate: "connected", error: "e" }],
    triage: { failureCause: { label: "gate_too_strict", confidence: 0.9, unsure: false }, gateFalsePositive: 0.8, promptFixable: 0.2, usage: { prompt: 50, completion: 0 } },
  }),
  r({
    id: "d", outcome: "refused", firstPass: false, metrics: PENALTY, suspect: true, rewrite: "fallback",
    triage: { failureCause: { label: "wrong_refusal", confidence: 0.4, unsure: true }, promptFixable: 0.1, usage: { prompt: 50, completion: 0 } },
  }),
];

describe("medianIqr", () => {
  it("interpolates like numpy and drops nulls", () => {
    expect(medianIqr([4, 1, 3, 2])).toEqual({ median: 2.5, iqr: 1.5, n: 4 });
    expect(medianIqr([1, null, 3])).toEqual({ median: 2, iqr: 1, n: 2 });
  });
});

describe("summarise", () => {
  const s = summarise(RESULTS, { variant: "measured" });

  it("computes rates and penalised medians over every sample", () => {
    expect(s.overall.n).toBe(4);
    expect(s.overall.compileRate).toBe(0.5);
    expect(s.overall.firstPassRate).toBe(0.25);
    expect(s.overall.iogt.median).toBeCloseTo(0.35, 12);
    expect(s.overall.iou.n).toBe(3);
    expect(s.overall.iouUnavailable).toBe(1);
  });

  it("groups by stratum, outcome and failing gate", () => {
    expect(Object.keys(s.byStratum.difficulty).sort()).toEqual(["Easy", "Hard"]);
    expect(s.byStratum.difficulty.Hard.n).toBe(1);
    expect(s.outcomes).toEqual({ built: 2, gate_failed: 1, refused: 1 });
    expect(s.failedGates).toEqual({ connected: 1 });
    expect(s.wrongRefusals).toEqual(["d"]);
    expect(s.suspect).toEqual(["d"]);
    expect(s.rewrites).toEqual({ scaled: 3, fallback: 1 });
  });

  it("tables triage causes, separating unsure answers", () => {
    expect(s.triage.failureCause).toEqual({
      gate_too_strict: { sure: ["c"], unsure: [] },
      wrong_refusal: { sure: [], unsure: ["d"] },
    });
    expect(s.triage.gateFalsePositiveRate).toBe(1);
    expect(s.triage.promptFixableRate).toBe(0);
  });

  it("sums cost", () => {
    expect(s.cost.deepseek).toEqual({ prompt: 400, completion: 40 });
    expect(s.cost.jev).toEqual({ prompt: 120, completion: 0 });
  });
});

describe("compareSummaries", () => {
  it("reports per-metric deltas", () => {
    const a = summarise(RESULTS, {});
    const b = summarise(RESULTS.slice(0, 2), {});
    const d = compareSummaries(a, b);
    expect(d.compileRate).toEqual({ current: 0.5, other: 1, delta: -0.5 });
  });
});

describe("agreement", () => {
  it("templates triaged samples and scores hand labels", () => {
    const md = agreementTemplate(RESULTS);
    expect(md).toContain("| c | failure_cause | gate_too_strict |  |");
    const filled = md
      .replace("| c | failure_cause | gate_too_strict |  |", "| c | failure_cause | gate_too_strict | gate_too_strict |")
      .replace("| d | failure_cause | wrong_refusal |  |", "| d | failure_cause | wrong_refusal | other |");
    expect(parseAgreement(filled)).toEqual({ labelled: 2, agreed: 1, rate: 0.5 });
  });
});

describe("renderMarkdown", () => {
  it("shows baselines, strata, triage as advisory, and deviations", () => {
    const md = renderMarkdown(summarise(RESULTS, { variant: "measured", model: "deepseek-flash" }), {});
    for (const text of ["GPT-4 zero-shot", "Compilation difficulty", "Where to improve", "advisory", "Deviations from the paper", "wrong_refusal"]) {
      expect(md).toContain(text);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-summary.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `scripts/lib/bench-summary.mjs`**

```js
/**
 * Aggregates benchmark results into summary.json and summary.md.
 * @remarks Medians and IQRs are taken over EVERY sample with failures
 *   penalised, as the paper does (section 5), so a generator cannot improve its
 *   median by failing the hard cases. Exact IoU is the exception: a null (a
 *   non-manifold mesh) is excluded and counted, never treated as 0.
 */

/** Table 2 of the paper: median (IQR) and compile rate. */
export const PAPER_BASELINES = [
  { name: "GPT-4 zero-shot, Generated", iogt: [0.935, 0.043], chamfer: [0.153, 0.146], hausdorff: [0.484, 0.405], compileRate: 0.92 },
  { name: "GPT-4 few-shot, Generated", iogt: [0.939, 0.030], chamfer: [0.155, 0.140], hausdorff: [0.494, 0.368], compileRate: 0.96 },
  { name: "GPT-4 few-shot, CADCodeVerify", iogt: [0.944, 0.028], chamfer: [0.127, 0.135], hausdorff: [0.419, 0.356], compileRate: 0.965 },
  { name: "Gemini zero-shot, Generated", iogt: [0.905, 0.088], chamfer: [0.159, 0.180], hausdorff: [0.531, 0.451], compileRate: 0.85 },
  { name: "CodeLlama few-shot, CADCodeVerify", iogt: [0.935, 0.957], chamfer: [0.185, 1.620], hausdorff: [0.582, 1.366], compileRate: 0.735 },
];

const STRATA = /** @type {const} */ ([
  ["geometric", "Geometric complexity"], ["mesh", "Mesh complexity"], ["difficulty", "Compilation difficulty"],
]);

const DEVIATIONS = [
  "Measured prompts are rewritten into millimetres (x100); prompts with coordinate tuples or length arithmetic keep their numbers and state 1 unit = 100 mm instead (`rewrite: fallback`).",
  "Scores are for cad-gen's full product loop: server static repair plus up to 2 client kernel repairs. The first-pass rate is the closest analogue of the paper's \"Generated\" rows.",
  "Both clouds are normalised by centroid and RMS radius before ICP (our parts are ~100x the ground truth); the paper aligns raw clouds. Metrics are taken after the paper's unit-cube normalisation.",
  "8192 area-weighted surface samples, seed 1; the paper does not state its sample count.",
  "The paper does not say which prompt variant Table 2 used; both are compared against the same rows.",
  "Exact IoU (Manifold booleans) is our addition; the paper's IoGT is a bounding-box ratio.",
];

/**
 * Linear-interpolated quantile of a sorted array (numpy's default).
 * @param {number[]} sorted @param {number} q
 * @returns {number}
 */
export function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * @param {(number | null | undefined)[]} values
 * @returns {{ median: number, iqr: number, n: number }}
 */
export function medianIqr(values) {
  const s = /** @type {number[]} */ (values.filter((v) => typeof v === "number" && Number.isFinite(v))).sort((a, b) => a - b);
  return { median: quantile(s, 0.5), iqr: quantile(s, 0.75) - quantile(s, 0.25), n: s.length };
}

/**
 * @template T
 * @param {T[]} items @param {(item: T) => string} key
 * @returns {Record<string, number>}
 */
function countBy(items, key) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

/** @param {any[]} list @returns {{ prompt: number, completion: number }} */
const sumTokens = (list) => list.reduce((s, t) => ({
  prompt: s.prompt + (t?.prompt ?? 0), completion: s.completion + (t?.completion ?? 0),
}), { prompt: 0, completion: 0 });

/** @param {any[]} results */
function aggregate(results) {
  const n = results.length;
  const pick = (/** @type {string} */ k) => results.map((r) => r.metrics[k]);
  return {
    n,
    compileRate: n ? results.filter((r) => r.outcome === "built").length / n : 0,
    firstPassRate: n ? results.filter((r) => r.firstPass).length / n : 0,
    iogt: medianIqr(pick("iogt")),
    chamfer: medianIqr(pick("chamfer")),
    hausdorff: medianIqr(pick("hausdorff")),
    iou: medianIqr(pick("iou")),
    iouUnavailable: results.filter((r) => r.metrics.iou === null).length,
  };
}

/**
 * Sample ids per triage label, sure and unsure apart.
 * @param {any[]} triaged @param {(t: any) => any} pick
 * @returns {Record<string, { sure: string[], unsure: string[] }>}
 */
function causesBy(triaged, pick) {
  /** @type {Record<string, { sure: string[], unsure: string[] }>} */
  const out = {};
  for (const r of triaged) {
    const label = pick(r.triage);
    if (!label) continue;
    const slot = (out[label.label] ??= { sure: [], unsure: [] });
    (label.unsure ? slot.unsure : slot.sure).push(r.id);
  }
  return out;
}

/**
 * Share of answered samples whose probability is at least 0.5.
 * @param {any[]} triaged @param {(t: any) => number | undefined} pick
 * @returns {number | null} null when nothing was answered.
 */
function rateOf(triaged, pick) {
  const answered = triaged.map((r) => pick(r.triage)).filter((p) => typeof p === "number");
  return answered.length ? answered.filter((p) => p >= 0.5).length / answered.length : null;
}

/**
 * @param {any[]} results SampleResults of one variant.
 * @param {object} config Run configuration, echoed into the summary.
 */
export function summarise(results, config) {
  /** @type {Record<string, Record<string, ReturnType<typeof aggregate>>>} */
  const byStratum = {};
  for (const [key] of STRATA) {
    /** @type {Record<string, any[]>} */
    const groups = {};
    for (const r of results) {
      const v = r.strata?.[key];
      if (v !== undefined) (groups[v] ??= []).push(r);
    }
    byStratum[key] = Object.fromEntries(Object.keys(groups).sort().map((k) => [k, aggregate(groups[k])]));
  }
  const triaged = results.filter((r) => r.triage && !r.triage.error);
  return {
    config,
    overall: aggregate(results),
    stratified: results.some((r) => r.strata),
    byStratum,
    outcomes: countBy(results, (r) => r.outcome),
    failedGates: countBy(results.filter((r) => r.outcome === "gate_failed"),
      (r) => r.clientFailures[r.clientFailures.length - 1]?.gate ?? "unknown"),
    rewrites: countBy(results, (r) => r.rewrite),
    suspect: results.filter((r) => r.suspect).map((r) => r.id),
    wrongRefusals: results.filter((r) => r.outcome === "refused").map((r) => r.id),
    triage: {
      triaged: triaged.length,
      errors: results.filter((r) => r.triage?.error).length,
      failureCause: causesBy(triaged, (t) => t.failureCause),
      shapeMismatch: causesBy(triaged, (t) => t.shapeMismatch),
      gateFalsePositiveRate: rateOf(triaged, (t) => t.gateFalsePositive),
      promptFixableRate: rateOf(triaged, (t) => t.promptFixable),
    },
    triageAgreement: null,
    cost: {
      deepseek: sumTokens(results.map((r) => r.tokens)),
      jev: sumTokens(results.flatMap((r) => [r.jevTokens, r.triage?.usage])),
      durationMs: results.reduce((s, r) => s + (r.durationMs ?? 0), 0),
    },
  };
}

/**
 * Per-metric deltas, current minus other.
 * @param {any} current @param {any} other Summaries of the same variant.
 * @returns {Record<string, { current: number, other: number, delta: number }>}
 */
export function compareSummaries(current, other) {
  /** @type {Record<string, (s: any) => number>} */
  const metrics = {
    compileRate: (s) => s.overall.compileRate, firstPassRate: (s) => s.overall.firstPassRate,
    iogt: (s) => s.overall.iogt.median, chamfer: (s) => s.overall.chamfer.median,
    hausdorff: (s) => s.overall.hausdorff.median, iou: (s) => s.overall.iou.median,
    wrongRefusals: (s) => s.wrongRefusals.length,
  };
  return Object.fromEntries(Object.entries(metrics).map(([k, f]) =>
    [k, { current: f(current), other: f(other), delta: f(current) - f(other) }]));
}

/**
 * A hand-labelling sheet: up to max triaged samples, round-robin over labels
 * so every cause is represented.
 * @param {any[]} results @param {number} [max]
 * @returns {string} Markdown.
 */
export function agreementTemplate(results, max = 20) {
  /** @type {Map<string, { id: string, question: string, label: string }[]>} */
  const byLabel = new Map();
  for (const r of results) {
    const t = r.triage;
    const pick = t?.failureCause ? ["failure_cause", t.failureCause] : t?.shapeMismatch ? ["shape_mismatch", t.shapeMismatch] : null;
    if (!pick) continue;
    const [question, label] = pick;
    const list = byLabel.get(label.label) ?? [];
    list.push({ id: r.id, question, label: label.label });
    byLabel.set(label.label, list);
  }
  const rows = [];
  for (let i = 0; rows.length < max && [...byLabel.values()].some((l) => l.length > i); i++) {
    for (const list of byLabel.values()) if (list[i] && rows.length < max) rows.push(list[i]);
  }
  return [
    "# Triage agreement - hand labels",
    "",
    "Read each sample's JSON, then write the label YOU would give in the `human` column,",
    "chosen from the same list Jev chose from (see bench-triage.mjs). Leave it blank to skip.",
    "Then run: `bun scripts/cad-bench.mjs --agreement <runDir>`",
    "",
    "| id | question | jev | human |",
    "|---|---|---|---|",
    ...rows.map((r) => "| " + r.id + " | " + r.question + " | " + r.label + " |  |"),
    "",
  ].join("\n");
}

/**
 * Scores a filled-in agreement sheet.
 * @param {string} markdown
 * @returns {{ labelled: number, agreed: number, rate: number | null }}
 */
export function parseAgreement(markdown) {
  let labelled = 0, agreed = 0;
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*([^|\s]+)\s*\|\s*(failure_cause|shape_mismatch)\s*\|\s*(\w+)\s*\|\s*(\w*)\s*\|/.exec(line);
    if (!m || !m[4]) continue;
    labelled++;
    if (m[3] === m[4]) agreed++;
  }
  return { labelled, agreed, rate: labelled ? agreed / labelled : null };
}

/** @param {{ median: number, iqr: number }} m */
const mi = (m) => (Number.isFinite(m.median) ? m.median.toFixed(3) + " (" + m.iqr.toFixed(3) + ")" : "-");
/** @param {number} x */
const pct = (x) => (x * 100).toFixed(1) + "%";

/**
 * Renders the human report.
 * @param {any} s A summary from summarise().
 * @param {{ compare?: Record<string, { current: number, other: number, delta: number }> | null }} options
 * @returns {string} Markdown.
 */
export function renderMarkdown(s, { compare = null } = {}) {
  const o = s.overall;
  const lines = [
    "# CADPrompt benchmark - " + (s.config.variant ?? "") + " prompts",
    "",
    "Model `" + (s.config.model ?? "?") + "`, Jev selector " + (s.config.jev === false ? "off" : "on") +
      ", " + o.n + " samples, dataset `" + (s.config.dataset ?? "?") + "`.",
    "",
    "## Headline",
    "",
    "| | IoGT ↑ | PC dist ↓ | Hausdorff ↓ | Compile ↑ | First pass ↑ | Exact IoU ↑ |",
    "|---|---|---|---|---|---|---|",
    "| **cad-gen** | " + mi(o.iogt) + " | " + mi(o.chamfer) + " | " + mi(o.hausdorff) + " | " + pct(o.compileRate) +
      " | " + pct(o.firstPassRate) + " | " + mi(o.iou) + (o.iouUnavailable ? " (" + o.iouUnavailable + " n/a)" : "") + " |",
    ...PAPER_BASELINES.map((b) => "| " + b.name + " | " + b.iogt[0].toFixed(3) + " (" + b.iogt[1].toFixed(3) + ") | " +
      b.chamfer[0].toFixed(3) + " (" + b.chamfer[1].toFixed(3) + ") | " + b.hausdorff[0].toFixed(3) + " (" +
      b.hausdorff[1].toFixed(3) + ") | " + pct(b.compileRate) + " | - | - |"),
    "",
    "Median (IQR); failures are penalised (distance √3, IoGT 0, IoU 0).",
    "",
  ];
  if (compare) {
    lines.push("## Compared with the other run", "", "| metric | this run | other | delta |", "|---|---|---|---|",
      ...Object.entries(compare).map(([k, v]) => "| " + k + " | " + v.current.toFixed(3) + " | " + v.other.toFixed(3) +
        " | " + (v.delta >= 0 ? "+" : "") + v.delta.toFixed(3) + " |"), "");
  }
  lines.push("## By stratum", "");
  if (!s.stratified) lines.push("_Unstratified: `unzip` or Data_Stratification.xlsx was unavailable._", "");
  for (const [key, title] of STRATA) {
    const groups = s.byStratum[key] ?? {};
    if (!Object.keys(groups).length) continue;
    lines.push("**" + title + "**", "", "| group | n | IoGT | PC dist | Compile | Exact IoU |", "|---|---|---|---|---|---|",
      ...Object.entries(groups).map(([g, a]) => "| " + g + " | " + a.n + " | " + mi(a.iogt) + " | " + mi(a.chamfer) +
        " | " + pct(a.compileRate) + " | " + mi(a.iou) + " |"), "");
  }
  lines.push("## Outcomes", "", "| outcome | count |", "|---|---|",
    ...Object.entries(s.outcomes).map(([k, v]) => "| " + k + " | " + v + " |"), "");
  if (Object.keys(s.failedGates).length) {
    lines.push("Failing gate after all repairs: " +
      Object.entries(s.failedGates).map(([g, n]) => "`" + g + "` " + n).join(", ") + ".", "");
  }
  if (s.wrongRefusals.length) {
    lines.push("**Wrong refusals** (every CADPrompt part is mechanical): " + s.wrongRefusals.join(", "), "");
  }
  const agreement = s.triageAgreement;
  lines.push("## Where to improve (Jev triage)", "",
    agreement?.rate != null
      ? "Jev agreed with hand labels on " + agreement.agreed + "/" + agreement.labelled + " (" + pct(agreement.rate) + ") samples."
      : "_Treat this table as advisory: no hand-labelled agreement check has been recorded yet " +
        "(fill triage-agreement.md, then run `--agreement`)._",
    "", "Triaged " + s.triage.triaged + " samples" + (s.triage.errors ? ", " + s.triage.errors + " Jev errors" : "") + ".", "");
  for (const [title, table] of /** @type {const} */ ([["Failure cause", "failureCause"], ["Shape mismatch", "shapeMismatch"]])) {
    const rows = Object.entries(s.triage[table]).sort((a, b) => b[1].sure.length - a[1].sure.length);
    if (!rows.length) continue;
    lines.push("**" + title + "**", "", "| label | sure | unsure | samples |", "|---|---|---|---|",
      ...rows.map(([label, v]) => "| " + label + " | " + v.sure.length + " | " + v.unsure.length + " | " +
        [...v.sure, ...v.unsure.map((id) => id + "?")].join(", ") + " |"), "");
  }
  if (s.triage.gateFalsePositiveRate != null) lines.push("Gate false-positive rate: " + pct(s.triage.gateFalsePositiveRate) + ".");
  if (s.triage.promptFixableRate != null) lines.push("Prompt/docs-fixable rate: " + pct(s.triage.promptFixableRate) + ".");
  lines.push("", "## Cost", "",
    "DeepSeek " + s.cost.deepseek.prompt + " in / " + s.cost.deepseek.completion + " out tokens; Jev " +
      s.cost.jev.prompt + " in tokens; " + (s.cost.durationMs / 60000).toFixed(1) + " sample-minutes.", "",
    "## Rewrites", "", "Rewrite kinds: " + Object.entries(s.rewrites).map(([k, v]) => k + " " + v).join(", ") + "." +
      (s.suspect.length ? " Suspect (read these): " + s.suspect.join(", ") + "." : ""), "",
    "## Deviations from the paper", "", ...DEVIATIONS.map((d) => "- " + d), "");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-summary.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add scripts/lib/bench-summary.mjs test/cad-gen/bench-summary.test.js
git commit -m "feat(cad-bench): summary aggregation, paper baselines, triage table and agreement check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The CLI (`cad-bench.mjs`), docs, and a live smoke run

**Files:**
- Create: `scripts/cad-bench.mjs`
- Modify: `packages/cad-gen/AGENTS.md` (Harnesses section)
- Test: `test/cad-gen/bench-cli.test.js`

**Interfaces:**
- Consumes: every module above. From `scripts/lib/cad-harness.mjs`: `PROJECT_ROOT`, `requireEnv()`, `loadCadKernel(): Promise<{ module, kernel }>`, and `cadGeneratorFrom(env)` (it enables Jev only when `env.JEV_API_KEY` is truthy).
- Produces: `parseArgs(argv)` (exported for the test), and `pool(items, concurrency, fn, shouldStop)`. `main()` runs only when the file is executed (`import.meta.main`).

- [ ] **Step 1: Write the failing test**

`test/cad-gen/bench-cli.test.js`:

```js
import { describe, expect, it } from "bun:test";
import path from "node:path";
import { parseArgs, pool } from "../../scripts/cad-bench.mjs";

describe("parseArgs", () => {
  it("defaults to the measured variant with Jev and triage on", () => {
    expect(parseArgs([])).toMatchObject({
      variants: ["measured"], limit: Infinity, ids: null, concurrency: 4, jev: true, triage: true,
      resume: null, compare: null, agreement: null,
    });
  });

  it("reads every flag", () => {
    const o = parseArgs(["--variant", "both", "--limit", "5", "--ids", "7,633", "--concurrency", "2",
      "--no-jev", "--no-triage", "--resume", "r", "--compare", "c", "--out", "o"]);
    expect(o).toMatchObject({
      variants: ["measured", "abstract"], limit: 5, ids: ["00000007", "00000633"], concurrency: 2,
      jev: false, triage: false, resume: path.resolve("r"), compare: path.resolve("c"), out: path.resolve("o"),
    });
  });

  it("rejects unknown flags and bad variants", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown argument --nope");
    expect(() => parseArgs(["--variant", "x"])).toThrow("--variant");
  });
});

describe("pool", () => {
  it("runs every item with bounded concurrency and stops when asked", async () => {
    let active = 0, peak = 0;
    const seen = [];
    await pool([1, 2, 3, 4, 5], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n); active--;
    }, () => false);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);

    const done = [];
    await pool([1, 2, 3, 4], 1, async (n) => { done.push(n); }, () => done.length >= 2);
    expect(done).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-cli.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `scripts/cad-bench.mjs`**

```js
/**
 * CADPrompt external benchmark for @arbesk/cad-gen.
 *
 * NOT part of the server. Runs the public CADPrompt benchmark (Alrashedy et
 * al., ICLR 2025: 200 text prompts with ground-truth meshes) through the
 * shipped loop - generate(), then the browser worker's kernel + gates + client
 * repair - and scores every part against ground truth with the paper's
 * metrics plus exact IoU. Failed and low-scoring samples are triaged by Jev
 * into a "where to improve" table. Spec:
 * docs/superpowers/specs/2026-10-04-cad-bench-cadprompt-design.md
 *
 * Usage:
 *   bun scripts/cad-bench.mjs [--variant measured|abstract|both] [--limit N] [--ids 7,633]
 *                             [--concurrency 4] [--no-jev] [--no-triage]
 *                             [--resume <runDir>] [--compare <runDir>] [--out <root>]
 *   bun scripts/cad-bench.mjs --agreement <runDir>   score a hand-labelled triage-agreement.md
 *
 * Reads DEEPSEEK_API_KEY (required) and JEV_API_KEY (optional) from the
 * project .env. Each run gets test-results/cad-bench/run#N/<variant>/ (gitignored).
 * The CADPrompt repository has no licence: it is fetched into test-results/
 * for local evaluation only - never commit it.
 */
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT, cadGeneratorFrom, loadCadKernel, requireEnv } from "./lib/cad-harness.mjs";
import { CADPROMPT_PIN, fetchCadPrompt, loadSamples } from "./lib/cadprompt.mjs";
import { runSample } from "./lib/bench-sample.mjs";
import { createScorer } from "./lib/bench-iou.mjs";
import { needsTriage, triage } from "./lib/bench-triage.mjs";
import {
  agreementTemplate, compareSummaries, parseAgreement, renderMarkdown, summarise,
} from "./lib/bench-summary.mjs";
import { writeBinaryStl } from "./lib/stl.mjs";

const DEFAULT_OUT = path.join(PROJECT_ROOT, "test-results", "cad-bench");

/** Consecutive provider errors that abort a run: likely a key or quota problem. */
const MAX_CONSECUTIVE_PROVIDER_ERRORS = 3;

/**
 * @param {string[]} argv Arguments after the script path.
 */
export function parseArgs(argv) {
  const opts = {
    variants: /** @type {("measured" | "abstract")[]} */ (["measured"]),
    limit: Infinity, ids: /** @type {string[] | null} */ (null), concurrency: 4,
    jev: true, triage: true,
    resume: /** @type {string | null} */ (null), compare: /** @type {string | null} */ (null),
    agreement: /** @type {string | null} */ (null), out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(flag + " needs a value");
      return v;
    };
    switch (flag) {
      case "--variant": {
        const v = value();
        if (!["measured", "abstract", "both"].includes(v)) throw new Error("--variant must be measured, abstract or both");
        opts.variants = v === "both" ? ["measured", "abstract"] : [/** @type {"measured" | "abstract"} */ (v)];
        break;
      }
      case "--limit": opts.limit = Number(value()); break;
      case "--ids": opts.ids = value().split(",").map((s) => s.trim().padStart(8, "0")); break;
      case "--concurrency": opts.concurrency = Math.max(1, Number(value())); break;
      case "--no-jev": opts.jev = false; break;
      case "--no-triage": opts.triage = false; break;
      case "--resume": opts.resume = path.resolve(value()); break;
      case "--compare": opts.compare = path.resolve(value()); break;
      case "--agreement": opts.agreement = path.resolve(value()); break;
      case "--out": opts.out = path.resolve(value()); break;
      default: throw new Error("unknown argument " + flag);
    }
  }
  return opts;
}

/**
 * Runs fn over items with at most `concurrency` in flight.
 * @remarks The kernel runs synchronously in process, so concurrency overlaps
 *   provider latency, not geometry.
 * @template T
 * @param {T[]} items @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn @param {() => boolean} shouldStop
 */
export async function pool(items, concurrency, fn, shouldStop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * Creates the next free run#N directory, like cad-eval's attempt#N.
 * @param {string} root
 * @returns {string}
 */
function nextRunDir(root) {
  fs.mkdirSync(root, { recursive: true });
  const taken = new Set(fs.readdirSync(root));
  let n = 1;
  while (taken.has("run#" + n)) n++;
  const dir = path.join(root, "run#" + n);
  fs.mkdirSync(dir);
  return dir;
}

/**
 * Writes JSON via a temp file and rename, so an interrupted run never leaves a
 * half-written result that --resume would then skip.
 * @param {string} file @param {unknown} value
 */
function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** @param {string} file @returns {any} */
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);

/**
 * Writes summary.json, summary.md and (first time only) triage-agreement.md.
 * @param {string} dir Variant directory.
 * @param {any[]} results @param {any} config @param {string | null} compareRun
 */
function writeSummary(dir, results, config, compareRun) {
  const summary = summarise(results, config);
  const previous = readJson(path.join(dir, "summary.json"));
  if (previous?.triageAgreement) summary.triageAgreement = previous.triageAgreement;
  const other = compareRun ? readJson(path.join(compareRun, config.variant, "summary.json")) : null;
  if (compareRun && !other) console.warn("no " + config.variant + " summary in " + compareRun + " to compare with");
  const compare = other ? compareSummaries(summary, other) : null;
  writeJsonAtomic(path.join(dir, "summary.json"), { ...summary, compare });
  fs.writeFileSync(path.join(dir, "summary.md"), renderMarkdown(summary, { compare }));
  const sheet = path.join(dir, "triage-agreement.md");
  if (summary.triage.triaged > 0 && !fs.existsSync(sheet)) fs.writeFileSync(sheet, agreementTemplate(results));
  console.log("summary: " + path.join(dir, "summary.md"));
}

/**
 * --agreement: score hand labels and re-render each variant's summary.
 * @param {string} runDir
 */
function recordAgreement(runDir) {
  for (const variant of ["measured", "abstract"]) {
    const dir = path.join(runDir, variant);
    const sheet = path.join(dir, "triage-agreement.md");
    const summary = readJson(path.join(dir, "summary.json"));
    if (!summary || !fs.existsSync(sheet)) continue;
    summary.triageAgreement = parseAgreement(fs.readFileSync(sheet, "utf8"));
    writeJsonAtomic(path.join(dir, "summary.json"), summary);
    fs.writeFileSync(path.join(dir, "summary.md"), renderMarkdown(summary, { compare: summary.compare ?? null }));
    console.log(variant + ": agreement " + JSON.stringify(summary.triageAgreement));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.agreement) return recordAgreement(opts.agreement);
  const env = requireEnv();
  if (!env.JEV_API_KEY && (opts.jev || opts.triage)) {
    console.warn("JEV_API_KEY missing from .env: running as --no-jev --no-triage");
    opts.jev = false;
    opts.triage = false;
  }
  const dataset = fetchCadPrompt();
  const runDir = opts.resume ?? nextRunDir(opts.out);
  console.log("run directory: " + runDir);
  const { module, kernel } = await loadCadKernel();
  const generator = cadGeneratorFrom(opts.jev ? env : { ...env, JEV_API_KEY: "" });
  const score = createScorer(module);
  const jev = opts.triage ? { apiKey: env.JEV_API_KEY } : null;
  const config = {
    dataset: CADPROMPT_PIN, model: env.CAD_MODEL || "deepseek-flash", thinking: Boolean(env.CAD_THINKING),
    jev: opts.jev, triage: opts.triage, samples: 8192, seed: 1,
  };

  for (const variant of opts.variants) {
    const dir = path.join(runDir, variant);
    fs.mkdirSync(dir, { recursive: true });
    let samples = loadSamples(dataset, variant);
    if (opts.ids) samples = samples.filter((s) => opts.ids?.includes(s.id));
    samples = samples.slice(0, opts.limit);
    const todo = samples.filter((s) => !fs.existsSync(path.join(dir, s.id + ".json")));
    console.log("\n" + variant + ": " + samples.length + " samples, " + todo.length + " to run");

    let consecutive = 0, aborted = false;
    await pool(todo, opts.concurrency, async (sample) => {
      const { result, mesh } = await runSample({ generator, kernel, score, sample });
      if (mesh) writeBinaryStl(path.join(dir, sample.id + ".stl"), mesh);
      if (jev && needsTriage(result)) result.triage = await triage(jev, result);
      writeJsonAtomic(path.join(dir, sample.id + ".json"), result);
      consecutive = result.outcome === "provider_error" ? consecutive + 1 : 0;
      if (consecutive >= MAX_CONSECUTIVE_PROVIDER_ERRORS) aborted = true;
      const m = result.metrics;
      console.log(sample.id + "  " + result.outcome.padEnd(14) + " iou " + (m.iou ?? NaN).toFixed(3) +
        "  iogt " + m.iogt.toFixed(3) + "  cd " + m.chamfer.toFixed(3) +
        (result.triage?.failureCause ? "  -> " + result.triage.failureCause.label : "") +
        (result.triage?.shapeMismatch ? "  -> " + result.triage.shapeMismatch.label : ""));
    }, () => aborted);

    if (aborted) {
      console.error("aborting: " + MAX_CONSECUTIVE_PROVIDER_ERRORS + " consecutive provider errors " +
        "(key or quota?). Continue with --resume " + runDir);
      process.exitCode = 1;
    }
    const results = samples.map((s) => readJson(path.join(dir, s.id + ".json"))).filter(Boolean);
    writeSummary(dir, results, { ...config, variant }, opts.compare);
    if (aborted) return;
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("HARNESS_FATAL", e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun scripts/run-tests.mjs test/cad-gen/bench-cli.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Document the harness**

In `packages/cad-gen/AGENTS.md`, under `## Harnesses`, add this bullet after the `cad-eval.mjs` bullet:

```markdown
- `scripts/cad-bench.mjs` — the **external score**: runs the public CADPrompt
  benchmark (200 prompts with ground-truth meshes, ICLR 2025) through the
  shipped loop and writes `summary.md` beside the paper's GPT-4/Gemini rows,
  plus exact IoU and a Jev-triaged "where to improve" table, under
  `test-results/cad-bench/run#N/`. CADPrompt has **no licence**: it is fetched
  into `test-results/` for local evaluation and must never be committed.
  Spec: `docs/superpowers/specs/2026-10-04-cad-bench-cadprompt-design.md`.
```

Change the next sentence from "Both harnesses import the package **source**" to "The harnesses import the package **source**".

- [ ] **Step 6: Full verification**

Run: `bun scripts/run-tests.mjs test/cad-gen/ && bun run lint && bun run typecheck`
Expected: every cad-gen suite PASS, including the 7 new `bench-*` files; lint and typecheck clean.

- [ ] **Step 7: Live smoke run (needs `DEEPSEEK_API_KEY`, and `JEV_API_KEY` for triage)**

Run: `bun scripts/cad-bench.mjs --limit 3 --concurrency 1`
Expected:
- `run directory: …/test-results/cad-bench/run#1`
- three lines like `00000007  built          iou 0.9xx  iogt 0.9xx  cd 0.0xx`
- `summary: …/run#1/measured/summary.md`

Then open `summary.md` and check:
- the headline table has a cad-gen row and 5 baseline rows
- the strata tables are present
- the Outcomes counts sum to 3
- the Deviations list is present
- each built sample has an `.stl` beside its `.json`

If a sample is triaged, `triage-agreement.md` exists.

Run: `bun scripts/cad-bench.mjs --limit 3 --concurrency 1 --no-jev --compare test-results/cad-bench/run#1`
Expected: a new `run#2`, whose `summary.md` has a "Compared with the other run" table.

Resume check: start `bun scripts/cad-bench.mjs --limit 3 --resume test-results/cad-bench/run#1`.
Expected: `measured: 3 samples, 0 to run`, and the summary is rewritten.

Report the smoke output (the three sample lines and the headline row) in the PR description. **Do not** paste prompt text or ground-truth data from CADPrompt into anything committed.

- [ ] **Step 8: Commit**

```bash
git add scripts/cad-bench.mjs test/cad-gen/bench-cli.test.js packages/cad-gen/AGENTS.md
git commit -m "feat(cad-bench): CADPrompt benchmark CLI with resume, Jev ablation and triage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage**

| Spec section | Where it's built |
|---|---|
| Decision log (benchmark, ×100, full loop, JS, Jev a+b) | Tasks 4, 5, 8, 6, 8 |
| Dataset facts (pin, files, xlsx, no licence) | Task 4, plus Global Constraints |
| Paper protocol and baseline rows | Tasks 2 and 7 (`PAPER_BASELINES`) |
| Architecture and targeted refactor | Task 1 |
| CLI flags | Task 8 `parseArgs` |
| `cadprompt.mjs` (fetch, load, strata, rewrite + fallback) | Task 4 |
| Per-sample flow, outcomes, timeout, `<variant>/<id>.json` | Tasks 5 and 8 |
| Scoring: metrics | Task 2 |
| Scoring: exact IoU | Task 3 |
| Jev triage (state, 4 questions, unsure, errors) | Task 6 |
| Trust check (`agreementTemplate` / `--agreement`) | Tasks 7 and 8 |
| Jev ablation (`--no-jev`, `--compare`, wrong-refusal rate) | Tasks 8 and 7 |
| Output files and summary sections | Tasks 7 and 8 |
| Error handling (missing keys, provider abort, atomic writes) | Task 8 |
| Testing (every listed test) | Tasks 1–8 |

**Type consistency**

- `RoundFailure { gate, error }` is defined in Task 1 and used in Tasks 5 and 6 (`clientFailures`).
- The `Sample` shape is defined in Task 4 and used in Tasks 5 and 8.
- The scorer signature `(mesh, truthPath) => { chamfer, hausdorff, iogt, iou, iouReason }` is defined in Task 3 and used in Tasks 5 and 8.
- The `SampleResult` fields are defined in Task 5 and used in Tasks 6 and 7.
- `triage` record fields (`failureCause`, `shapeMismatch`, `gateFalsePositive`, `promptFixable`, `usage`, `error`) are defined in Task 6 and used in Task 7.
- `Strata.difficulty` is defined in Task 4 and used in Task 7 `STRATA`.

**Placeholder scan:** none.

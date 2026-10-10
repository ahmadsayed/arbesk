# CAD Assembly Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CAD script `return [solidA, solidB, …]` so multi-part objects ship as separate, un-unioned parts at their assembled positions, end to end from kernel to 3MF/GLB.

**Architecture:** The kernel accepts a Manifold or an array of Manifolds, checks each, keeps them as a list (`KernelRunResult.parts`) and reports per-part stats (`stats.parts`), including recorded-but-never-failed overlaps. Gates count authored parts for array returns; single-solid returns keep today's behaviour exactly. The exporters write one object/node per part, and the browser worker and harnesses pass the part list through.

**Tech Stack:** TypeScript (Bun 1.4, tsgo builds), manifold-3d (WASM), fflate, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-10-cad-assembly-output-design.md`

## Global Constraints

- The server never executes generated code (cad-gen rulings S11/D3/D5) — nothing in this plan adds a server-side kernel run.
- Parts are never unioned: no `Manifold.compose`, `add`, `union` or boolean across parts anywhere in the pipeline.
- A single-Manifold return must produce the same mesh, the same existing stats fields and the same exporter output as today.
- Overlapping parts are recorded in `stats.parts.overlaps` and never fail a gate.
- `MAX_PARTS = 64`; overlap threshold is the existing `DEGENERATE_BODY_MM3` (1e-3 mm³); at most 8 overlaps listed.
- Part numbering in messages and file names is 1-based: `part 1`, `part-1`.
- `CONTRACT_VERSION` goes from 1 to 2; `PRELUDE_VERSION` is unchanged.
- Repo rules (AGENTS.md + HANDOVER.md): work only in this worktree, never in the main checkout; stage files by name; never commit `blockchain/deployments/*.json`, `.env*`, `tsconfig.worktree.json` or `test-results/`; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the pre-commit fallow audit can block a commit silently — run `git log --oneline -1` after every commit.
- Live harness output goes to `/tmp/...`, never `test-results/` (Playwright wipes it).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/cad-gen/src/types.ts` | modify | `CadStats.parts`, `CadStats.bodies.boxes[].part` |
| `packages/cad-gen/src/core/kernel.ts` | modify | array returns, per-part checks, `MAX_PARTS`, `concatMeshes`, part stats, overlaps |
| `packages/cad-gen/src/core/gates.ts` | modify | array-aware `connected` / `pieces`, `KernelLimits.maxBodiesPerPart`, repair texts |
| `packages/cad-gen/src/core/export/three-mf.ts` | modify | one `<object>` + `<item>` per part |
| `packages/cad-gen/src/core/export/glb.ts` | modify | one mesh + node per part under a root node |
| `packages/cad-gen/src/core/export/gltf.ts` | modify | accept a part list |
| `packages/cad-gen/src/core/contract.ts` | modify | `CONTRACT_VERSION = 2` |
| `packages/cad-gen/src/backend/prompt.ts` | modify | document the array return |
| `packages/cad-gen/AGENTS.md` | modify | document array returns + per-part gates |
| `frontend/src/js/workers/cad-render-core.ts` | modify | export `parts` |
| `src/api/generation-providers.ts` | modify | mock runtime uses `CONTRACT_VERSION` |
| `scripts/cad-eval.mjs`, `scripts/cad-smoke.mjs` | modify | handle array returns, export parts |
| `scripts/lib/client-repair.mjs` | modify | pass `maxBodiesPerPart` |
| `test/cad-gen/kernel-assembly.test.js` | create | real-geometry kernel tests (imports source, immune to stale dist) |
| `test/cad-gen/kernel.test.js`, `gates.test.js`, `exporters.test.js`, `prompt.test.js`, `package-wiring.test.js`, `test/frontend/cad-render-core.test.js` | modify | tests |

---

### Task 1: Kernel accepts an array of parts

**Files:**
- Modify: `packages/cad-gen/src/types.ts` (the `CadStats` interface)
- Modify: `packages/cad-gen/src/core/kernel.ts` (`KernelRunResult`, `assertManifold` at `:82`, `run()` at `:199`)
- Modify: `test/cad-gen/kernel.test.js` (the `toEqual` stats assertion at `:64-76`)
- Create: `test/cad-gen/kernel-assembly.test.js`

**Interfaces:**
- Produces: `KernelRunResult = { mesh: CadMesh; parts: CadMesh[]; stats: CadStats }`; `export const MAX_PARTS = 64`; `export function concatMeshes(meshes: CadMesh[]): CadMesh`; `CadStats.parts = { count: number; array: boolean; boxes: Box[]; bodyCounts: number[]; overlaps?: …; overlapCount?: number }`; `CadStats.bodies.boxes[i].part?: number` (1-based, array returns only).

- [ ] **Step 0: Make the worktree test its own packages**

Tests import `@arbesk/cad-gen` (the built `dist/`). In a worktree whose `node_modules` is a symlink to the main checkout, that resolves to the MAIN checkout's build — a false green. Replace the symlink with a real directory that links every entry from main except `@arbesk`, which points at this worktree's packages:

```bash
MAIN=/home/ahmedh/Projects/arbesk/node_modules
[ -L node_modules ] && rm node_modules && mkdir node_modules && \
for e in "$MAIN"/* "$MAIN"/.[!.]*; do n=$(basename "$e"); [ "$n" = "@arbesk" ] && continue; ln -s "$e" "node_modules/$n"; done && \
mkdir node_modules/@arbesk && for p in packages/*/; do n=$(basename "$p"); ln -s ../../packages/$n node_modules/@arbesk/$n; done
for d in /home/ahmedh/Projects/arbesk/packages/*/node_modules; do p=$(basename $(dirname $d)); [ -e packages/$p/node_modules ] || ln -s $d packages/$p/node_modules; done
readlink -f node_modules/@arbesk/cad-gen
bun run build:packages
```

Expected: the `readlink` prints a path inside this worktree, and the build ends without `Exited with code 1`. **After every source change in later steps, re-run `bun run build:packages` before running tests that import `@arbesk/cad-gen`.**

- [ ] **Step 1: Write the failing real-geometry tests**

Create `test/cad-gen/kernel-assembly.test.js`:

```js
/**
 * Kernel assembly output against the real Manifold module.
 * @remarks Imports the kernel SOURCE by relative path, so a stale built dist
 *   (or one resolved from another checkout) cannot make these pass.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import { createCadKernel, MAX_PARTS } from "../../packages/cad-gen/src/core/kernel.ts";

let kernel;
beforeAll(async () => {
  const Module = (await import("manifold-3d")).default;
  const module_ = await Module({
    locateFile: (f) => path.join(process.cwd(), "node_modules", "manifold-3d", f),
  });
  module_.setup();
  kernel = createCadKernel(module_, { segments: 64 });
});

const design = (code) => ({ code, parameters: { s: { value: 10, unit: "mm" } }, summary: "" });

describe("array returns", () => {
  it("keeps touching parts separate instead of fusing them", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(P.s, P.s, P.s).translate([P.s, 0, 0])];"));
    expect(run.parts.length).toBe(2);
    expect(run.stats.parts.count).toBe(2);
    expect(run.stats.parts.array).toBe(true);
    expect(run.stats.parts.bodyCounts).toEqual([1, 1]);
    expect(run.stats.bodies.count).toBe(2);
    expect(run.stats.volumeMm3).toBeCloseTo(2000, 3);
    expect(run.stats.parts.boxes[1].min[0]).toBeCloseTo(5, 3);
    expect(run.stats.bboxMm.min[0]).toBeCloseTo(-5, 3);
    expect(run.stats.bboxMm.max[0]).toBeCloseTo(15, 3);
    // The combined mesh is the parts laid side by side, not a union.
    expect(run.mesh.indices.length).toBe(run.parts[0].indices.length + run.parts[1].indices.length);
  });

  it("tags each body with the part it belongs to", () => {
    const run = kernel.run(design(
      "return [box(P.s, P.s, P.s), box(2, 2, 2).translate([30, 0, 0]).add(box(2, 2, 2).translate([40, 0, 0]))];",
    ));
    expect(run.stats.parts.bodyCounts).toEqual([1, 2]);
    expect(run.stats.bodies.boxes.map((b) => b.part)).toEqual([1, 2, 2]);
  });

  it("drops a part that is only a zero-volume flake", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(5, 5, 5).subtract(box(6, 6, 6))];"));
    expect(run.stats.parts.count).toBe(1);
    expect(run.parts.length).toBe(1);
    expect(run.stats.degenerateBodiesDropped).toBe(1);
  });

  it("reports an empty array as an empty result for the nonempty gate", () => {
    const run = kernel.run(design("P.s; return [];"));
    expect(run.stats.triangles).toBe(0);
    expect(run.stats.parts.count).toBe(0);
    expect(run.stats.bboxMm).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  it("names the part that is not a Manifold", () => {
    expect(() => kernel.run(design("return [box(P.s, P.s, P.s), 42];")))
      .toThrow("part 2: did not return a Manifold");
  });

  it("refuses more than MAX_PARTS parts", () => {
    const code = "P.s; const out = []; for (let i = 0; i < " + (MAX_PARTS + 1) + "; i++) out.push(box(1, 1, 1).translate([i * 2, 0, 0])); return out;";
    expect(() => kernel.run(design(code))).toThrow("at most " + MAX_PARTS);
  });
});

describe("single-solid returns", () => {
  it("are one part, with the same mesh as before", () => {
    const run = kernel.run(design("return box(P.s, P.s, P.s);"));
    expect(run.parts.length).toBe(1);
    expect(run.parts[0]).toBe(run.mesh);
    expect(run.stats.parts).toEqual({
      count: 1, array: false, boxes: [run.stats.bboxMm], bodyCounts: [1],
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun scripts/run-tests.mjs test/cad-gen/kernel-assembly.test.js`
Expected: FAIL — `MAX_PARTS` is undefined and `run.parts` is undefined.

- [ ] **Step 3: Extend the stats types**

In `packages/cad-gen/src/types.ts`, replace the `bodies?:` line and add `parts?:` after `degenerateBodiesDropped`:

```ts
  bodies?: {
    count: number;
    /** `part` is the 1-based part a body belongs to; set for array returns only. */
    boxes: { min: [number, number, number]; max: [number, number, number]; part?: number }[];
  };
  /** Zero-volume flakes the kernel removed from the solid (see DEGENERATE_BODY_MM3). */
  degenerateBodiesDropped?: number;
  /**
   * The parts the script returned.
   * @remarks `array` is true when the script returned an array of solids;
   *   parts in an array are never unioned, so they cannot fuse. A single
   *   solid is one part. `bodyCounts[i]` is how many connected bodies part
   *   i+1 has. Overlaps between parts are recorded, never failed.
   */
  parts?: {
    count: number;
    array: boolean;
    boxes: { min: [number, number, number]; max: [number, number, number] }[];
    bodyCounts: number[];
    overlaps?: { a: number; b: number; volumeMm3: number }[];
    overlapCount?: number;
  };
```

(The existing `degenerateBodiesDropped` line moves inside this block — keep exactly one copy of it.)

- [ ] **Step 4: Implement array returns in the kernel**

In `packages/cad-gen/src/core/kernel.ts`:

Replace `KernelRunResult`:

```ts
export interface KernelRunResult {
  /** Every part's mesh laid side by side (never unioned). */
  mesh: CadMesh;
  /** One mesh per returned part, in the script's order. */
  parts: CadMesh[];
  stats: CadStats;
}
```

Replace `assertManifold` (keep its doc comment, add `@param label`):

```ts
function assertManifold(result: any, module: ManifoldModule, label = ""): any {
  if (!(result instanceof module.Manifold)) {
    throw new CadKernelError(label ? label + "did not return a Manifold" : "script did not return a Manifold");
  }
  const status = result.status();
  if (status !== "NoError") {
    throw new CadKernelError(label + "kernel status: " + String(status));
  }
  return result;
}

/** Most parts a script may return: a bound for the browser worker, not a design rule. */
export const MAX_PARTS = 64;

/**
 * The script's return as checked parts, and whether it was an array.
 * @throws CadKernelError naming the 1-based part that is not a usable Manifold,
 *   or when there are more than MAX_PARTS.
 */
function partsOf(result: unknown, module: ManifoldModule): { solids: any[]; array: boolean } {
  if (!Array.isArray(result)) return { solids: [assertManifold(result, module)], array: false };
  if (result.length > MAX_PARTS) {
    throw new CadKernelError("script returned " + result.length + " parts; at most " + MAX_PARTS + " are allowed");
  }
  return { solids: result.map((r, i) => assertManifold(r, module, "part " + (i + 1) + ": ")), array: true };
}

/**
 * Lays meshes side by side in one mesh, offsetting each one's indices.
 * @remarks Concatenation, never a union: touching parts stay separate and
 *   overlapping ones cannot produce a non-manifold result.
 */
export function concatMeshes(meshes: CadMesh[]): CadMesh {
  const positions = new Float32Array(meshes.reduce((n, m) => n + m.positions.length, 0));
  const indices = new Uint32Array(meshes.reduce((n, m) => n + m.indices.length, 0));
  let p = 0;
  let i = 0;
  for (const m of meshes) {
    const base = p / 3;
    positions.set(m.positions, p);
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k] + base;
    p += m.positions.length;
    i += m.indices.length;
  }
  return { positions, indices };
}
```

Add, after `bodiesOf`:

```ts
type Box = { min: [number, number, number]; max: [number, number, number] };

/** The bounds of every non-empty box, or the empty-solid zeros when there are none. */
function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) return { min: [...EMPTY_BBOX], max: [...EMPTY_BBOX] };
  const min = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
  const max = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
  return { min: min as Box["min"], max: max as Box["max"] };
}

/** Every part's bodies, tagged with their 1-based part, plus each part's body count. */
function partBodiesOf(solids: any[]): { bodies?: CadStats["bodies"]; bodyCounts: number[] } {
  if (solids.length === 0 || typeof solids[0].decompose !== "function") {
    return { bodyCounts: solids.map(() => 1) };
  }
  const tagged = solids.map((s, i) => s.decompose().filter((p: any) => !isDegenerate(p))
    .map((p: any) => ({ volume: p.volume(), box: p.boundingBox() as ManifoldBox, part: i + 1 })));
  const all = tagged.flat().sort((a, b) => b.volume - a.volume);
  return {
    bodies: {
      count: all.length,
      boxes: all.slice(0, MAX_BODY_BOXES).map(({ box, part }) => ({
        min: [...box.min] as Box["min"], max: [...box.max] as Box["max"], part,
      })),
    },
    bodyCounts: tagged.map((t) => t.length),
  };
}

/** Stats for an array return: totals over the parts, plus per-part facts. */
function arrayStatsFrom(solids: any[], helpers: PreludeHelpers): CadStats {
  const boxes: Box[] = solids.map((s) => {
    const b = boundsOf(s, s.numTri());
    return { min: [...b.min] as Box["min"], max: [...b.max] as Box["max"] };
  });
  const { bodies, bodyCounts } = partBodiesOf(solids);
  return {
    triangles: solids.reduce((n, s) => n + s.numTri(), 0),
    vertices: solids.reduce((n, s) => n + s.numVert(), 0),
    volumeMm3: solids.reduce((n, s) => n + s.volume(), 0),
    bboxMm: unionBox(boxes.filter((_b, i) => solids[i].numTri() > 0)),
    ...(helpers.lastFilletMode ? { filletMode: helpers.lastFilletMode } : {}),
    ...(helpers.lastFilletQuality ? { filletQuality: helpers.lastFilletQuality } : {}),
    ...(bodies ? { bodies } : {}),
    parts: { count: solids.length, array: true, boxes, bodyCounts },
  };
}
```

Replace the body of `run()`:

```ts
    run(design: CadDesign): KernelRunResult {
      const helpers = buildPrelude(module, options);
      const fn = compileScript(design.code, names);
      const { solids: raw, array } = partsOf(
        callScript(fn, parameterValues(design), module, helpers, names),
        module,
      );
      if (!array) {
        const { solid: result, dropped } = withoutFlakes(module, raw[0]);
        const stats = statsFrom(result, helpers);
        const mesh = meshFrom(result.getMesh());
        const parts = {
          count: 1, array: false, boxes: [stats.bboxMm], bodyCounts: [stats.bodies?.count ?? 1],
        };
        return {
          mesh,
          parts: [mesh],
          stats: { ...stats, ...(dropped > 0 ? { degenerateBodiesDropped: dropped } : {}), parts },
        };
      }
      const cleaned = raw.map((s) => withoutFlakes(module, s));
      // A part that is nothing but a flake is not a part.
      const solids = cleaned.map((c) => c.solid).filter((s) => !isDegenerate(s));
      const dropped = cleaned.reduce((n, c) => n + c.dropped, 0) + (cleaned.length - solids.length);
      const parts = solids.map((s) => meshFrom(s.getMesh()));
      const stats = arrayStatsFrom(solids, helpers);
      return {
        mesh: concatMeshes(parts),
        parts,
        stats: dropped > 0 ? { ...stats, degenerateBodiesDropped: dropped } : stats,
      };
    },
```

Note the single-solid branch keeps today's field order for every existing stat and only appends `parts`.

- [ ] **Step 5: Update the fake-module kernel test for the new `parts` stat**

In `test/cad-gen/kernel.test.js`, in "accepts a real instance of the injected Manifold class", replace the `expect(stats).toEqual({...})` block with:

```js
    expect(stats).toEqual({
      triangles: 2,
      vertices: 4,
      volumeMm3: 1,
      bboxMm: { min: [0, 0, 0], max: [1, 1, 1] },
      parts: { count: 1, array: false, boxes: [{ min: [0, 0, 0], max: [1, 1, 1] }], bodyCounts: [1] },
    });
```

and add this test at the end of the `describe("createCadKernel")` block:

```js
  it("concatenates an array's parts with offset indices", () => {
    const kernel = createCadKernel(MODULE);
    const { mesh, parts, stats } = kernel.run(design("return [new M(), new M()];"));
    expect(parts.length).toBe(2);
    expect(stats.triangles).toBe(4);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 1, 3, 4, 5, 6, 4, 5, 7]);
  });
```

Also re-export `MAX_PARTS` and `concatMeshes` from the package: in `packages/cad-gen/src/index.ts`, change `export { createCadKernel } from "./core/kernel.ts";` to `export { concatMeshes, createCadKernel, MAX_PARTS } from "./core/kernel.ts";`.

- [ ] **Step 6: Run the tests**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/cad-gen/kernel-assembly.test.js test/cad-gen/kernel.test.js test/cad-gen/prelude.test.js`
Expected: all PASS. (`prelude.test.js` runs real geometry through the validation child and proves single-solid stats are unchanged apart from the added `parts`.)

- [ ] **Step 7: Typecheck and commit**

```bash
bun run typecheck
bunx eslint packages/cad-gen/src/core/kernel.ts packages/cad-gen/src/types.ts packages/cad-gen/src/index.ts test/cad-gen/kernel-assembly.test.js test/cad-gen/kernel.test.js
git add packages/cad-gen/src/core/kernel.ts packages/cad-gen/src/types.ts packages/cad-gen/src/index.ts test/cad-gen/kernel-assembly.test.js test/cad-gen/kernel.test.js
git commit -m "feat(cad-gen): kernel accepts an array of parts, never unioned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: the log shows the new commit (if it shows the previous one, the fallow audit blocked it — run `bunx fallow@3.20.0 audit --changed-since HEAD` and fix the finding).

---

### Task 2: Record overlapping parts

**Files:**
- Modify: `packages/cad-gen/src/core/kernel.ts` (`arrayStatsFrom` from Task 1)
- Modify: `test/cad-gen/kernel-assembly.test.js`
- Modify: `test/cad-gen/kernel.test.js`

**Interfaces:**
- Consumes: `arrayStatsFrom(solids, helpers)`, `Box` from Task 1.
- Produces: `stats.parts.overlaps?: { a: number; b: number; volumeMm3: number }[]` (largest first, ≤ 8) and `stats.parts.overlapCount?: number`; both absent when no pair overlaps.

- [ ] **Step 1: Write the failing tests**

Append to `test/cad-gen/kernel-assembly.test.js`:

```js
describe("overlaps", () => {
  it("records parts that overlap, with the shared volume", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(P.s, P.s, P.s).translate([5, 0, 0])];"));
    expect(run.stats.parts.overlapCount).toBe(1);
    expect(run.stats.parts.overlaps[0].a).toBe(1);
    expect(run.stats.parts.overlaps[0].b).toBe(2);
    expect(run.stats.parts.overlaps[0].volumeMm3).toBeCloseTo(500, 3);
  });

  it("does not count parts that only touch", () => {
    const run = kernel.run(design("return [box(P.s, P.s, P.s), box(P.s, P.s, P.s).translate([P.s, 0, 0])];"));
    expect(run.stats.parts.overlaps).toBeUndefined();
    expect(run.stats.parts.overlapCount).toBeUndefined();
  });
});
```

In `test/cad-gen/kernel.test.js`, give `FakeManifold` an `intersect` method (Task 1's "concatenates an array's parts" test returns two fakes with identical boxes, so the overlap check will call it). Add inside `class FakeManifold`, after `getMesh()`:

```js
  intersect() { return new EmptyManifold(); }
```

(`EmptyManifold` is declared later in the file; that is fine because the method only runs at call time.) Then append to `describe("createCadKernel")`:

```js
  it("never intersects parts whose boxes are apart", () => {
    let calls = 0;
    class Far extends FakeManifold {
      boundingBox() { return { min: [50, 0, 0], max: [51, 1, 1] }; }
      intersect() { calls++; return new FakeManifold(); }
    }
    class Spy extends FakeManifold {
      intersect() { calls++; return new FakeManifold(); }
    }
    const kernel = createCadKernel({ Manifold: FakeManifold, CrossSection: class {} });
    globalThis.__far = () => new Far();
    globalThis.__spy = () => new Spy();
    kernel.run(design("return [globalThis.__spy(), globalThis.__far()];"));
    expect(calls).toBe(0);
    delete globalThis.__far;
    delete globalThis.__spy;
  });
```

(`Far` and `Spy` extend `FakeManifold`, so they pass the kernel's `instanceof` check.)

- [ ] **Step 2: Run them to verify they fail**

Run: `bun scripts/run-tests.mjs test/cad-gen/kernel-assembly.test.js`
Expected: FAIL — `overlapCount` is undefined in the first overlap test.

- [ ] **Step 3: Implement overlap recording**

In `packages/cad-gen/src/core/kernel.ts`, add after `partBodiesOf`:

```ts
/** Overlapping part pairs listed in stats; past this the count says enough. */
const MAX_OVERLAPS = 8;

/** Whether two boxes share interior volume; boxes that only touch do not. */
function boxesMeet(a: Box, b: Box): boolean {
  return [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
}

/**
 * Part pairs whose solids share more than DEGENERATE_BODY_MM3.
 * @remarks Recorded, never failed: a pin in its hole overlaps by design, and
 *   printing at assembled positions is out of scope (spec decision 4). Only
 *   pairs whose boxes meet are intersected, so disjoint parts cost box checks.
 */
function overlapsOf(solids: any[], boxes: Box[]): Pick<NonNullable<CadStats["parts"]>, "overlaps" | "overlapCount"> {
  const found: { a: number; b: number; volumeMm3: number }[] = [];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (!boxesMeet(boxes[i], boxes[j])) continue;
      const volumeMm3 = solids[i].intersect(solids[j]).volume();
      if (volumeMm3 > DEGENERATE_BODY_MM3) found.push({ a: i + 1, b: j + 1, volumeMm3 });
    }
  }
  if (found.length === 0) return {};
  found.sort((x, y) => y.volumeMm3 - x.volumeMm3);
  return { overlaps: found.slice(0, MAX_OVERLAPS), overlapCount: found.length };
}
```

In `arrayStatsFrom`, replace the `parts:` line with:

```ts
    parts: { count: solids.length, array: true, boxes, bodyCounts, ...overlapsOf(solids, boxes) },
```

- [ ] **Step 4: Run the tests**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/cad-gen/kernel-assembly.test.js test/cad-gen/kernel.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
bunx eslint packages/cad-gen/src/core/kernel.ts test/cad-gen/kernel-assembly.test.js test/cad-gen/kernel.test.js
git add packages/cad-gen/src/core/kernel.ts test/cad-gen/kernel-assembly.test.js test/cad-gen/kernel.test.js
git commit -m "feat(cad-gen): record overlapping parts in stats, never fail them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 3: Gates count authored parts

**Files:**
- Modify: `packages/cad-gen/src/core/gates.ts` (`KernelLimits`, `fusedError` at `:138`, `connectedGate` `:208`, `piecesGate` `:215`, `evaluateKernelGates` `:222`)
- Modify: `scripts/lib/client-repair.mjs:53-54`
- Modify: `test/cad-gen/gates.test.js` (the pieces test at `:121-134`)

**Interfaces:**
- Consumes: `CadStats.parts` and `bodies.boxes[].part` from Task 1.
- Produces: `KernelLimits.maxBodiesPerPart?: number` (1 when absent). For an array return: `connected` fails when `parts.count > maxBodies` or a part has more than `maxBodiesPerPart` bodies; `pieces` fails when `parts.count < minBodies`. Single-solid returns: unchanged.

- [ ] **Step 1: Write the failing tests**

In `test/cad-gen/gates.test.js`, in "fails the pieces gate when separate pieces came out fused", replace `expect(at(1, 2).error).toContain("at least 2mm");` with:

```js
    expect(at(1, 2).error).toContain("return them as an array");
    expect(at(1, 2).error).not.toContain("print bed");
```

Append inside `describe("evaluateKernelGates")`:

```js
  describe("array returns", () => {
    const box = (part) => ({ min: [0, 0, 0], max: [1, 1, 1], part });
    const arrayStats = (bodyCounts) => ({
      ...stats,
      bodies: { count: bodyCounts.reduce((a, b) => a + b, 0), boxes: bodyCounts.flatMap((n, i) => Array(n).fill(box(i + 1))) },
      parts: { count: bodyCounts.length, array: true, boxes: bodyCounts.map(() => box()), bodyCounts },
    });
    const gate = (s, limits, name) => evaluateKernelGates(s, { ...LIMITS, ...limits }).find((g) => g.gate === name);

    it("passes a two-part clamp returned as an array", () => {
      expect(gate(arrayStats([1, 1]), { maxBodies: 2, minBodies: 2 }, "connected").ok).toBe(true);
      expect(gate(arrayStats([1, 1]), { maxBodies: 2, minBodies: 2 }, "pieces").ok).toBe(true);
    });

    it("fails pieces when the array has too few parts, pointing at the array", () => {
      const pieces = gate(arrayStats([1]), { maxBodies: 2, minBodies: 2 }, "pieces");
      expect(pieces.ok).toBe(false);
      expect(pieces.error).toContain("returns 1 part");
      expect(pieces.error).toContain("one solid per piece");
    });

    it("fails connected when the array has more parts than allowed", () => {
      const connected = gate(arrayStats([1, 1, 1]), { maxBodies: 2 }, "connected");
      expect(connected.ok).toBe(false);
      expect(connected.error).toContain("returns 3 parts");
    });

    it("fails connected when one part falls apart, naming the part", () => {
      const connected = gate(arrayStats([1, 2]), { maxBodies: 2 }, "connected");
      expect(connected.ok).toBe(false);
      expect(connected.error).toContain("part 2 of the returned array is 2 separate bodies");
    });

    it("lets a multi-body helper's part keep its bodies", () => {
      expect(gate(arrayStats([1, 2]), { maxBodies: 2, maxBodiesPerPart: 2 }, "connected").ok).toBe(true);
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/cad-gen/gates.test.js`
Expected: FAIL — the pieces text still says "print bed", and the array tests fail.

- [ ] **Step 3: Implement the gates**

In `packages/cad-gen/src/core/gates.ts`, add to `KernelLimits` after `minBodies`:

```ts
  /**
   * Most bodies one part of an ARRAY return may have; 1 when absent. Above 1
   * only for a part built by a multi-body helper - see bodyAllowance with no
   * piece count.
   */
  maxBodiesPerPart?: number;
```

Replace the last sentence block of `fusedError`'s returned string — from `"comes off or slides). Pieces that touch or overlap merge into one body. Build each piece as "` to the end — with:

```ts
    "comes off or slides). Pieces that touch or overlap merge into one body. Build each piece as " +
    "its own solid and return them as an array, one solid per piece, each where it sits in the " +
    "assembled object: return [pieceA, pieceB]. Parts in an array are never fused, so they may " +
    "touch. Do not join the pieces with a bridge, rib or pin; bolt holes that join them in use " +
    "go through each piece.";
```

Add after `fusedError`:

```ts
/** The pieces-gate failure for an array return: too few parts in the array. */
function tooFewPartsError(count: number, wanted: number): string {
  const want = wanted >= 5 ? "5 or more" : String(wanted);
  return "the design returns " + count + " part" + (count === 1 ? "" : "s") + ", but the request " +
    "needs " + want + " SEPARATE pieces. Return one solid per piece in the array, each where it " +
    "sits in the assembled object: return [pieceA, pieceB].";
}

/** The connected-gate failure for an array return with more parts than allowed. */
function tooManyPartsError(count: number, allowed: number): string {
  return "the design returns " + count + " parts, but the request needs at most " + allowed +
    ". Combine features that belong to one piece into one solid before returning the array.";
}

/** The connected-gate failure for one array part that fell apart. */
function splitPartError(part: number, bodies: CadStats["bodies"]): string {
  const own = (bodies?.boxes ?? []).filter((b) => b.part === part);
  return "part " + part + " of the returned array " +
    disconnectedError({ count: own.length, boxes: own }, 1).slice("the part ".length);
}
```

Replace `connectedGate`, `piecesGate` and their two calls:

```ts
/** Caps bodies (or, for an array return, parts and bodies per part) from above. */
function connectedGate(stats: CadStats, max: number, perPart: number): GateResult {
  const parts = stats.parts;
  if (parts?.array) {
    if (parts.count > max) return { gate: "connected", ok: false, error: tooManyPartsError(parts.count, max) };
    const split = parts.bodyCounts.findIndex((n) => n > perPart);
    return split === -1
      ? { gate: "connected", ok: true }
      : { gate: "connected", ok: false, error: splitPartError(split + 1, stats.bodies) };
  }
  const bodies = stats.bodies;
  return bodies === undefined || bodies.count <= max
    ? { gate: "connected", ok: true }
    : { gate: "connected", ok: false, error: disconnectedError(bodies, max) };
}

/** Floors bodies (or, for an array return, parts) from below. */
function piecesGate(stats: CadStats, min: number): GateResult {
  const parts = stats.parts;
  if (parts?.array) {
    return parts.count >= min
      ? { gate: "pieces", ok: true }
      : { gate: "pieces", ok: false, error: tooFewPartsError(parts.count, min) };
  }
  const bodies = stats.bodies;
  return bodies === undefined || bodies.count >= min
    ? { gate: "pieces", ok: true }
    : { gate: "pieces", ok: false, error: fusedError(bodies.count, min) };
}
```

and in `evaluateKernelGates`:

```ts
    connectedGate(stats, limits.maxBodies ?? 1, limits.maxBodiesPerPart ?? 1),
    piecesGate(stats, limits.minBodies ?? 1),
```

- [ ] **Step 4: Pass the per-part allowance in the harness**

In `scripts/lib/client-repair.mjs`, replace lines 53-54:

```js
      const maxBodies = bodyAllowance(design.code, pieces);
      // A part of an array return may have more than one body only when a
      // multi-body helper built it: the helper floor, without Jev's count.
      const maxBodiesPerPart = bodyAllowance(design.code);
      const failed = evaluateKernelGates(run.stats, { maxTriangles: MAX_TRIANGLES, maxBodies, maxBodiesPerPart, minBodies })
```

- [ ] **Step 5: Run the tests**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/cad-gen/gates.test.js test/cad-gen/bench-client-repair.test.js`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
bunx eslint packages/cad-gen/src/core/gates.ts scripts/lib/client-repair.mjs test/cad-gen/gates.test.js
git add packages/cad-gen/src/core/gates.ts scripts/lib/client-repair.mjs test/cad-gen/gates.test.js
git commit -m "feat(cad-gen): gates count authored parts for array returns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 4: Exporters write one object per part

**Files:**
- Modify: `packages/cad-gen/src/core/export/three-mf.ts` (`buildModelXml`, `meshTo3mf`)
- Modify: `packages/cad-gen/src/core/export/glb.ts` (`buildPartDocument`, `meshToGlb`)
- Modify: `packages/cad-gen/src/core/export/gltf.ts` (`meshToGltf`)
- Modify: `test/cad-gen/exporters.test.js`

**Interfaces:**
- Produces: `meshTo3mf(mesh: CadMesh | CadMesh[], design)`, `meshToGlb(mesh: CadMesh | CadMesh[], design)`, `meshToGltf(mesh: CadMesh | CadMesh[], design)`, `buildPartDocument(mesh: CadMesh | CadMesh[], design)`. A single mesh or a one-element list writes exactly today's output.

- [ ] **Step 1: Confirm today's GLB golden hash**

The single-part GLB must stay byte-identical. Its hash, computed from the pre-change exporter on 2026-10-10, is `0e8be950237282089adbccf95a051277b2ea05444b3a280d1428d6f894aa5e4a`. Confirm it before changing anything:

```bash
bun -e 'import { meshToGlb } from "./packages/cad-gen/src/core/export/glb.ts";
const MESH = { positions: new Float32Array([0,0,0,10,0,0,0,10,0,0,0,10]), indices: new Uint32Array([0,2,1,0,1,3,0,3,2,1,2,3]) };
const DESIGN = { code: "return box(P.s, P.s, P.s);", parameters: { s: { value: 10, unit: "mm" } }, summary: "cube", turn: 2 };
console.log(new Bun.CryptoHasher("sha256").update(meshToGlb(MESH, DESIGN)).digest("hex"));'
```

Expected: `0e8be950237282089adbccf95a051277b2ea05444b3a280d1428d6f894aa5e4a`. If it differs, the exporter changed since this plan was written — stop and report it.

- [ ] **Step 2: Write the failing tests**

In `test/cad-gen/exporters.test.js`, add to the imports at the top of the file:

```js
import { parse3mfModel } from "@arbesk/asset-core/formats/3mf/parser.js";
```

Then append (the file already defines `MESH`, `DESIGN`, `readGlbJson` and imports `unzipSync`, `strFromU8`):

```js
/** sha256 of meshToGlb(MESH, DESIGN) from the pre-assembly exporter. */
const GOLDEN_GLB_SHA256 = "0e8be950237282089adbccf95a051277b2ea05444b3a280d1428d6f894aa5e4a";

/** MESH moved 20 mm along x: a second part. */
const SHIFTED = {
  positions: MESH.positions.map((v, i) => (i % 3 === 0 ? v + 20 : v)),
  indices: MESH.indices,
};

const modelXml = (bytes) => strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
const sha256 = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

describe("multi-part export", () => {
  it("writes a single mesh exactly as before", () => {
    expect(sha256(meshToGlb(MESH, DESIGN))).toBe(GOLDEN_GLB_SHA256);
    expect(sha256(meshToGlb([MESH], DESIGN))).toBe(GOLDEN_GLB_SHA256);
    expect(modelXml(meshTo3mf([MESH], DESIGN))).toBe(modelXml(meshTo3mf(MESH, DESIGN)));
    expect(modelXml(meshTo3mf(MESH, DESIGN))).toContain('<object id="1" type="model">');
  });

  it("writes one 3MF object and build item per part, at the authored coordinates", () => {
    const xml = modelXml(meshTo3mf([MESH, SHIFTED], DESIGN));
    expect(xml).toContain('<object id="1" name="part-1" type="model">');
    expect(xml).toContain('<object id="2" name="part-2" type="model">');
    expect(xml).toContain('<item objectid="1"/>');
    expect(xml).toContain('<item objectid="2"/>');
    const parsed = parse3mfModel(xml);
    expect(parsed.objects.length).toBe(2);
    // parse3mfModel returns flat [x, y, z, x, y, z, ...] vertices.
    const xs = parsed.objects[1].vertices.filter((_v, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(20);
  });

  it("writes one GLB mesh and node per part under one root node", () => {
    const json = readGlbJson(meshToGlb([MESH, SHIFTED], DESIGN));
    expect(json.scenes[0].nodes).toEqual([0]);
    expect(json.nodes[0].children).toEqual([1, 2]);
    expect(json.nodes[0].matrix).toBeDefined();
    expect(json.nodes.slice(1).map((n) => n.name)).toEqual(["part-1", "part-2"]);
    expect(json.meshes.length).toBe(2);
    expect(json.accessors.length).toBe(6);
    expect(json.bufferViews.every((v) => v.byteOffset % 4 === 0)).toBe(true);
    expect(json.asset.extras.arbesk_cad).toEqual(DESIGN);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/cad-gen/exporters.test.js`
Expected: FAIL — `meshToGlb([MESH], …)` throws or hashes differently, and the multi-part tests fail.

- [ ] **Step 4: Implement multi-part 3MF**

In `packages/cad-gen/src/core/export/three-mf.ts`, replace `buildModelXml` and `meshTo3mf`:

```ts
/** One `<object>` element for a part; a lone part keeps today's unnamed form. */
function objectXml(mesh: CadMesh, id: number, name?: string): string[] {
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
    '    <object id="' + id + '"' + (name ? ' name="' + name + '"' : "") + ' type="model">',
    "      <mesh>",
    "        <vertices>",
    verts.join("\n"),
    "        </vertices>",
    "        <triangles>",
    tris.join("\n"),
    "        </triangles>",
    "      </mesh>",
    "    </object>",
  ];
}

/**
 * Renders the 3MF core-spec model part: one object and one build item per part.
 * @remarks Items carry no transform: the vertices are already at the
 *   assembled positions. Parts are named part-1..n only when there are several.
 */
function buildModelXml(meshes: CadMesh[]): string {
  const named = meshes.length > 1;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" ' +
      'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '  <metadata name="Application">Arbesk CAD</metadata>',
    "  <resources>",
    ...meshes.flatMap((m, i) => objectXml(m, i + 1, named ? "part-" + (i + 1) : undefined)),
    "  </resources>",
    "  <build>",
    ...meshes.map((_m, i) => '    <item objectid="' + (i + 1) + '"/>'),
    "  </build>",
    "</model>",
  ].join("\n");
}

/**
 * Serialises a mesh (or one mesh per part) plus its design document to .3mf bytes.
 * @remarks The design travels as a declared OPC part, so the package alone
 *   reconstructs the design state - and therefore its licence credits.
 */
export function meshTo3mf(mesh: CadMesh | CadMesh[], design: CadDesign): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    [MODEL_PATH]: strToU8(buildModelXml(Array.isArray(mesh) ? mesh : [mesh])),
    [SIDECAR_PART_PATH]: strToU8(serializeDesign(design)),
  }, { level: 6 });
}
```

- [ ] **Step 5: Implement multi-part GLB/glTF**

In `packages/cad-gen/src/core/export/glb.ts`, replace `buildPartDocument` and `meshToGlb` (keep `computeNormals`, `bytesOf`, `positionBounds`, `packChunk` as they are):

```ts
/**
 * One part's binary run, buffer views, accessors and primitive.
 * @param byteBase Where the run starts in the shared buffer (4-byte aligned).
 * @param viewBase Index of the part's first buffer view (= its first accessor).
 */
function partBuffers(mesh: CadMesh, byteBase: number, viewBase: number) {
  const normals = computeNormals(mesh);
  const indexBytes = bytesOf(mesh.indices);
  const posBytes = bytesOf(mesh.positions);
  const normalBytes = bytesOf(normals);
  const { bin, posOffset, normalOffset } = packChunk(indexBytes, posBytes, normalBytes);
  const bounds = positionBounds(mesh.positions);
  return {
    bin,
    bufferViews: [
      { buffer: 0, byteOffset: byteBase, byteLength: indexBytes.length, target: 34963 },
      { buffer: 0, byteOffset: byteBase + posOffset, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: byteBase + normalOffset, byteLength: normalBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: viewBase, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
      {
        bufferView: viewBase + 1, componentType: 5126, count: mesh.positions.length / 3, type: "VEC3",
        min: bounds.min, max: bounds.max,
      },
      { bufferView: viewBase + 2, componentType: 5126, count: normals.length / 3, type: "VEC3" },
    ],
    primitive: {
      attributes: { POSITION: viewBase + 1, NORMAL: viewBase + 2 }, indices: viewBase, material: 0,
    },
  };
}

/** The scene's nodes: today's single node, or a root holding one node per part. */
function partNodes(count: number) {
  if (count === 1) return [{ mesh: 0, matrix: MM_TO_M_Z_UP_TO_Y_UP, name: "cad_part" }];
  return [
    { matrix: MM_TO_M_Z_UP_TO_Y_UP, name: "cad_part", children: Array.from({ length: count }, (_v, i) => i + 1) },
    ...Array.from({ length: count }, (_v, i) => ({ mesh: i, name: "part-" + (i + 1) })),
  ];
}

/**
 * Builds the shared glTF document plus its binary chunk.
 * @remarks meshToGlb wraps this in a GLB container; meshToGltf (gltf.ts)
 *   embeds the chunk as a base64 data URI. One builder means the two formats
 *   cannot drift apart. A single mesh writes exactly the pre-assembly layout.
 */
export function buildPartDocument(mesh: CadMesh | CadMesh[], design: CadDesign) {
  const meshes = Array.isArray(mesh) ? mesh : [mesh];
  const runs: ReturnType<typeof partBuffers>[] = [];
  let byteBase = 0;
  for (const [i, m] of meshes.entries()) {
    const run = partBuffers(m, byteBase, i * 3);
    runs.push(run);
    byteBase += run.bin.length; // every run ends on a 4-byte boundary (float32 normals)
  }
  const bin = new Uint8Array(byteBase);
  let at = 0;
  for (const run of runs) {
    bin.set(run.bin, at);
    at += run.bin.length;
  }

  const gltf = {
    asset: {
      version: "2.0",
      generator: "arbesk-cad-gen",
      extras: { arbesk_cad: design, arbesk_units: "mm" },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: partNodes(meshes.length),
    meshes: runs.map((r) => ({ primitives: [r.primitive] })),
    materials: [{
      name: "cad_default",
      pbrMetallicRoughness: {
        baseColorFactor: [0.75, 0.76, 0.78, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: runs.flatMap((r) => r.bufferViews),
    accessors: runs.flatMap((r) => r.accessors),
  };

  return { gltf, bin };
}

/**
 * Serialises a mesh (or one mesh per part) plus its design document to GLB bytes.
 * @remarks Single self-contained buffer; the design rides in asset.extras, so
 *   the exported file alone reconstructs the design and its credits.
 */
export function meshToGlb(mesh: CadMesh | CadMesh[], design: CadDesign): Uint8Array {
  const { gltf, bin } = buildPartDocument(mesh, design);
  return new Uint8Array(serializeGLB(gltf as never, bin));
}
```

In `packages/cad-gen/src/core/export/gltf.ts`, change the signature to `export function meshToGltf(mesh: CadMesh | CadMesh[], design: CadDesign): string {` (body unchanged).

- [ ] **Step 6: Run the tests**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/cad-gen/exporters.test.js test/frontend/cad-render-core.test.js`
Expected: all PASS, including the golden-hash test (a mismatch means the single-part layout changed — fix the code, never the hash).

- [ ] **Step 7: Commit**

```bash
bunx eslint packages/cad-gen/src/core/export/three-mf.ts packages/cad-gen/src/core/export/glb.ts packages/cad-gen/src/core/export/gltf.ts test/cad-gen/exporters.test.js
git add packages/cad-gen/src/core/export/three-mf.ts packages/cad-gen/src/core/export/glb.ts packages/cad-gen/src/core/export/gltf.ts test/cad-gen/exporters.test.js
git commit -m "feat(cad-gen): 3MF and GLB exporters write one object per part

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 5: Wire parts through the browser, harnesses and prompt

**Files:**
- Modify: `frontend/src/js/workers/cad-render-core.ts:56-58`
- Modify: `test/frontend/cad-render-core.test.js`
- Modify: `scripts/cad-eval.mjs` (`componentsOf` `:74-88`, `writeExports` call `:296-302`)
- Modify: `scripts/cad-smoke.mjs:111-119`
- Modify: `packages/cad-gen/src/backend/prompt.ts` (`RULES` `:21`, `:24`)
- Modify: `test/cad-gen/prompt.test.js`
- Modify: `packages/cad-gen/src/core/contract.ts:7`, `test/cad-gen/package-wiring.test.js:7`
- Modify: `src/api/generation-providers.ts:14`, `:66`
- Modify: `packages/cad-gen/AGENTS.md` (before the line starting `The body count is gated from both sides.`)

**Interfaces:**
- Consumes: `KernelRunResult.parts` (Task 1); `meshTo3mf(CadMesh[], design)`, `meshToGlb(CadMesh[], design)` (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `describe("renderCadDesign")` in `test/frontend/cad-render-core.test.js`:

```js
  test("renders an array return as one 3MF object per part", () => {
    const twoPart = {
      ...DESIGN,
      code: "return [box(P.width, P.depth, P.height), box(P.width, P.depth, P.height).translate([P.width, 0, 0])];",
    };
    const { bytes, stats } = renderCadDesign(twoPart, module_);
    expect(stats.parts.count).toBe(2);
    const entries = unzipSync(bytes);
    const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
    const parsed = parse3mfModel(strFromU8(entries[modelPath]));
    expect(parsed.objects.length).toBe(2);
  });
```

Append to `describe("SYSTEM_PROMPT")` in `test/cad-gen/prompt.test.js`:

```js
  it("documents the array return for multi-part objects", () => {
    expect(SYSTEM_PROMPT).toContain("return an ARRAY of solids, one per part");
    expect(SYSTEM_PROMPT).not.toContain("Produce ONE solid.");
  });
```

In `test/cad-gen/package-wiring.test.js:7` change `expect(CONTRACT_VERSION).toBe(1);` to `expect(CONTRACT_VERSION).toBe(2);`.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/frontend/cad-render-core.test.js test/cad-gen/prompt.test.js test/cad-gen/package-wiring.test.js`
Expected: FAIL — the 3MF has one object, the prompt still says "Produce ONE solid.", the contract is 1.

- [ ] **Step 3: Pass parts in the browser worker**

In `frontend/src/js/workers/cad-render-core.ts`, replace:

```ts
    const { mesh, stats } = kernel.run(design);
    const bytes = meshTo3mf(mesh, design);
```

with:

```ts
    // One 3MF object per part: an array return's parts stay separate objects.
    const { parts, stats } = kernel.run(design);
    const bytes = meshTo3mf(parts, design);
```

- [ ] **Step 4: Document the array return in the prompt**

In `packages/cad-gen/src/backend/prompt.ts` `RULES`, replace the line `"Produce ONE solid. Solids only - no surfaces, no open shells.",` with:

```ts
  "Solids only - no surfaces, no open shells. For a single part, return one solid.",
  "For an object made of SEPARATE parts (clamp halves, a lid and its box, a set of",
  "gears), return an ARRAY of solids, one per part, each placed where it sits in the",
  "assembled object: return [base, lid]. Parts in an array are never fused, so they",
  "may touch - do not union them and do not spread them apart.",
```

and replace `"It MUST end by returning a Manifold.",` with `"It MUST end by returning a Manifold, or an array of Manifolds (one per part).",`.

- [ ] **Step 5: Bump the contract and use it in the mock provider**

In `packages/cad-gen/src/core/contract.ts:7`: `export const CONTRACT_VERSION = 2;`

In `src/api/generation-providers.ts:14`, change the import to `import { CadRequestUnsuitable, CONTRACT_VERSION, PRELUDE_VERSION } from "@arbesk/cad-gen/index.js";` and at `:66` change `runtime: { contractVersion: 1, preludeVersion: PRELUDE_VERSION },` to `runtime: { contractVersion: CONTRACT_VERSION, preludeVersion: PRELUDE_VERSION },`.

- [ ] **Step 6: Handle array returns in the harnesses**

In `scripts/cad-eval.mjs` `componentsOf`, replace the two lines from `const part = fn(` through the `const solids = ...` line with:

```js
  const returned = fn(values, values, module.Manifold, ...PRELUDE_NAMES.map((n) => helpers[n]));
  // An array return is one solid per part; a single solid is one part.
  const parts = Array.isArray(returned) ? returned : [returned];
  // Same rule as the kernel: a zero-volume flake is not a body.
  const solids = parts.flatMap((/** @type {any} */ p) => p.decompose())
    .filter((/** @type {any} */ s) => Math.abs(s.volume()) >= DEGENERATE_BODY_MM3);
```

In `scripts/cad-eval.mjs`, change `const { mesh, stats } = built.run;` to `const { parts, stats } = built.run;`, change `const written = writeExports(path.join(outDir, stem), mesh, result.design);` to `const written = writeExports(path.join(outDir, stem), parts, result.design);`, and in `writeExports`'s JSDoc change `@param {Mesh} mesh Mesh in millimetres, Z-up.` to `@param {Mesh[]} mesh One mesh per part, in millimetres, Z-up.`

In `scripts/cad-smoke.mjs`, change `const { mesh, stats } = kernel.run(result.design);` to `const { parts, stats } = kernel.run(result.design);` and the two exporter calls to `meshToGlb(parts, result.design)` and `meshTo3mf(parts, result.design)`.

- [ ] **Step 7: Document it for agents**

In `packages/cad-gen/AGENTS.md`, insert immediately before the line starting `The body count is gated from both sides.`:

```markdown
A script may return an ARRAY of solids, one per part (`return [base, lid]`). The
kernel never unions them: `KernelRunResult.parts` holds one mesh per part, the
exporters write one 3MF object / GLB node per part at its assembled position,
and `stats.parts` reports each part's box and body count. Overlapping parts are
recorded in `stats.parts.overlaps` and never fail a gate. For an array return the
gates count PARTS: `pieces` needs at least `minBodies` parts, and `connected`
allows at most `maxBodies` parts with at most `maxBodiesPerPart` bodies each
(1 unless a multi-body helper built that part). Single-solid returns are gated
exactly as before.

```

- [ ] **Step 8: Run the tests**

Run: `bun run build:packages && bun scripts/run-tests.mjs test/frontend/cad-render-core.test.js test/cad-gen/ test/api/generations-cad.test.js test/ai-asset-gen/`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
bunx eslint frontend/src/js/workers/cad-render-core.ts packages/cad-gen/src/backend/prompt.ts packages/cad-gen/src/core/contract.ts src/api/generation-providers.ts scripts/cad-eval.mjs scripts/cad-smoke.mjs test/frontend/cad-render-core.test.js test/cad-gen/prompt.test.js test/cad-gen/package-wiring.test.js
git add frontend/src/js/workers/cad-render-core.ts packages/cad-gen/src/backend/prompt.ts packages/cad-gen/src/core/contract.ts packages/cad-gen/AGENTS.md src/api/generation-providers.ts scripts/cad-eval.mjs scripts/cad-smoke.mjs test/frontend/cad-render-core.test.js test/cad-gen/prompt.test.js test/cad-gen/package-wiring.test.js
git commit -m "feat(cad-gen): array returns end to end - worker, harnesses, prompt, contract v2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
```

---

### Task 6: Full verification and live check

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full unit suites and typecheck**

```bash
bun run build:packages
bun run test -- test/cad-gen/ test/frontend/ test/api/ test/ai-asset-gen/
bun run typecheck && bun run typecheck:frontend
```

Expected: everything passes except suites that need compiled contract ABIs (`deployment-integrity`, `wallet-relay`, `generations-cad` when run together) if this worktree has no `blockchain/artifacts` — those fail with `ENOENT … ArbeskAssetFree.json` and are environmental, not regressions.

- [ ] **Step 2: Live two-part generation**

Requires `DEEPSEEK_API_KEY` and `JEV_API_KEY` in `.env`:

```bash
set -a; . ./.env; set +a
bun scripts/cad-eval.mjs "a pipe clamp in two separate halves for a 25 mm pipe" --out /tmp/cad-assembly-live
```

Expected: the printed design code ends with `return [` … `];`, the kernel stats line shows `"parts":{"count":2,"array":true`, no `FAILED` line, and `/tmp/cad-assembly-live/*.3mf` exists. If DeepSeek returns a single solid, re-run once (generation is noisy); two single-solid results in a row means the prompt wording in Task 5 Step 4 needs strengthening — report it, do not loosen the gates.

- [ ] **Step 3: Benchmark re-run (paired, against the noise floor)**

The handover's motivation was MUSE CNC furniture (~16%) and the CAD-bench gearbox zeros. Ask the user before this step: it spends DeepSeek and Gemini credits.

```bash
set -a; . ./.env; set +a
bun scripts/muse-bench.mjs --method cnc --out /tmp/muse-assembly
GEAR_IDS=$(ls /home/ahmedh/Projects/arbesk/test-results/cad-bench-fn/*/ | grep -i gear | sort -u | paste -sd, -)
bun scripts/cad-bench-fn.mjs --ids "$GEAR_IDS" --out /tmp/cadbench-assembly
```

Compare each run case by case against the archived baselines in the MAIN checkout: `/home/ahmedh/Projects/arbesk/test-results/muse-bench/` and `/home/ahmedh/Projects/arbesk/test-results/cad-bench-fn/`. About 25 in 200 outcomes flip between identical runs, so report the paired delta with that caveat rather than a single-run verdict.

- [ ] **Step 4: Push and open the PR**

Ask the user before pushing. Then:

```bash
git push -u origin <branch>
gh pr create --base main --title "feat(cad-gen): multi-part assembly output (array returns)" --body "<summary of Tasks 1-5, test results, live result, benchmark delta>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

The user merges (`gh pr merge` is blocked for the agent by the auto-mode classifier).

# CAD Assembly Output — Design

**Date:** 2026-10-10 · **Status:** approved in brainstorm

## 1. Why

A CAD script returns one Manifold, and the kernel treats it as one solid.
Manifold fuses solids that touch, so a model asked for a multi-part object
(a gearbox, a clamp in two halves, CNC furniture panels) spreads the parts
apart to keep them from fusing — or fuses them and fails the `pieces` gate.
This is the shared weak spot behind both benchmarks: MUSE CNC furniture
(~16%) and the CAD-bench gearbox cases (zeros).

## 2. What exists

- **Kernel** (`packages/cad-gen/src/core/kernel.ts`): `run()` (`:199`) calls
  the script, `assertManifold` (`:82`) rejects anything that is not an
  error-free `Manifold` instance, `withoutFlakes` (`:163`) decomposes, drops
  zero-volume bodies (`DEGENERATE_BODY_MM3`) and recomposes, `statsFrom`
  (`:128`) collects stats, and `bodiesOf` (`:176`) counts connected
  components into `stats.bodies`. The result is `KernelRunResult = { mesh,
  stats }` (`:12`).
- **Gates** (`core/gates.ts`): `evaluateKernelGates` (`:222`) runs
  `nonempty`, `connected` (max bodies, `:208`) and `pieces` (min bodies,
  `:215`). The bounds come from Jev's `piece_count` / `pieces_separate`
  answers via `bodyAllowance` (`:42`) and `bodyFloor` (`:67`,
  `SEPARATE_THRESHOLD` 0.75). The repair texts already talk about separate
  *pieces*, which is what authored parts are.
- **Exporters**: `meshTo3mf` (`core/export/three-mf.ts:81`) writes one
  `<object>`/`<item>`; `buildPartDocument` / `meshToGlb`
  (`core/export/glb.ts:90`, `:142`) write one mesh/node/primitive. The design
  sidecar (`Metadata/arbesk_cad.json`, glTF extras) carries the code and is the
  source of truth.
- **asset-core already reads multi-object 3MF**
  (`packages/asset-core/src/formats/3mf/parser.ts`, `to-gltf.ts`), so a
  multi-object file previews and saves without changes there.
- **Browser path**: `services/cad-render.ts` → `workers/cad-worker.ts` →
  `workers/cad-render-core.ts` (`renderCadDesign`: guard → kernel → 3MF) →
  `stageCadAsset` (`services/api.ts`), all carrying one `bytes`. The production worker does not run kernel gates; the harnesses do.
- **Hard constraints**: the server never executes generated code (S11/D3/D5);
  parts must stay un-unioned end to end; old single-solid designs keep working
  byte for byte.

## 3. Decisions (locked in brainstorm)

1. **Scope: multi-part output only.** No mating constraints, no motion (D12
   stays out of scope).
2. **Parts ship at their assembled positions.** "Arrange for print" is a later
   client-side feature, made easy because parts stay separate objects.
3. **Return shape: a plain array.** A script may `return [solidA, solidB, …]`;
   each entry is kept as its own part. A single Manifold behaves exactly as
   today. A named `assembly()` wrapper was considered and deferred (YAGNI).
4. **Overlapping parts are recorded, never failed.** Overlap is normal in an
   assembly (a pin in its hole) and printing at assembled positions is out of
   scope; the record feeds the later arrange-for-print feature.

## 4. Kernel

- `run()` accepts `Manifold | Manifold[]`. A single Manifold is normalised to a
  one-element list internally, and every downstream output for it is identical
  to today's.
- Each entry goes through `assertManifold`; the error names the index for an
  array: `part 2: did not return a Manifold`, `part 2: kernel status
  NotManifold`. A non-array, non-Manifold return keeps today's message.
- An array longer than `MAX_PARTS` (64) is a `CadKernelError` — a bound for the
  browser worker, not a design rule.
- `withoutFlakes` runs per part. A part that is *only* flakes is dropped and
  counted in `degenerateBodiesDropped`.
- Parts are never unioned. The combined `mesh` is built by concatenating part
  meshes (index offsets), not by `Manifold.compose` or a boolean, so touching
  parts cannot fuse and overlapping ones cannot produce a non-manifold result.
- `KernelRunResult` gains `parts: CadMesh[]`. `mesh` stays (the concatenation)
  for existing callers.

## 5. Stats and gates

- `stats.bodies` keeps its meaning: connected components across all parts,
  largest first, at most `MAX_BODY_BOXES` boxes.
- New `stats.parts = { count, boxes, overlaps? }` — present on every run
  (`count: 1` for a single solid).
  - `overlaps`: pairs of parts whose solids intersect by more than
    `DEGENERATE_BODY_MM3`, as `{ a, b, volumeMm3 }`, largest first, at most 8
    listed, plus `overlapCount`. Only pairs whose bounding boxes intersect are
    tested with `Manifold.intersect`, so the common case costs box checks
    only. Touching parts (zero-volume contact) are not overlaps.
- Gates, for an **array** return:
  - `pieces` (min) counts **parts**: `parts.count >= bodyFloor(...)`.
  - `connected` checks **each part is one body** — a part that falls apart is
    the same defect as today. The failure names the part index and its loose
    bodies' boxes.
  - The upper bound from `bodyAllowance` caps `parts.count`.
  - No gate reads `overlaps` (decision 4).
- Gates for a **single-solid** return are unchanged: they read `stats.bodies`
  as today, so existing thresholds stay calibrated.

## 6. Export

- **3MF**: one `<object>` per part, ids `1..n`, names `part-1` … `part-n`, and
  one `<item>` per object with no transform — the coordinates are already the
  assembled positions. The sidecar is written once, unchanged.
- **GLB**: one mesh + node per part (`part-1` …) under a single root node; the
  design stays in the root's extras.
- `meshTo3mf` / `meshToGlb` accept `CadMesh | CadMesh[]`; a single mesh writes
  exactly today's bytes (golden test).
- `readDesignFrom3mf` is unaffected.
- **Browser**: `workers/cad-render-core.ts` passes `result.parts` to the
  exporter; the worker still returns one 3MF `bytes`, so `stageCadAsset`,
  composite-3MF saving and IPFS part dedup are unchanged.

## 7. Generation prompt

- The system prompt (`backend/prompt.ts`) documents the array return: "For an
  object made of separate parts, return an array of solids, one per part,
  placed where they sit in the assembled object. Do not union parts and do not
  spread them apart."
- The `connected` / `pieces` repair texts point at the array return instead of
  "move the pieces apart" when a fused multi-part design fails `pieces`.
- `PRELUDE_VERSION` / `CONTRACT_VERSION`: bump `CONTRACT_VERSION` (the return
  contract widened); the prelude is unchanged.

## 8. Error handling

| Case | Result |
|---|---|
| array entry not a Manifold / bad status | `CadKernelError` naming the part index |
| empty array, or every part a flake | `nonempty` gate fails (existing text) |
| more than `MAX_PARTS` entries | `CadKernelError` |
| parts overlap | recorded in `stats.parts.overlaps`; never fails |
| a part falls apart into bodies | `connected` fails, naming the part |

## 9. Testing

- **Kernel**: array return keeps parts separate (two touching cubes → 2 parts,
  not 1 fused body); per-part flake removal; bad-entry and over-cap errors
  name the index; single-solid output deep-equals today's.
- **Stats**: overlap recorded for a pin inside a hole; touching parts not
  recorded; box-disjoint pairs never call `intersect`.
- **Gates**: `pieces` passes on a 2-part clamp array and fails on a fused
  clamp; `connected` fails on a part that falls apart; single-solid gate
  results unchanged (existing `gates.test.js` cases stay green).
- **Exporters**: multi-part 3MF parsed back by asset-core's parser yields n
  objects at the authored coordinates; single-mesh 3MF/GLB bytes match golden
  output.
- **Harnesses**: `scripts/cad-eval.mjs` (`componentsOf`),
  `scripts/lib/client-repair.mjs` and the CAD-bench task bridge
  (`scripts/lib/cadbench-task.mjs`) read parts; update the single-body
  assumptions in `exporters.test.js` and `prelude.test.js`.
- **Live**: `bun scripts/cad-eval.mjs "a clamp in two halves" --out /tmp/...`
  shows an array return and passes `pieces`; then re-run the MUSE CNC
  furniture slice and the CAD-bench gearbox cases against the noise floor
  (paired, see the cad-bench noise-floor note).

## 10. Out of scope

- Mating constraints, joints, motion (D12).
- Arrange-for-print layout (later, client-side; reads `parts` and `overlaps`).
- Named parts / `assembly()` wrapper.
- Server-side execution of any kind.

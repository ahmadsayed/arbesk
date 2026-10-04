# CADPrompt external benchmark for `@arbesk/cad-gen` — design

Date: 2026-10-04 · Status: approved direction, pending implementation plan

## Goal

Give cad-gen an **external score**: run the public CADPrompt benchmark
(ICLR 2025, "Generating CAD Code with Vision-Language Models for 3D Designs")
through the shipped generation loop and report numbers directly comparable to
the paper's GPT-4 / Gemini / CodeLlama rows. Use Jev to turn the score into a
ranked list of *why* parts fail, so the benchmark drives generator work instead
of only grading it.

Non-goal: measuring functional/printable parts (gears, Gridfinity, hinges).
CADPrompt is prismatic DeepCAD geometry; the internal functional suite is a
separate effort.

## Decision log (user-approved)

1. **Benchmark**: CADPrompt — 200 samples, text → CAD code, ground-truth meshes.
2. **Scale**: rewrite measured prompts ×100 into millimetres so cad-gen's mm
   printability gates see realistic parts. Metrics normalise to the unit cube,
   so scores stay comparable to the paper.
3. **Loop**: score the **full product loop** — `generate()` (server static
   repair) → in-process kernel + geometric gates → up to 2 client repair rounds
   with `failures`, exactly as the browser worker does. Also report the
   first-pass rate (no client repair) as the analogue of the paper's
   "Generated" row.
4. **Toolchain**: all-JS Bun script (same as `scripts/cad-eval.mjs`); no Python.
5. **Jev**: (a) failure / low-score triage — new; (b) ablation of the existing
   Jev library selector and suitability refusal — `--no-jev`. A Jev
   rewrite-check is deferred until the regex is shown to miss cases.

## Dataset facts (verified 2026-10-04)

- Source: `github.com/Kamel773/CAD_Code_Generation`, `CADPrompt/<id>/`, pinned
  to commit `33dcecd6087ff7b8a4454b1ba4d56504a6364399`.
- Per sample: `Natural_Language_Descriptions_Prompt.txt` (abstract),
  `Natural_Language_Descriptions_Prompt_with_specific_measurements.txt`
  (measured), `Ground_Truth.stl` / `.obj`, `Ground_Truth.json` (bbox, volume,
  surface area, `Is_Solid`, face/edge/vertex counts), `Python_Code.py`
  (CadQuery).
- `Data_Stratification.xlsx`: one sheet, columns `ID`, `Semantic complexity`
  (Simple / Moderate / Complex / Very Complex), `Mesh complexity`
  (Simple / Complex), `Compilation difficulty`. Values carry stray leading
  spaces — trim on read.
- Prompts begin "Write Python code using CADQuery to …". Measured prompts state
  lengths mostly as "N units" (895 occurrences), with a few in meters (25),
  inches (12) and degrees (22), and lists like "A by B units".
- **The repository has no licence.** Local evaluation only: fetched at run time
  into gitignored `test-results/`, never committed, never redistributed.

## Paper protocol (what we reproduce)

From §5 of the paper:

- ICP (rigid) aligns generated to ground truth; each point cloud is then
  normalised into the unit cube.
- **Point Cloud distance** (Eq. 8): symmetric mean nearest-neighbour distance,
  `D = 1/(2|P|) Σ_p min_q d + 1/(2|Q|) Σ_q min_p d`.
- **Hausdorff** (Eq. 9): symmetric max of nearest-neighbour distances.
- **IoGT** (Eq. 10): `|P ∩ Q| / |Q|`, which the paper computes on **bounding
  boxes**.
- **Compile rate**: share of samples that produce an object.
- A failed sample scores distance √3 (unit-cube diagonal) and IoGT 0.
- Reported as **median (IQR)**.

Baseline rows (Table 2):

| Model | Feedback | IoGT ↑ | PC dist ↓ | Hausdorff ↓ | Compile ↑ |
|---|---|---|---|---|---|
| GPT-4 zero-shot | Generated | 0.935 (0.043) | 0.153 (0.146) | 0.484 (0.405) | 92.0% |
| GPT-4 few-shot | Generated | 0.939 (0.030) | 0.155 (0.140) | 0.494 (0.368) | 96.0% |
| GPT-4 few-shot | CADCodeVerify | 0.944 (0.028) | 0.127 (0.135) | 0.419 (0.356) | 96.5% |
| Gemini zero-shot | Generated | 0.905 (0.088) | 0.159 (0.180) | 0.531 (0.451) | 85.0% |
| CodeLlama few-shot | CADCodeVerify | 0.935 (0.957) | 0.185 (1.620) | 0.582 (1.366) | 73.5% |

The paper does not state which prompt variant Table 2 uses; we run both and
compare against the same rows, noting the ambiguity in the summary.

## Architecture

```
scripts/
  cad-bench.mjs              CLI: orchestrates fetch → run → score → triage → summary
  lib/
    cad-harness.mjs          (existing) + buildWithClientRepair, moved from cad-eval.mjs
    cadprompt.mjs            fetch, load samples + stratification, rewrite prompts
    mesh-metrics.mjs         pure maths: sampling, k-d tree, ICP, chamfer, hausdorff, iogt
    bench-iou.mjs            exact volumetric IoU via Manifold
    bench-triage.mjs         Jev triage: state builder, questions, answer reader
    bench-summary.mjs        aggregation (median/IQR, strata, causes) → summary.json/.md
```

Each unit has one job and is testable alone. `mesh-metrics.mjs` takes plain
`{ positions, indices }` meshes and touches no I/O or Manifold, so it is the
easiest to test exhaustively.

### Targeted refactor

`buildWithClientRepair` moves from `scripts/cad-eval.mjs` to
`scripts/lib/cad-harness.mjs` with its logging and design-persistence hooks
passed in (`onRepair`, `onDesign`), so the benchmark and the eval share exactly
the browser's client loop (`CLIENT_REPAIR_ROUNDS = 2`, `MAX_TRIANGLES =
200000`, the same `bodyFloor` / `bodyAllowance` / `evaluateKernelGates`).
`cad-eval.mjs` behaviour is unchanged.

## CLI

```
bun scripts/cad-bench.mjs [--variant measured|abstract|both]   (default measured)
                          [--limit N] [--ids id1,id2]
                          [--concurrency 4]
                          [--no-jev]          generator built without JEV_API_KEY
                          [--no-triage]       skip the triage pass
                          [--resume <runDir>] skip samples that already have a result
                          [--compare <runDir>] add per-metric deltas vs another run
                          [--agreement <runDir>] score a hand-labelled triage-agreement.md
                          [--out <root>]      default test-results/cad-bench
```

Reads `DEEPSEEK_API_KEY` (required) and `JEV_API_KEY` (optional) from `.env`
via `requireEnv`. Each run gets `test-results/cad-bench/run#N/`, following
cad-eval's `attempt#N` convention.

## `cadprompt.mjs`

- **fetch()**: if `test-results/cadprompt/` is absent or at a different
  commit, `git clone --depth 1` then `git fetch --depth 1 origin <pin>` +
  `checkout <pin>`. Network is used only here.
- **loadSamples(variant)** → `{ id, prompt, gtStlPath, gtJson, strata }[]`.
  Strata come from the xlsx, read with `unzip -p` on `xl/sharedStrings.xml` and
  `xl/worksheets/sheet1.xml` (no new dependency). If `unzip` is missing the
  run continues unstratified and says so in the summary.
- **rewritePrompt(text, variant)** → `{ prompt, suspect }`:
  1. Replace a leading `/^\s*write (a )?python code using cad ?query to\s*/i`
     with an imperative ("Create …"), capitalising the first word.
  2. Measured variant only: multiply by 100 every number in `N unit(s)` and in
     `A by B [by C] unit(s)` lists, rewriting the unit to `mm`. Leave degrees,
     meters, inches and bare counts ("4 holes", "6 sides") untouched.
  3. Append "Dimensions are in millimetres."
  4. `suspect = true` if any decimal number remains that is not followed by a
     degree, meter or inch unit — flagged in the sample result and summary for
     a human to check.

## Per-sample flow

1. `generator.generate({ prompt })`. On `CadRequestUnsuitable` record
   `outcome: "refused"`.
2. `buildWithClientRepair` — kernel + gates, up to 2 client repair rounds.
   Record each round's failing gate and error.
3. On success, export the delivery mesh (`meshFrom`) to `<id>.stl`.
4. Score (below). On any failure, or a 10-minute per-sample wall clock, apply
   the paper's penalty (distances √3, IoGT 0, IoU 0).
5. Write `<id>.json`: variant, the prompt as sent, the `suspect` flag, design,
   `diagnostics` (selection, attempts, tokens), client repair rounds,
   `outcome` (`built` | `refused` | `gate_failed` | `kernel_error` |
   `timeout` | `provider_error`), metrics, triage, and timings.

Concurrency is a simple pool (default 4); the kernel runs in process, as in
cad-eval.

## Scoring

### `mesh-metrics.mjs`

- **sample(mesh, n = 8192, seed)**: area-weighted surface sampling with a
  seeded PRNG, so runs are reproducible. The paper does not state its sample
  count; this is documented as a deviation.
- **normalise(points)**: translate the bbox centre to the origin, then scale
  so the longest side is 1.
- **icp(source, target, { iters = 50, tol = 1e-6 })**: point-to-point
  rigid ICP (SVD/Kabsch per step, nearest neighbours via a k-d tree), starting
  from identity after both clouds are normalised. This differs from the paper,
  which aligns first and normalises after; our part is ~100× the ground truth,
  so ICP from raw coordinates cannot converge. Re-normalise after alignment.
  Returns the 4×4 transform and the aligned points.
- **chamfer(P, Q)** (Eq. 8), **hausdorff(P, Q)** (Eq. 9),
  **iogt(P, Q)**: bounding-box intersection volume over ground-truth bbox
  volume (Eq. 10 as the paper computes it).

### `bench-iou.mjs` — exact IoU (our addition)

Build Manifolds from the generated mesh (with the full normalise + ICP +
renormalise transform applied) and from the ground-truth STL (normalised the
same way, vertices merged). IoU = `intersect.volume / union.volume`. If Manifold
rejects either mesh as non-manifold, `iou = null` and the reason is recorded;
nulls are excluded from IoU medians and counted separately.

## Jev triage (`bench-triage.mjs`)

Runs after scoring, for every sample whose outcome is not `built`, or which
built with `iou < 0.5` (or `iogt < 0.5` when IoU is null). One `askJev` call
per sample, using the existing exported `askJev` from
`packages/cad-gen/src/backend/jev.ts`.

**State** (object):

- `prompt_sent`
- `ground_truth`: bbox in mm (×100), volume, `Is_Solid`
- `generated`: bbox, volume ratio to GT, bodies, triangles — or `"none"`
- `metrics`: iou, iogt, chamfer
- `design_summary`, `parameters` (the PARAMETERS table)
- `rounds`: the failing gate + error for each server and client attempt
- `code_excerpt`: first 3000 characters of the final script

**Questions:**

| id | type | asked when | criteria |
|---|---|---|---|
| `failure_cause` | choice | outcome ≠ built | `misread_prompt`, `unit_or_scale`, `helper_misuse`, `degenerate_boolean`, `gate_too_strict`, `kernel_limit`, `wrong_refusal`, `other` |
| `shape_mismatch` | choice | built, low score | `orientation`, `missing_feature`, `extra_feature`, `proportions`, `scale_interpretation` |
| `gate_false_positive` | noul | outcome = gate_failed | "the part as designed was acceptable and the gate rejected it wrongly" |
| `prompt_fixable` | noul | always | "clearer system-prompt or helper documentation would likely have prevented this" |

Each criterion carries a one-sentence description, in the `LICENCE_CLASSES`
style of `scripts/cad-candidates.mjs`. Answers with confidence < 0.6 are
labelled `unsure` in the summary. A Jev error never fails the run: the sample
gets `triage: { error }`.

**Trust check.** The first full run's summary includes a
`triage-agreement.md` template listing 20 triaged samples (stratified by
cause) with blank "human label" columns. After hand-labelling, `cad-bench.mjs
--agreement <runDir>` reports the Jev/human agreement rate in the summary. The
cause table is treated as advisory until agreement is recorded.

## Jev ablation

`--no-jev` builds the generator without the Jev config, so every request sees
the whole catalog and nothing is refused. Run once with and once without; the
summary of a `--no-jev` run, given `--compare <runDir>`, shows the per-metric
delta and the **wrong-refusal rate** of the Jev run. Every CADPrompt part is
mechanical, so any `refused` outcome is a false positive of the production
suitability gate. The delta may be small, since CADPrompt's simple extrusions
rarely need library entries; the summary states that rather than overselling
it.

## Output

`run#N/`:

- `<id>.json`, `<id>.stl` per sample
- `summary.json`: all aggregates, machine-readable, with config (variant,
  model, thinking, Jev on/off, sample count, seed, dataset pin)
- `summary.md`:
  1. Headline table: compile rate (full loop), first-pass rate, IoGT,
     PC dist, Hausdorff — median (IQR) — beside the paper's baseline rows;
     exact IoU in its own column.
  2. The same per stratum (semantic, mesh, compilation difficulty).
  3. Outcomes by cause (refused / gate_failed by gate / kernel_error / timeout).
  4. **Where to improve**: triage counts per `failure_cause` and
     `shape_mismatch`, with sample ids; the `gate_false_positive` and
     `prompt_fixable` rates; unsure answers separated.
  5. Cost: DeepSeek and Jev tokens, wall time.
  6. Deviations from the paper: the ×100 rewrite, the product repair loop,
     normalise-before-ICP, 8192 seeded samples, the prompt-variant ambiguity,
     exact IoU as an extra metric, and the `suspect` rewrite count.

## Error handling

- A missing `DEEPSEEK_API_KEY` fails fast (`requireEnv`). A missing
  `JEV_API_KEY` is equivalent to `--no-jev --no-triage`, with a warning.
- A provider error on one sample → `outcome: "provider_error"`, penalised, and
  the run continues. Three consecutive provider errors abort the run (likely a
  key or quota problem); `--resume` continues it.
- A per-sample result is written atomically (temp file + rename), so an
  interrupted run never leaves a half-written result that resume would skip.

## Testing

`test/cad-gen/` (`bun test`, no network, no API keys):

- `bench-metrics.test.js`:
  - identical meshes → chamfer 0, hausdorff 0, iogt 1
  - a unit cube rotated 20° about Z and translated → ICP recovers it
    (chamfer < 1e-3)
  - two unit cubes offset by 0.5 on X → hand-computed IoGT
  - the same seed → identical samples
- `bench-iou.test.js`: two offset cubes → IoU 1/3; a non-manifold mesh →
  `null` with a reason.
- `bench-cadprompt.test.js`: rewrite fixtures — "N units", "A by B by C
  units", degrees untouched, "4 holes" untouched, prefix stripped, suspect
  flagged; loader on a two-sample fixture directory, with and without strata.
- `bench-triage.test.js`: the state builder from a fixture result; question
  selection per outcome; answer reading with a stubbed `fetchImpl`, including
  the `unsure` threshold and Jev errors.
- `bench-summary.test.js`: median/IQR, penalty application, strata grouping.
- The existing cad-eval behaviour is covered after the `buildWithClientRepair`
  move by running `bun scripts/cad-eval.mjs` once on one prompt (manual, since
  it needs keys).

## Out of scope

- A functional/printable-part suite (separate spec).
- Text2CAD and CADBench runs (they can reuse `mesh-metrics.mjs` later).
- Multi-start or rotation-invariant ICP; the paper uses single-start ICP.
- A CI job: the benchmark costs API calls and takes tens of minutes; it is a
  manual tool like `cad-eval.mjs`.

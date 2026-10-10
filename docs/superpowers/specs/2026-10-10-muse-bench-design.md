# MUSE external benchmark for `@arbesk/cad-gen` — design

Date: 2026-10-10 · Status: approved direction, pending implementation plan

## Goal

Score cad-gen on **MUSE** ("Benchmarking Manufacturable, Functional, and
Assemblable Text-to-CAD Generation", Dong, Li & Wu, arXiv 2605.28579) so the
number sits next to its public leaderboard. CADPrompt (issue #89) measures
whether a part has the right *shape*. MUSE measures whether it *works*: is it
manufacturable, does it do its job, does it assemble. CADPrompt cannot ask that.

Non-goals:
- Changing cad-gen. This is a measuring instrument. Generator fixes come from
  what it finds, in later work.
- CI integration. Every run costs DeepSeek and Gemini calls.

## Decision log (user-approved, 2026-10-10)

1. **All 106 cases, leaderboard-comparable.** No printable-only subset as the
   headline. The report also breaks results out by manufacturing method.
2. **The judge is MUSE's own: Gemini-3.1-Pro** (`gemini-3.1-pro-preview`),
   called automatically with MUSE's scoring prompt and rubric. The key is
   `GEMINI_API_KEY` in `.env.gemini` (gitignored, commit `09ffec8`). It was
   verified live: the reference drawing scored 1.0 and a chair drawing
   submitted as the pen holder scored 0.0.
3. **A separate CLI, `scripts/muse-bench.mjs`.** It reuses the CADPrompt
   harness's building blocks but not its scoring. MUSE has no reference mesh
   and no IoU, and its funnel zeroes later stages.
4. **Our gate rejections count as Stage 2 failures**, because the product
   would not ship those parts. That is stricter than MUSE, and the report says
   so.

## Dataset facts (verified 2026-10-10)

- **Hugging Face:** `dongxiaoyu/MUSE`, CC BY 4.0, not gated, commit `f8a1dc45d1ea73df4161e8a1caf1d503c5358c30`
  (2026-05-28). Pin downloads to that commit.
  - `metadata.jsonl` has 106 rows.
  - Each case directory `cases/<case_id>/` holds:
    - `design_description.md`, the prompt
    - `evaluation_rubric.md`, the six-category rubric
    - `<case>.png`, the reference 4-view drawing
    - `<case>_stp_render.png`, a reference 3D render
  - There is **no reference CAD code, STEP or mesh**.
- **Harness:** `github.com/dong7313/muse`, MIT, commit `dcb1638` (2026-05-27).
  - Its drawing tool (`DrawCAD`) and OCCT validator are external and **not
    published**, so the harness cannot be run as it is. It also expects
    CadQuery code and a STEP file, which cad-gen does not emit.
- **Mix of cases:**
  - Manufacturing method: CNC Milling 65, 3D Printing 28, FDM 3D Printing 5,
    Laser Cutting 8. Materials are mostly timber (69) and PLA (28).
  - Planned component count: 1 for 37 cases; the rest range from 2 to 28.
    Most furniture cases (chairs, stools, tables, TV stands) are 5–28-part
    assemblies.
- **Spec format:** markdown sections — Design Goal, Geometry and Dimensions,
  Material, Manufacturing Method, Connection Method, Mechanical Condition,
  Structural Features, Special Requirements, Planned Component Quantity,
  Component Names, Adjustable Parameters, Component Details, and a textual
  Component Assembly Graph.
- **Reference drawing style:** a 2×2 sheet with Isometric / Top / Front /
  Right views, blue visible edges, grey dashed hidden lines, red overall
  dimensions, and a title block.

## MUSE protocol (what we reproduce)

A strict three-stage funnel, one sample per case. A case that fails a stage
scores 0 on every later metric.

1. **Code check:** the generated code executes and yields a solid.
2. **Geometric validity:** all four must pass — Watertight, Manifold,
   Self-Intersection Free, Overlap Free (distinct solids do not interpenetrate).
3. **Design-intent alignment:**
   - The judge scores six rubric categories, each 0 (fail) or 1 (pass):
     Assembly Readiness, Joint Design, Tolerance, Functional Adaptation, Usage
     Stability, Manufacturability.
   - It returns `overall_score_normalized = sum / 6` plus a rationale per
     category.
   - The paper's sub-scores pair these up: **Functionality** = mean(Functional
     Adaptation, Usage Stability), **Manufacturability** = mean(Tolerance,
     Manufacturability), **Assemblability** = mean(Assembly Readiness, Joint
     Design).
   - **Final Score** = the mean of the three sub-scores over all 106 cases,
     which equals the mean of `overall_score_normalized`, with funnel zeros.

**Judge inputs.** The judge sees images, not code:
- `<Task_Doc>`: the spec
- `<Reference_SVG>`: the reference drawing
- `<Generated_SVG>`: the candidate drawing
- `<Evaluation_Rubric>`

The system prompt is `generate_score_sp` from
`src/judge_system/prompts/generate_score.py`. The live test called it with
`temperature: 0` and `responseMimeType: application/json`.

**Leaderboard rows** (paper, final score; code % → geometry % → final %):

| Model | Code | Geometry | Final |
|---|---|---|---|
| GPT-5.5 | 77.36 | 70.75 | 52.36 |
| Gemini 3.1 Pro | 65.09 | 58.49 | 43.40 |
| Claude Opus 4.7 | 76.42 | 60.38 | 39.47 |
| GLM-5.1 (best open-source) | 31.13 | 27.36 | 18.87 |

The implementation copies these into a `PAPER_BASELINES` table with a
citation, as `bench-summary.mjs` does for CADPrompt.

## Deviations from the paper (stated in every report)

1. **Code is not CadQuery.** cad-gen emits Manifold-prelude JavaScript, and
   "executes" means the in-process kernel produced a mesh.
2. **Stage 2 is stricter, and partly guaranteed by construction.**
   - Manifold output is watertight, manifold and free of self-intersection,
     and its unions cannot interpenetrate. We record those four checks; we do
     not re-test them.
   - On top of that, a part that cad-gen's own kernel gates reject (connected,
     pieces, nonempty, budget) fails Stage 2, because the product would not
     deliver it.
3. **Our drawings come from our own renderer**, not MUSE's DrawCAD. The layout
   and style match; the line rendering is ours.
4. **One sample per case, Gemini-3.1-Pro judge, temperature 0.** That matches
   MUSE's published eval config (`samples_per_task: 1`), but the paper does not
   state its judge temperature.
5. **The prompt is the spec verbatim.** No hints, no rewrites. As in the
   paper, the system under test sees only `design_description.md`.

## Architecture

```
scripts/muse-bench.mjs          CLI: fetch, run, judge, summarise, resume
scripts/lib/muse.mjs            dataset: fetch (pinned HF revision), load cases, parse spec fields
scripts/lib/muse-sample.mjs     one case: generate -> hardened loop -> stage 1/2 -> drawing + render
scripts/lib/muse-judge.mjs      Gemini call, response validation, retry, stage-3 record
scripts/lib/muse-summary.mjs    funnel aggregation, sub-scores, strata, baselines, markdown
scripts/lib/drawing.mjs         MUSE-style 2x2 engineering sheet (SVG) from a mesh, PNG via inkscape
scripts/lib/render.mjs          (moved) renderMesh + writePng out of scripts/cad-eval.mjs
```

**What it reuses, unchanged:**
- `cadGeneratorFrom` and `loadCadKernel` (`cad-harness.mjs`)
- `buildWithClientRepair` (`client-repair.mjs`)
- `writeBinaryStl` (`stl.mjs`)

So a MUSE case runs through **exactly** the hardened loop CADPrompt does:
server static repair, then the kernel, then the geometric gates, then up to
`CLIENT_REPAIR_ROUNDS` client repairs in thinking mode with a plain fallback
(PR #114).

**Targeted refactor:** `renderMesh` and `writePng` are private to the
`scripts/cad-eval.mjs` CLI today. They move to `scripts/lib/render.mjs`, and
`cad-eval.mjs` imports them. Its behaviour must not change: the CADPrompt
report's PNGs stay byte-identical.

**The judge prompt is ported, not imported.** `muse-judge.mjs` carries
`generate_score_sp` verbatim in a constant, with the MIT notice and a credit to
the MUSE authors and repo. The same applies to any other text copied from the
harness.

## CLI

```
bun scripts/muse-bench.mjs [--limit N] [--ids a,b,c] [--concurrency 4]
                           [--no-judge] [--judge-only <runDir>] [--resume <runDir>]
                           [--method cnc|print|laser] [--out test-results/muse-bench]
```

- `--no-judge`: Stages 1–2 plus drawings only, with no Gemini spend.
- `--judge-only <runDir>`: judge the cases in an existing run that have a
  drawing but no `score.json`.
- `--resume <runDir>`: continue an interrupted run. Like `cad-bench.mjs`, the
  summary is built from what is on disk, not from the current invocation.
- `--method`: run a subset (for example 3D printing) to debug cheaply. The
  headline is only labelled leaderboard-comparable when all 106 cases ran.
- `.env` supplies the DeepSeek and Jev settings exactly as for `cad-bench.mjs`.
  `.env.gemini` supplies `GEMINI_API_KEY`, falling back to `GEMINI_API_KEY` in
  `.env`. The model id lives in one constant: `JUDGE_MODEL =
  "gemini-3.1-pro-preview"`.

## Per-case flow (`muse-sample.mjs`)

1. **Generate.** `generator.generate({ prompt: spec })` with a 10-minute
   wall-clock `signal`, as `SAMPLE_TIMEOUT_MS`. If `generate` throws, classify
   the error the way `classifyError` does: `provider_error` /
   `unsuitable_refused` / `static_failed` / `timeout`. Every one of these is a
   Stage 1 failure.
2. **Hardened loop.** `buildWithClientRepair`. Outcomes:
   - `run` comes back: **Stage 1 pass and Stage 2 pass**. A non-null `run`
     means the kernel built the part and every gate passed.
   - Every round threw in the kernel (no mesh): **Stage 1 fail**,
     `stage1_reason: kernel_error`.
   - The last round built but a gate failed: **Stage 1 pass, Stage 2 fail**,
     `stage2_reason: gate:<name>`.
   - `buildWithClientRepair` returns `run: null` for both. The two are told
     apart by the last `RoundFailure.gate` (`"kernel"` vs a gate name).
3. **Artifacts for a delivered part.** All are written:
   - `<id>.stl`: binary STL of the delivered mesh
   - `<id>.drawing.svg` and `<id>.drawing.png`: the 2×2 sheet
   - `<id>.render.png`: shaded isometric
4. **Record.** `<id>.json` carries the stage outcomes and reasons, the design,
   the diagnostics, tokens, timings and the spec fields used for strata
   (method, material, component count). It is written atomically, as in
   `cad-bench.mjs`.

## Drawing (`drawing.mjs`)

- **Input:** the delivered mesh (positions and indices, mm, Z-up) and a case
  title.
- **Output:** an SVG sheet in MUSE's layout:
  - four panels — Isometric (top-left), Top, Front, Right
  - a title block with the case id, "arbesk cad-gen" and the date
  - the same panel geometry and proportions as the reference PNG
    (1580 × 1120)
- **Edges:**
  - Draw a mesh edge when it is a **crease** (dihedral angle > 30°) or a
    **silhouette** (one adjacent face toward the view, one away). Boundary
    edges cannot occur: Manifold meshes are closed.
  - Edges on coplanar faces (the triangulation of a flat face) are never drawn.
- **Hidden lines:**
  - Each panel's depth buffer comes from the same rasterisation `renderMesh`
    uses, with an orthographic camera per view.
  - Each candidate edge is sampled along its length. A sample is visible when
    its depth is within ε of the buffer. A hidden sample that lands on a
    visible drawn edge (within 1 px) is dropped, so the back edges of an
    orthographic view never double the outline as dashes. Runs of visible samples become solid
    blue segments (`#0000a0`, 2.2 px); runs of hidden samples become dashed
    grey ones (`#808080`, 1 px, dash 6 3).
- **Dimensions:** red, as in the reference.
  - The overall bounding box goes on the Top view (width and depth) and the
    Front view (height), in millimetres, rounded to 0.1.
  - Feature dimensions such as diameters are not drawn. The reference's `Ø94`
    style annotations are DrawCAD-specific. A deviation, recorded in the
    report.
- **Scale:** every panel uses the same mm-to-px scale, chosen to fit the
  largest view, and the title block states it (for example `Scale: 1:1.7`),
  as in the reference.
- **PNG:** `inkscape <svg> --export-type=png --export-width=1580`. Inkscape
  1.4.4 is installed. A missing inkscape is a hard error naming the dependency:
  without the PNG, the judge has nothing to score.
- **Budget:** meshes stay under `MAX_TRIANGLES` (200k). A naïve
  edge-by-depth-sample pass is fast enough at that size, so there is no
  acceleration structure until a measurement says otherwise.

## Judge (`muse-judge.mjs`)

- **Request:** Gemini `generateContent`.
  - `system_instruction` = `generate_score_sp`.
  - One user turn with interleaved parts, in this order:
    `<Task_Doc>` text, the reference PNG, `<Generated_SVG>` (our drawing PNG),
    `<Evaluation_Rubric>` text.
  - `generationConfig: { temperature: 0, responseMimeType: "application/json" }`.
  - Our shaded render is **not** sent. MUSE's leaderboard judge scores the
    drawing; the render is kept for people.
- **Validation:** the response must parse as JSON with
  `overall_score_normalized` in [0, 1] and exactly the six known
  `category_en` values, each scored 0 or 1. We **recompute**
  `overall_score_normalized` from the items. If it disagrees with the judge's
  own figure by more than 0.01, we keep ours and record a
  `normalization_mismatch` flag.
- **Retries:**
  - HTTP 429 / 500 / 503: up to 4 retries with backoff (15 s, 30 s, 45 s,
    60 s; or the server's `retryDelay` when it is under 120 s).
  - A malformed response is retried once.
  - HTTP 402 (credits depleted) or 403 aborts the whole run, with a message
    naming AI Studio billing, because every later call would fail the same
    way.
- **Failure is never a zero.** A case whose judge call still fails gets
  `judge_error` in `score.json` and is **excluded** from Stage 3 aggregates,
  with the count in the report. A failed judge call says nothing about the
  part. `--judge-only` re-runs exactly these cases.
- **Record:** `<id>.score.json` holds the six items with rationales, the
  normalised score, the three sub-scores, the judge model, token usage
  (including thinking tokens) and the latency.

## Output

`test-results/muse-bench/run#N/` (gitignored), per case:
- `<id>.json`
- `<id>.stl`
- `<id>.drawing.svg` and `<id>.drawing.png`
- `<id>.render.png`
- `<id>.score.json`

Plus, for the whole run:
- `summary.json` and `summary.md`
- `index.html`: cards with the reference drawing beside ours, the six
  rationales and the stage outcome, in the style of `bench-report.mjs`.

**`summary.md`:**
- **Headline funnel:** Code % → Geometry % → Final %, plus Functionality /
  Manufacturability / Assemblability, beside `PAPER_BASELINES`.
- **Breakdowns:**
  - by manufacturing method (CNC / 3D printing / laser) and by component count
    (1 / 2–5 / 6+)
  - pass rate per rubric category
  - Stage 1 / Stage 2 failure reasons, with counts
- **Judge health:** errors, normalisation mismatches, and the tokens and
  seconds spent.
- **Cost:** DeepSeek and Gemini tokens, and wall clock.
- **Deviations** (the list above) and the **attribution**: "MUSE dataset ©
  its authors, CC BY 4.0; judge prompt from the MUSE harness, MIT."

## Error handling

- **Stopping the run:**
  - 3 consecutive `provider_error` outcomes from DeepSeek abort the run, as in
    `cad-bench.mjs`.
  - A judge 402/403 also aborts.
  - `--resume` / `--judge-only` continue after either.
- **Dataset fetch:**
  - Downloads go through Hugging Face's `resolve/<revision>/` URLs, pinned to
    dataset commit `f8a1dc4`.
  - Files already on disk are not refetched.
  - A missing file for a case fails loudly at load, never mid-run.
- **Drawing or inkscape failure** for a delivered part: the case is recorded
  as `drawing_error`. It is not judged, does not count as a Stage 3 zero, and
  is reported separately.
- **Atomic writes** for every JSON record. One malformed record must not lose
  the run.

## Testing

All offline: `bun scripts/run-tests.mjs`, no network, no API keys, synthetic
fixtures only.

- **`muse.mjs`:** spec-field parsing (method, material, component count) on a
  synthetic spec; the `metadata.jsonl` loader; the pinned URL builder.
- **`muse-sample.mjs`:** the stage mapping, with injected generator and kernel
  stubs, for:
  - a first-pass success
  - a success after repair
  - a kernel throw on every round (Stage 1 fail)
  - a last round that built but failed `connected` (Stage 2 fail)
  - a `provider_error` and a `timeout`
- **`muse-judge.mjs`:**
  - a stubbed `fetchImpl` returning a valid, a malformed and a mismatched
    response
  - 429-then-200 retry
  - 402 abort
  - the request body checks: part order, system instruction, JSON mime type
- **`muse-summary.mjs`:**
  - funnel zeros
  - `judge_error` exclusion
  - the sub-score pairing
  - strata
  - the markdown snapshot of key lines
- **`drawing.mjs`:**
  - A 20 × 10 × 5 box gives 9 visible + 3 hidden edges in Isometric, and 4
    visible + 0 hidden in Top/Front/Right. The back edges project onto the
    visible outline there and are suppressed.
  - A box with a blind pocket gives hidden dashed edges in the Front view.
  - The dimension text equals the bounding box.
  - Coplanar triangulation edges are never drawn.
- **`render.mjs` move:** `cad-eval.mjs --stl` output is byte-identical before
  and after the move, checked against a fixture STL.
- **Live smoke:** `bun scripts/muse-bench.mjs --ids pen_holder,stool,vase
  --concurrency 1`.
  - All three reach a stage outcome and a summary.
  - `pen_holder` should pass Stage 2 and get a non-zero judge score.
  - A person checks the three drawings against the references by eye.

## Cost (measured on the live judge test)

- **One judge call:** ~4.7k input tokens (2.2k of them image), ~1.4k output
  (~1.0k of it thinking), ~19 s.
- **106 cases:** ~500k input and ~150k output Gemini tokens, plus DeepSeek
  generation as for CADPrompt.
- **Wall clock:** under 10 minutes for judging at concurrency 4.

## Out of scope

- Multiple samples per case, or judge-agreement studies (MUSE did those
  against human labels).
- Generator changes for furniture assemblies. If MUSE shows cad-gen cannot
  build multi-part timber furniture, that is a finding to plan separately.
- Feature dimensions (diameters, hole callouts) on our drawings.
- Text2CAD-Bench, CADBench and CAD Arena. Each is its own effort once MUSE
  lands.

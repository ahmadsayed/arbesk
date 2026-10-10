# MUSE Benchmark Harness Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development. This is a **light plan** (user's choice, 2026-10-10): each task gives the files, the interfaces, the test cases and the commands. Implementation fills in the code, test-first.

**Goal:** `bun scripts/muse-bench.mjs` runs the 106 MUSE cases through cad-gen's hardened loop. It draws each delivered part as a MUSE-style engineering sheet, has Gemini-3.1-Pro score it against MUSE's rubric, and writes a funnel report comparable to the leaderboard.

**Spec:** `docs/superpowers/specs/2026-10-10-muse-bench-design.md`. Read it first; this plan does not repeat its reasoning.

**Architecture:** One Bun CLI over small modules in `scripts/lib/`. Two targeted refactors come first: the renderer moves out of `cad-eval.mjs`, and the run-directory helpers move out of `cad-bench.mjs`. New modules then cover the dataset, the drawing, one case, the judge and the summary.

**Tech stack:** Bun, JavaScript with JSDoc under `checkJs`, `manifold-3d`, cad-gen source imports, Gemini REST (`generateContent`), and the system `inkscape` (1.4.4) for SVG to PNG.

## Global Constraints

- **Code style:** JSDoc on every export, `@remarks` for the *why*, comment density like `scripts/cad-eval.mjs`.
- **Checks:** `bun run lint` stays clean. Type-check with `bunx tsc --noEmit -p tsconfig.worktree.json` in a worktree (bare `@arbesk/cad-gen` resolves to the main checkout's `dist` there).
- **Tests:** `bun scripts/run-tests.mjs <path>`, one process per file. No network, no API keys, synthetic fixtures only.
- **Imports:** scripts import cad-gen **source** (`../../packages/cad-gen/src/...ts`). No new npm dependencies.
- **Dataset:**
  - Source: Hugging Face `dongxiaoyu/MUSE`, pinned to `f8a1dc45d1ea73df4161e8a1caf1d503c5358c30`, licence CC BY 4.0.
  - Fetched into gitignored `test-results/muse/`; never committed.
- **Judge:**
  - Model: `JUDGE_MODEL = "gemini-3.1-pro-preview"`, at `temperature: 0`, `responseMimeType: "application/json"`.
  - Key: `GEMINI_API_KEY` from `.env.gemini`, falling back to `.env`.
- **Judge prompt:** `generate_score_sp` is ported **verbatim** from `github.com/dong7313/muse` @ `dcb1638` (`src/judge_system/prompts/generate_score.py`), with the MIT notice and a credit.
- **Output:** `test-results/muse-bench/run#N/`. JSON records are written atomically.
- **Commits:** stage files by name only. Never commit `blockchain/deployments/*.json`, `.env*` or `tsconfig.worktree.json`. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/lib/render.mjs` (create) | `writePng`, `boundsOf`, vector helpers, `renderMesh`, `rasterize` (moved from `cad-eval.mjs`) and a new `orthoDepth` for the drawing |
| `scripts/lib/bench-io.mjs` (create) | `pool`, `nextRunDir`, `writeJsonAtomic`, `readJson` (moved from `cad-bench.mjs`) |
| `scripts/lib/muse.mjs` (create) | Pinned URLs, `fetchMuse`, `loadCases`, `parseSpec` |
| `scripts/lib/drawing.mjs` (create) | `drawingEdges`, `drawingSvg`, `svgToPng` |
| `scripts/lib/muse-sample.mjs` (create) | `runCase`: generate, then the hardened loop, then stage 1/2, then artifacts |
| `scripts/lib/muse-judge.mjs` (create) | `SCORE_PROMPT`, `buildJudgeRequest`, `parseJudgeResponse`, `judgeCase`, `JudgeAbort` |
| `scripts/lib/muse-summary.mjs` (create) | `PAPER_BASELINES`, `summarise`, `renderMarkdown`, `writeReport` |
| `scripts/muse-bench.mjs` (create) | CLI: args, fetch, pool, resume, judge-only, abort rules, summary |
| `scripts/cad-eval.mjs`, `scripts/cad-bench.mjs` (modify) | Import the moved helpers. Behaviour unchanged. |
| `test/cad-gen/muse-*.test.js`, `test/cad-gen/bench-render.test.js` (create) | One test file per module |
| `packages/cad-gen/AGENTS.md` (modify) | Harnesses section: add muse-bench |

---

### Task 1: Move the renderer and the run helpers into `scripts/lib/`

**Files:**
- Create: `scripts/lib/render.mjs`, `scripts/lib/bench-io.mjs`, `test/cad-gen/bench-render.test.js`
- Modify: `scripts/cad-eval.mjs` (delete `crc32`, `pngChunk`, `writePng`, `sub`, `dot`, `cross`, `unit`, `boundsOf`, `renderMesh`, `rasterize` and `resolve`, then import them); `scripts/cad-bench.mjs` (delete `pool`, `nextRunDir`, `writeJsonAtomic` and `readJson`, then import them; keep re-exporting `pool` so `bench-cli.test.js` still passes)

**Interfaces (produces):**
- `render.mjs`:
  - `writePng(file, width, height, rgb: Buffer): number`
  - `boundsOf(mesh): { min: number[], max: number[] }`
  - `renderMesh(mesh, opts?): { rgb, width, height }`
  - `rasterize(state)`
  - `sub`, `dot`, `cross`, `unit`
- **New** in `render.mjs`: `orthoDepth(mesh, view: { forward: number[], up: number[] }, frame: { centre: number[], scale: number, W: number, H: number }): { depth: Float64Array, project: (p: number[]) => [x, y, z] }`.
  - It builds the camera basis from an explicit `up`. `renderMesh` derives "right" from +Z, which fails for a straight-down Top view.
  - It rasterises depth only.
- `bench-io.mjs`:
  - `pool(items, concurrency, fn, shouldStop)`
  - `nextRunDir(root): string`
  - `writeJsonAtomic(file, value)`
  - `readJson(file): any | null`

**Steps:**
- [ ] **Byte-identity guard first.** Write `bench-render.test.js`: render `box([20, 10, 5])` (from `test/cad-gen/helpers/bench-meshes.js`) with `renderMesh(mesh, { width: 720, height: 560 })` and compare the SHA-256 of `rgb` to a constant captured from the **current** `cad-eval.mjs` code. To capture it, temporarily export `renderMesh` from `cad-eval.mjs`, record the hash, then revert that line. Also test `orthoDepth`:
  - On a 10 mm cube viewed top-down, the depth at the centre pixel is finite and the depth outside the cube is `Infinity`.
  - `project([0, 0, 0])` lands at the frame centre.
- [ ] Run it. It fails: there is no `render.mjs` yet.
- [ ] Move the functions verbatim into `render.mjs` and add `orthoDepth`. Move the bench-io helpers. Rewire both CLIs.
- [ ] Run `bench-render.test.js`, `bench-cli.test.js` and the whole `test/cad-gen/`. All pass, and the hash matches.
- [ ] Manual check: `bun scripts/cad-eval.mjs --stl <any fixture STL> /tmp/claude-.../a.png` before and after the move writes byte-identical PNGs (`cmp`).
- [ ] Run lint, tsc and the fallow audit (the commit hook runs it), then commit `refactor(bench): renderer and run-dir helpers into scripts/lib`.

### Task 2: Dataset loader (`muse.mjs`)

**Files:** Create `scripts/lib/muse.mjs` and `test/cad-gen/muse-dataset.test.js`.

**Interfaces (produces):**
- `MUSE_REVISION = "f8a1dc45d1ea73df4161e8a1caf1d503c5358c30"`
- `museUrl(relPath): string`, which returns `https://huggingface.co/datasets/dongxiaoyu/MUSE/resolve/<rev>/<relPath>`
- `fetchMuse(root, { fetchImpl? }): Promise<void>`
  - Downloads `metadata.jsonl` and, for each case, `design_description.md`, `evaluation_rubric.md` and `<case>.png`.
  - Skips files already on disk.
  - Throws naming the file on any non-200.
- `parseSpec(markdown): { method: "cnc" | "print" | "laser" | "other", methodRaw: string, material: string, components: number | null }`
  - Uses the `## Manufacturing Method`, `## Material` and `## Planned Component Quantity` sections.
  - `print` covers "3D Printing" and "FDM 3D Printing"; `cnc` is "CNC Milling"; `laser` is "Laser Cutting".
- `loadCases(root): Case[]`, where `Case = { id, spec, rubric, referencePng, strata: { method, material, components } }`
  - Read in `metadata.jsonl` order.
  - Throws at load if any file of any case is missing.

**Tests:**
- `parseSpec` on a synthetic spec for each method spelling. A missing component section gives `components: null`.
- `museUrl` embeds the pinned revision.
- `loadCases` over a temp-dir fixture with 2 cases returns them in metadata order. Deleting one rubric makes it throw, naming that path.
- `fetchMuse` with a stub `fetchImpl` writes the files. A second call makes zero fetches. A 404 throws, naming the URL.

**Steps:** test, fail, implement, pass, then commit `feat(muse-bench): dataset loader pinned to the HF revision`.

### Task 3: Engineering drawing (`drawing.mjs`)

**Files:** Create `scripts/lib/drawing.mjs` and `test/cad-gen/muse-drawing.test.js`.

**Interfaces:**
- Consumes `orthoDepth`, `boundsOf`, `sub`, `dot`, `cross` and `unit` from Task 1.
- Produces:
  - `VIEWS`: Isometric `forward [-1, 1, -1]` (normalised, the same corner as the reference sheet), Top `forward [0, 0, -1]` `up [0, 1, 0]`, Front `forward [0, 1, 0]` `up [0, 0, 1]`, Right `forward [-1, 0, 0]` `up [0, 0, 1]`.
  - `drawingEdges(mesh, view, frame): { visible: Segment[], hidden: Segment[] }`, where `Segment = [x1, y1, x2, y2]` in panel px.
    - **Candidate edges:** creases (dihedral > 30°) plus silhouettes. Coplanar edges are never candidates.
    - **Visibility:** each edge is sampled every 1 px. A sample is visible when its depth is within `1e-3 × extent` of the buffer. Runs of samples become segments.
    - **Suppression:** hidden samples within 1 px of a visible segment are dropped.
  - `drawingSvg(mesh, { title, date }): string`. A 1580 × 1120 sheet:
    - four panels, laid out as in the reference
    - blue `#0000a0` visible lines at 2.2 px; grey `#808080` hidden lines at 1 px, dashed `6 3`
    - red overall dimensions: Top shows width and depth, Front shows height, in mm to 0.1
    - title block with the case id, "arbesk cad-gen", the date and `Scale: 1:k`
    - one shared mm-to-px scale across all panels
  - `svgToPng(svgFile, pngFile, width = 1580): void`
    - spawns `inkscape <svg> --export-type=png --export-width=<w> --export-filename=<png>`
    - throws `Error("inkscape not found - install it to draw MUSE sheets")` on `ENOENT`
    - throws with inkscape's stderr on a non-zero exit

**Tests (`box` and a pocketed box built from `box()` meshes; no Manifold needed):**
- `box([20, 10, 5])`:
  - Isometric gives 9 visible and 3 hidden edges, counted as merged segments.
  - Top, Front and Right each give 4 visible and 0 hidden.
- A box with a blind pocket, built as a closed mesh fixture in the test (an outer box plus an inverted inner box gives a valid closed solid for edge purposes): the Front view has ≥ 4 hidden segments.
- A box triangulated with an extra diagonal per face never draws a diagonal (the coplanar rule).
- `drawingSvg` contains the four panel labels, the strings `20.0`, `10.0` and `5.0` in red `<text>`, and one `Scale: 1:` line.
- `svgToPng` is skipped with `it.skipIf(!hasInkscape)`. When run, it writes a PNG whose header bytes are the PNG signature.

**Steps:** test, fail, implement, pass. Then a **visual check**: write the sheet for a real fixture STL from `test-results/cad-bench/run#1/measured/` (if present) or for `box`, open the PNG and compare it by eye to `pen_holder.png` from the dataset. Commit `feat(muse-bench): MUSE-style 4-view engineering drawing`.

### Task 4: One case through the hardened loop (`muse-sample.mjs`)

**Files:** Create `scripts/lib/muse-sample.mjs` and `test/cad-gen/muse-sample.test.js`.

**Interfaces:**
- Consumes:
  - `buildWithClientRepair` (`client-repair.mjs`)
  - `classifyError` and `SAMPLE_TIMEOUT_MS` (`bench-sample.mjs`)
  - `writeBinaryStl` (`stl.mjs`)
  - `drawingSvg` and `svgToPng` (Task 3)
  - `renderMesh` and `writePng` (Task 1)
- Produces `runCase({ generator, kernel, kase, dir, timeoutMs?, draw? = true }): Promise<CaseRecord>`. `CaseRecord` holds:
  - **Identity:** `id`, `strata`.
  - **Stages:** `stage1: boolean`, `stage1Reason: null | "provider_error" | "refused" | "static_failed" | "timeout" | "kernel_error"`, `stage2: boolean`, `stage2Reason: null | "gate:<name>"`, `geometry` (the four Manifold-guaranteed checks: `{ watertight, manifold, selfIntersectionFree, overlapFree }`, all `true` when stage 1 passed, `null` otherwise).
  - **Generation:** `firstPass`, `clientFailures`, `design`, `diagnostics`, `stats`.
  - **Artifacts:** `drawing: "ok" | "error" | null`, `drawingError`.
  - **Accounting:** `tokens`, `jevTokens`, `durationMs`.
- Writes `<id>.stl`, `<id>.drawing.svg`, `<id>.drawing.png` and `<id>.render.png` only for a part that passes stage 2. A drawing failure sets `drawing: "error"` and never throws.

**Tests (stub generator and kernel, as in `bench-sample.test.js`; `draw: false` except in one test):**
- First pass builds: stage1 true, stage2 true, `firstPass` true.
- Fails once, then the repair builds: stage1 and stage2 true, `firstPass` false.
- The kernel throws on every round: stage1 false, `stage1Reason: "kernel_error"`.
- The last round builds but `connected` fails: stage1 true, stage2 false, `stage2Reason: "gate:connected"`.
- `generate` throws a provider error: `provider_error`. An aborted signal: `timeout`.
- With `draw: true` and a stub kernel returning `box()`, the four files exist. A failing drawing (inject `svgToPng` throwing) gives `drawing: "error"`, and stage 2 is still true.

**Steps:** test, fail, implement, pass, then commit `feat(muse-bench): one case through the hardened loop with MUSE stages`.

### Task 5: Gemini judge (`muse-judge.mjs`)

**Files:** Create `scripts/lib/muse-judge.mjs` and `test/cad-gen/muse-judge.test.js`.

**Interfaces (produces):**
- `JUDGE_MODEL`
- `CATEGORIES`: the six `category_en` names, in rubric order.
- `PAIRS = { functionality: ["Functional Adaptation", "Usage Stability"], manufacturability: ["Tolerance", "Manufacturability"], assemblability: ["Assembly Readiness", "Joint Design"] }`
- `SCORE_PROMPT`: verbatim `generate_score_sp` plus the MIT notice in a JSDoc block.
- `buildJudgeRequest({ spec, rubric, referencePng: Buffer, generatedPng: Buffer }): object`. The parts go in this order: `<Task_Doc>` text, the reference image, the `<Generated_SVG>` marker plus our image, then the `<Evaluation_Rubric>` text. System instruction: `SCORE_PROMPT`.
- `parseJudgeResponse(text): { items, score, subScores, mismatch: boolean }`
  - Strips code fences and checks the six categories with 0/1 scores.
  - Recomputes `score = sum / 6`; `mismatch` is `|judge − ours| > 0.01`.
  - Throws `JudgeFormatError` on anything else.
- `judgeCase({ apiKey, kase, generatedPngFile, fetchImpl?, sleep? }): Promise<ScoreRecord>`, with the retry policy:
  - 429/500/503: up to 4 retries at 15/30/45/60 s, or the server's `retryDelay` when it is under 120 s.
  - A malformed response: 1 retry.
  - 402/403: throws `JudgeAbort`.
  - Anything else exhausted: returns `{ judgeError }`.
  - `ScoreRecord` = `{ model, items, score, subScores, mismatch, usage, latencyMs }` or `{ model, judgeError }`.

**Tests (stub `fetchImpl` and `sleep`):**
- The request body: the system instruction equals `SCORE_PROMPT`, the part order is as above, `temperature: 0`, JSON mime type, and the header `x-goog-api-key` is set with no key in the URL.
- A valid response parses. Sub-scores pair correctly: Functional 1 and Usage 0 give functionality 0.5.
- A fenced response parses. A mismatched normalised score sets `mismatch` and keeps our value.
- A missing category, or a score of 2, throws `JudgeFormatError`.
- 503, 503, then 200 succeeds after two sleeps. 402 throws `JudgeAbort`. Two malformed responses return `judgeError`.

**Steps:** test, fail, implement, pass, then commit `feat(muse-bench): Gemini-3.1-Pro judge with MUSE's scoring prompt`.

### Task 6: Summary and report (`muse-summary.mjs`)

**Files:** Create `scripts/lib/muse-summary.mjs` and `test/cad-gen/muse-summary.test.js`.

**Interfaces:**
- Consumes `CaseRecord` (Task 4) and `ScoreRecord` (Task 5), joined by id.
- Produces:
  - `PAPER_BASELINES`: four rows from the spec (GPT-5.5 77.36/70.75/52.36; Gemini 3.1 Pro 65.09/58.49/43.40; Claude Opus 4.7 76.42/60.38/39.47; GLM-5.1 31.13/27.36/18.87), with the citation in JSDoc.
  - `summarise(cases, scores, config)`, which returns:
    - `{ n, code, geometry, final, functionality, manufacturability, assemblability }` as percentages over all n cases
    - `categoryPassRates`
    - `byMethod` and `byComponents` (`1` / `2-5` / `6+`), each with the same funnel numbers
    - `stage1Reasons` and `stage2Reasons` (counts)
    - `judge: { scored, errors, mismatches, tokens, seconds }`
    - `drawingErrors`
    - `leaderboardComparable` (true only when n = 106 with no `--ids`, `--limit` or `--method` filter)
  - **Funnel rules:**
    - a case failing stage 1 or 2 scores 0;
    - a case with `judgeError` or `drawing: "error"` is **excluded** from `final` and the sub-scores (the denominator shrinks, and the count is reported);
    - a case that passed stage 2 but has no score yet counts as pending, and the summary refuses to be leaderboard-comparable while any are pending.
  - `renderMarkdown(summary): string`:
    - the headline table beside `PAPER_BASELINES`, then the breakdowns and judge health;
    - the spec's deviation list verbatim;
    - the attribution line: "MUSE dataset (c) its authors, CC BY 4.0; judge prompt from the MUSE harness, MIT".
  - `writeReport(runDir, summary, cases, scores)`: writes `summary.json`, `summary.md` and `index.html`.
    - `index.html` has a card per case: the reference PNG and our drawing PNG side by side, the stage outcome, the six items with rationales, and the score.
    - It follows `bench-report.mjs`'s HTML-escaping helper pattern.

**Tests:**
- Funnel zeros: 4 synthetic cases (one stage-1 fail, one stage-2 fail, one scored 1.0, one scored 0.5) give code 75%, geometry 50%, final 37.5%.
- `judgeError` exclusion changes the denominator and the count.
- Sub-score pairing.
- `byMethod` grouping.
- `leaderboardComparable` false for a filtered run.
- The markdown contains the headline row, the four baseline rows, the attribution line and every deviation bullet.
- `index.html` escapes `<` in a rationale.

**Steps:** test, fail, implement, pass, then commit `feat(muse-bench): funnel summary, leaderboard table and HTML report`.

### Task 7: CLI (`scripts/muse-bench.mjs`) and docs

**Files:**
- Create `scripts/muse-bench.mjs` and `test/cad-gen/muse-cli.test.js`.
- Modify `packages/cad-gen/AGENTS.md`: add muse-bench to the Harnesses section.

**Interfaces:**
- Consumes everything above, plus `requireEnv`, `loadEnv`, `cadGeneratorFrom`, `loadCadKernel` and `PROJECT_ROOT` (`cad-harness.mjs`).
- Produces: `parseArgs(argv)` (exported) and a `main()` behind `if (import.meta.main)`.

**Behaviour:**
- **Flags** (per the spec CLI section): `--limit`, `--ids`, `--concurrency` (default 4), `--method cnc|print|laser`, `--no-judge`, `--judge-only <runDir>`, `--resume <runDir>`, `--out` (default `test-results/muse-bench`). Numeric flags are validated as in `cad-bench.mjs`.
- **Order of work:**
  1. `fetchMuse`, then `loadCases`, then the filter.
  2. `pool` over the cases runs `runCase`. When judging is on and stage 2 passed with `drawing: "ok"`, `judgeCase` runs inside the same pool slot. Gemini latency overlaps generation.
- **Records:** `<id>.json` and `<id>.score.json` via `writeJsonAtomic`.
- **Resume:** `--resume` skips cases with a record. `--judge-only` judges only the cases that have `drawing: "ok"` and no score (or a `judgeError`).
- **Aborts:**
  - 3 consecutive `provider_error` outcomes stop the pool, as in `cad-bench.mjs`.
  - `JudgeAbort` stops the pool and prints the AI Studio billing message.
- **Keys:** `GEMINI_API_KEY` comes from `loadEnv(PROJECT_ROOT/.env.gemini)`, then from `.env`. If it is missing and judging is on, exit 2 before any generation, naming `.env.gemini`.
- **Summary:** always rebuilt from the directory's records, then `writeReport`. The run directory and the headline line are printed.

**Tests:**
- The `parseArgs` defaults.
- Every flag, including `--judge-only` and `--resume` taking a path.
- A non-numeric `--concurrency` throws.
- `--method` validation.
- `--no-judge` combined with `--judge-only` throws as contradictory.

**Steps:**
- [ ] Test, fail, implement, pass.
- [ ] Run the whole `test/cad-gen/`, lint, tsc and fallow.
- [ ] Commit `feat(muse-bench): CLI with resume, judge-only and abort rules`.

### Task 8: Live smoke run and record

**Not code.** Run in the worktree (`.env` and `.env.gemini` copied in, never committed):

```bash
bun scripts/muse-bench.mjs --ids pen_holder,stool,vase --concurrency 1
```

**Expected:**
- All three reach a stage outcome.
- `pen_holder` passes stage 2 and gets a non-zero judge score.
- `summary.md` and `index.html` are written, and the headline is marked not leaderboard-comparable (filtered).
- A person opens `index.html` and compares the three drawings against the references by eye.

Then the full run: `bun scripts/muse-bench.mjs`, about 106 Gemini calls. Record the headline row and the funnel next to the paper's rows in a new comment on issue #89, or in a new MUSE issue if the user prefers. Then push the branch and open the PR (ask before merging).

---

## Self-review

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | Decision log | Global Constraints and Task 7 |
  | Dataset facts | Task 2 |
  | MUSE protocol | Tasks 4, 5 and 6 |
  | Deviations | Task 6 markdown |
  | Architecture and the targeted refactor | Task 1 |
  | CLI | Task 7 |
  | Per-case flow | Task 4 |
  | Drawing | Task 3 |
  | Judge | Task 5 |
  | Output | Task 6 |
  | Error handling | Tasks 5, 6 and 7 |
  | Testing | per-task tests and Task 8 |
  | Cost | reported in Task 6 (judge tokens and seconds) |

- **Names line up across tasks:**
  - `CaseRecord.drawing` takes `"ok" | "error" | null` (Task 4) and Task 6 checks for `"error"`.
  - `ScoreRecord.judgeError` (Task 5) is the field Tasks 6 and 7 exclude on.
  - `orthoDepth` (Task 1) is consumed by `drawingEdges` (Task 3).
  - `PAIRS` (Task 5) drives the sub-scores in Task 6.

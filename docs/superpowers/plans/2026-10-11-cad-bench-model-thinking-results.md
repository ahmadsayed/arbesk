# CAD bench results — DeepSeek Pro vs Flash, and first-attempt thinking

Two questions answered on the CADPrompt bench (`scripts/cad-bench.mjs`, measured variant, 200
samples), all runs on main @ `9a254fc`, 2026-10-11:

1. Is `deepseek-v4-pro` a better base model than `deepseek-flash`? **No.**
2. Should Jev's complexity score turn on DeepSeek thinking for the first attempt? **No** — and
   neither should thinking be on for every first attempt. Repair rounds keep thinking, as shipped.

Decision: no change. Production stays on `deepseek-flash`, first attempt plain, repairs thinking.

Per-sample data for every run: [`2026-10-11-cad-bench-results.csv`](2026-10-11-cad-bench-results.csv)
(IDs and metrics only — the CADPrompt dataset has no licence, so no prompt text is committed).

## Runs

| Run | Command | Model | First-attempt thinking |
|---|---|---|---|
| run#1 | `bun scripts/cad-bench.mjs --model deepseek-v4-pro` | Pro | off |
| run#2 | `bun scripts/cad-bench.mjs --model deepseek-flash` | Flash | off |
| run#3 | `bun scripts/cad-bench.mjs --model deepseek-flash --thinking on` | Flash | on |
| run#4 | `bun scripts/cad-bench.mjs --model deepseek-flash --thinking off` | Flash | off |
| run#5 | `bun scripts/cad-bench.mjs --model deepseek-flash --thinking on` | Flash | on |

Runs were sequential (no provider contention) and the thinking arms interleaved (on, off, on) so
drift over the afternoon hits both. All runs: Jev library selector on, repair rounds in thinking
mode (`CAD_REPAIR_THINKING` default), 3 repair attempts, 120 s provider timeout. API model IDs come
from `GET https://api.deepseek.com/models`: `deepseek-flash` (DeepSeek-V4.1-Flash) and
`deepseek-v4-pro` (DeepSeek-V4-Pro).

Single runs are noisy (see the noise-floor note: ~25/200 outcome flips run to run), so every
comparison below is paired per sample with a two-sided sign test, not headline medians.

| Run | Built | Timeouts | First pass | Median IoU | p50 latency | p90 latency | p50 completion tokens |
|---|---|---|---|---|---|---|---|
| run#1 Pro, off | 190 | 0 | 169 | 0.640 | 5.4 s | 72.6 s | 489 |
| run#2 Flash, off | 200 | 0 | 162 | 0.762 | 5.7 s | 24.6 s | 504 |
| run#4 Flash, off | 199 | 0 | 159 | 0.742 | 6.3 s | 27.6 s | 521 |
| run#3 Flash, on | 191 | 9 | 180 | 0.715 | 15.7 s | 86.8 s | 2497 |
| run#5 Flash, on | 191 | 9 | 183 | 0.713 | 14.3 s | 89.2 s | 2436 |

IoU is exact IoU with failures scored 0, as in the bench summary.

## 1. Pro vs Flash (run#1 vs run#2)

| | Pro | Flash |
|---|---|---|
| Compile | 95.0% | **100.0%** |
| First pass | **84.5%** | 81.0% |
| Exact IoU, median | 0.640 | **0.762** |
| PC distance, median | 0.020 | **0.014** |

Paired:

- **Build:** 10 samples built under Flash only, 0 under Pro only — p = 0.002.
- **First pass:** 26 Pro-only vs 19 Flash-only — p = 0.37, noise.
- **IoU (±0.02):** Flash better on 46, Pro on 29 — p = 0.06; mean −0.06 for Pro.

All 10 Pro failures, every one built by Flash:

| Sample | Failure | Jev triage |
|---|---|---|
| 00523882 | `connected` — second body overlaps the main body by ~1 mm | misread_prompt (unsure) |
| 00039681 | `connected` — stacked pipe sections touch at z = 24.2, never fuse | helper_misuse |
| 00520726 | `connected` — inner body touches a cavity wall | misread_prompt |
| 00522865 | `connected` — inner body ends flush at z −0.5 | degenerate_boolean |
| 00851553 | `connected` — inner body touches only | gate_too_strict |
| 00681547 | `connected` — a feature severs the part along z | degenerate_boolean |
| 00997068 | `connected` — a feature severs the part along x | degenerate_boolean |
| 00986712 | `nonempty` — a cut removed the whole part | degenerate_boolean |
| 00684841 | static — parameter `rotateZ` must declare unit `"mm"`, all 3 attempts | helper_misuse |
| 00998749 | `JSON Parse error: Invalid number`, all 3 attempts | other |

Seven of ten are the `connected` gate: Pro places faces flush instead of overlapping, and repair
does not move it off that even though the gate message asks for ≥ 0.5 mm overlap. Leads worth
following independently of the model choice:

- **00851553** — Jev calls it a gate false positive; check whether the `connected` gate is too
  strict on bodies inside a cavity.
- **00684841** — the static check requires `"mm"` on every parameter, including a rotation. An
  angle parameter wanting degrees is reasonable; the rule may be wrong rather than the model.

## 2. First-attempt thinking (run#2, #4 off vs run#3, #5 on)

Same-arm noise for scale: first-pass flips are 15/12 between the two off runs and 7/10 between
the two on runs, against 10/28 and 7/31 across arms.

Paired over two runs per arm (per-sample mean of each arm):

| | Thinking better | Plain better | p |
|---|---|---|---|
| First pass | 40 | 11 | 6e-5 |
| Built | 0 | 13 | 0.0002 |
| IoU ±0.02, timeouts as 0 | 40 | 36 | 0.73 (mean −0.017) |
| IoU ±0.02, answered samples only (n = 195) | 41 | 28 | 0.15 (mean +0.008, median 0) |

- **First pass improves for real** — 80% → 91%.
- **Shape does not** — no significant IoU gain even ignoring timeouts.
- **It costs builds** — 4.5% of thinking requests hit the 120 s timeout (9 per run). Five samples
  timed out in both thinking runs: 00036518, 00671898, 00681547, 00986712, 00998088.
- **It costs time and tokens** — p50 latency ~2.5x, p90 ~3.5x, ~5x completion tokens.

The first-pass gain buys little: plain mode already reaches 100% built through repair rounds (which
think), and finishes sooner than one thinking attempt.

### Does Jev's complexity score find where thinking helps?

`complexity.score` (observe-only, recorded per sample) binned post hoc:

| Score | n | First pass off → on | IoU change, answered | Timeouts |
|---|---|---|---|---|
| < 0.5 | 38 | 96% → 100% | +0.001 (3 up, 5 down) | 0 / 76 |
| 0.5 – 0.95 | 39 | 81% → 91% | −0.013 (8 up, 10 down) | 7 / 78 |
| ≥ 0.95 | 123 | 75% → 88% | +0.016 (30 up, 13 down) | 11 / 246 |

The score cleanly identifies where thinking is useless (< 0.5). The only IoU hint is in ≥ 0.95,
but it is small, the cut points were chosen after seeing the data, and that bin is 62% of
requests — routing on it would still slow most requests and keep most timeouts.

### If this is revisited

The one experiment worth running: thinking only for complexity ≥ 0.95, with the same 90 s
fall-back-to-plain that repair rounds use (`REPAIR_THINKING_TIMEOUT_MS` in
`packages/cad-gen/src/backend/facade.ts`), so a slow thinking call never fails a request. Then
decide whether ~+0.016 IoU is worth ~15 s more wait on ~60% of requests. Repeat each arm at least
twice and pair per sample, as here.

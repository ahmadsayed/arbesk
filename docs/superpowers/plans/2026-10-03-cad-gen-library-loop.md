# cad-gen library loop — handoff

**Branch:** `feat/cad-gen-enhance-loop` (pushed). **Status:** COMPLETE - all 12 iterations done (10-12 ran in parallel worktrees and were
merged on 2026-10-04). The next session starts a new loop from "What's next" below.

## What the loop is

Each iteration does ONE thing, highest value first, against live DeepSeek + Jev
(`DEEPSEEK_API_KEY`, `JEV_API_KEY` in `.env`):

- **(A) Defects:** `bun scripts/cad-eval.mjs --file scripts/cad-scenarios.json`, look at
  every render, fix the top root cause.
- **(B) Library:** find a permissively licensed OpenSCAD design, licence-gate it with
  `bun scripts/cad-candidates.mjs <owner/repo>[:<file.scad>]`, port it to
  `packages/cad-gen/src/core/library/<part>.ts`, prove it matches OpenSCAD with
  `bun scripts/cad-reference.mjs <case>`, register it (catalog entry, `ATTRIBUTED_HELPERS`
  with `authorGithub`, `PRELUDE_VERSION` bump, a scenario), and prove DeepSeek calls it.

Every iteration ends with `bun test test/cad-gen test/api/cad-route.test.js`, eslint, the
fallow audit, a commit with a results table, and a push. Files are staged by name; the
local `blockchain/deployments/*.json` changes are never committed. The full method is in
`packages/cad-gen/AGENTS.md` ("Two-stage generation" and "Growing the library").

### Rules the user set

- Licence first, conservatively: GitHub's SPDX, Jev's reading of the LICENSE text and of the
  file's provenance (README included), and a human read must ALL say permissive or
  attribution-only. Never GPL/LGPL/AGPL, unlicensed, CC-BY-SA or non-commercial.
- Credit the author(s) AND their GitHub profile for every port, even public-domain ones, and
  reproduce any notice the licence requires (MIT and BSD do).
- A port is done when it matches OpenSCAD's render of the UNMODIFIED original: size,
  volume and body count.
- Use Jev wherever a typed judgement helps — it is ~$0.042 per million input tokens.

## Done so far (this branch)

| # | Commit | Result |
|---|---|---|
| — | `640b61b` | syntax gate: a script that cannot parse never leaves the server |
| — | `48cf7a2` | Pi 4 ports on the correct walls; `boardCase` refuses a port off its wall |
| — | `0da5731` | BOSL2 hinges (`knuckleHinge`, `printInPlaceHinge`), exact vs OpenSCAD |
| — | `b69dc28` | library catalog + Jev selects which modules DeepSeek sees |
| 1 | `a40d4b9` | kernel body count + `connected` gate + client repair in the harness |
| 2 | `7d9d2ed` | Jev licence gate (`cad-candidates.mjs`); Matthew Burke's spool holder |
| 3 | `746dc7e` | 126-repo discovery; Jev refuses artistic requests (422 `CAD_REQUEST_UNSUITABLE`) |
| 4 | `0215808` | vector76's Gridfinity bin (`gridfinityCup`), 5 configs vs OpenSCAD |
| 5 | `fb8a09c` | Jev `piece_count` replaces yes/no; `bodyAllowance` + `MULTI_BODY_HELPERS` |
| 6 | `158bf71` | AaronVerDow's wall hook; no portable pipe clamp found |
| 7 | `dc5a7d8` | Maciej Małecki's knob (`knob`), exact vs OpenSCAD in 3 configs |
| 8 | `e659765` | GT2 pulleys owned by `gt2Pulley`, built from the Gates standard |
| 9 | `c4e4b46` | `extrusionSpoolArm` for 2020 extrusion, first-party from published facts |
| 10 | `ef6b0bc` | Jev `pieces_separate` + `pieces` gate: separate pieces that came out fused now fail |
| 11 | `47870dc` | candidate rank on five Jev questions (no more saturation); CERN-OHL-P-2.0 allowed |
| 12 | `7c85df9` | `pipeClamp`, a two-half bolted clamp, first-party from ISO fastener sizes |

Library today: `pipeClamp` (spec-derived), `extrusionSpoolArm` (spec-derived), `knob` (ported), `gt2Pulley` (spec-derived), plus `knuckleHinge`,
`printInPlaceHinge`, `spoolHolder`, `gridfinityCup`, `wallHook` (ported), and the
earlier `phoneStand`, `boardCase`, `spurGear`, `gridfinityBase`, `railHook`, `cupRack`. Each Jev call asks library fit
(one `score` per catalog entry), `piece_count` (choice) and `cad_suitable` (noul)
together.

Last full run (iteration 8 post-change, 14/16): `pulley-gt2` now builds through
`gt2Pulley()` (Jev `gt2-pulley=1.99`, one solid, 13 ms, exact envelope) and `knob`
through `knob()`. Two non-deterministic regressions appeared that also passed the
identical re-rank run 80 minutes earlier: `uno-case` (`InvalidConstruction` after 2
repairs) and `spool-holder` (2 bodies after 2 repairs - the known hand-built 2020
arm). Watch both; if either fails twice in a row it earns an iteration.
**Note:** the attempt gallery was cleaned before iteration 8, so the counter reset -
iteration-8 runs live in `attempt#1` (re-rank full), `attempt#2` (GT2 live proof),
`attempt#3` (post-change full), alongside the kept `attempt#20-22`.

## Iteration 8 — DONE

Owned GT2 pulleys with `gt2Pulley`, written from the Gates PowerGrip GT standard
(the spurGear pattern: standard maths, no permissive reference exists). Key
numbers, cross-checked: pitch 2mm; outside = pitch − 2×0.254 (a Gates-licensee
catalog holds pitch−outside = 0.020" at every size, and a 20T pulley is 12.22mm
across); groove 0.76mm deep, 40° straight flanks (the printable approximation of
the curvilinear molded profile). Flanges, bore, optional M3/M4 set-screw. Five
unit tests pin envelope/tooth-count/grooves/cutters/refusals. Two real bugs were
caught before shipping: the bore cutter z-centred on the origin (top flange had
no hole - invisible to a bbox check), and mirror-flank arcs in the outline that
overshot by tan-error. Fallow's ratchet flagged the helper CRITICAL (CRAP 116);
the decrap process (characterization tests first, one extraction per move) split
it into `resolveGt2Spec`/`assertGt2Spec`/`gt2ScrewDiameter` - audit clean.

## Iteration 9 — DONE

Fresh full run (attempt#4, 2026-10-04): **17/17 build, no repair rounds, no
failures** - the `uno-case` flake did not recur. But two "passes" were wrong on
inspection: the spool ARM had a 6mm rod for a 55mm spool hole, and the pipe clamp
came back as ONE fused block where Jev expected 2 pieces.

No portable 2020 spool arm exists (robinolejnik/spool-holder is CC0 but FreeCAD
only; sarahannalien's MIT holder hangs under a shelf; jsconan GPL-3.0; avolkov
share-alike). So `extrusionSpoolArm` is first-party, from Misumi HFS5-2020 (20mm
profile, 6mm slot, 1.6mm slot lip), ISO M5 sizes and 1 kg spool sizes: a slot-keyed
plate, two M5 holes on the slot centre line, a 32mm rod sized from `spoolBore`,
tilted 5 deg, an end lip, and a gusset split into two side ribs so the lower screw
head and the driver stay reachable (a full-width gusset buried it - caught before
shipping by a probe test). Live attempt#5: the 2020 arm, a 3 kg/85mm-bore arm and
an Ender-3 V-slot arm all call it, one body, first attempt.

## Iterations 10-12 — DONE (parallel)

Ran as three sub-agents in separate worktrees on disjoint files, merged in order
10, 12, 11, plus `pipeClamp: 2` added to `MULTI_BODY_HELPERS` at merge (`2377be8`).
Merged tree: 302 tests pass; full live run (attempt#6) **17/17 build, 0 repair
rounds**; the pipe clamp - the loop's longest-standing failure - now goes through
`pipeClamp`, 2 bodies, Jev `pieces_separate` 0.95.

- **10** - one more Jev question in the same call, `pieces_separate` (noul: would
  printing this as ONE fused solid be wrong?). Calibrated on 20 prompts: fused-is-wrong
  0.84-0.97, fused-may-be-fine <= 0.65; threshold 0.75. `bodyFloor()` + new `pieces`
  gate (KernelLimits.minBodies) fail a part with fewer bodies than that. Live: fused
  coasters, sliding lid and clamp were each repaired into separate pieces.
- **11** - `cad-candidates.mjs` ranks on `is_scad_design` x general-purpose x
  (parametric + printability + maturity), with a .scad sample in the state. 158
  candidates re-judged, 137 portable, only 12 >= 0.7. Two old licence passes were
  WRONG and are now rejected: CameronBrooks11/snapfit-scad (README: adapted from
  Thingiverse) and IOIO72/scad-universal-stand (file header CC-BY-NC-SA). Neither was
  ported - verified. CERN-OHL-P-2.0 allowed after reading the v2 text (s3.4); porter
  obligations in AGENTS.md.
- **12** - `pipeClamp`: two half-rings standing on their end faces (hoop load along
  the layers), counterbored heads on one half, corner-up hex nut pockets on the other,
  1mm pinch gap; refusals name the fix. Live: 25mm/M5, 32mm/M6 and 20mm/M4 clamps all
  call it, 2 bodies, first attempt.

## What's next (a new loop)

0. **Cable clip -> a library module.** The full re-test (2026-10-04) found it failing
   twice in a row. Two of its causes are now fixed in the kernel/gates (a zero-volume
   fillet flake was counted as a body; a through-cut that SEVERED the part got
   "move it" advice), and it passes 3 of 4 live runs - but it is still hand-drawn
   and varies every run. A `cableClip` helper (desk-edge / screw-down / adhesive,
   n cables of diameter d) would end it, as ports did for hooks and bins.
0. **Kernel timeout in the browser worker.** A soap dish that filleted its whole
   finished part with `filletEdges` ran > 8 minutes in the harness (no cap there);
   a fresh generation took 38 ms. The worker needs a wall-clock cap that reports a
   repairable failure ("fillet before cutting, or round the 2D profile").

1. **Watch: the `uno-case` lid.** attempt#6 put its `pieces_separate` at 0.71, just
   under the 0.75 threshold, and DeepSeek drew it as one piece. If a case-with-lid
   request starts failing or shipping fused, look here first.
2. **Hinged-lid box (iteration 10 finding)** - passed with 2 bodies but its "lid" was a
   solid block resting loose in the box. Neither body gate can see that; a knuckleHinge
   catalog nudge or a Jev check on the lid's shape would.
3. **Top ranked ports** (new ranking, all portable): `rcolyer/threads-scad` (CC0, 0.89 -
   threads, caps, bolts), `lijon/jl_scad` (BSD-2, 0.87), `Irev-Dev/Round-Anything` (MIT,
   0.76 - fillets, could replace slow minkowski fillets), `adgaudio/OpenSCAD_connectors`
   (MIT, 0.73), `Lavakoons-n-Peebles/openscad-Lid-Generator` (MIT, 0.69).
4. **`cad-candidates.mjs` speed** - ~6 s per candidate, sequential: up to 7 `gh` spawns
   each. Run candidates concurrently (e.g. 8), use GitHub's /license endpoint (text +
   SPDX in one call), and cache fetched files. Also widen the licence lookup to
   `License.txt` (thecarp/GearHinge's licence lives there).

## Backlog after that

- **(resolved in 9, keep watching) `uno-case` flake** — `InvalidConstruction` after 2 repairs in the iteration-8
  post-change run, but it passed the identical re-rank run the same evening. If it
  fails twice in a row, root-cause it (boardCase + lid geometry); if it keeps
  flip-flopping, consider whether the repair prompt handles kernel-status failures
  as well as it handles `connected`.
- **Soap-dish repair blind spot (observed attempt#20, passed since)** — root cause
  of the failure: the model placed the ribs at the SAME centered pitch as the drainage
  slots (identical `start + i*pitch` arithmetic), so every rib sat over a slot; the
  slot cut removed the rib's 0.5 mm fuse zone and the overlap repair hint cannot fix
  that (it extends the rib INTO the void). The repair message for INSIDE-touching bodies
  could add: if the fuse zone crosses a through-cut, move the feature clear of the cut
  or bridge across it. Nondeterministic trigger, so verify any hint change across
  several runs.
- **Gridfinity label tabs** — "label tabs" (plural) got one tab; the catalog guidance
  could say `leftchamber` gives one per compartment.
- **Wall-hook vs over-door** — "hook on a door" picked `wallHook`; an over-door hook is
  `railHook`. Consider a Jev `choice` between mounting styles.
- **Slow fillets** — hand-drawn parts using `filletEdges` in minkowski mode still take
  10-70 s (earlier wall hook). Ports remove them one family at a time; the knob port
  removed the knob instance (minkowski knurl, was 17.9 s).
- **Browser worker (milestone 2)** — still unbuilt. `scripts/cad-eval.mjs`'s
  `buildWithClientRepair` + `bodyAllowance` are the reference for its repair loop; the UI
  must handle 422 `CAD_REQUEST_UNSUITABLE` by offering Tripo3D.

## How to resume

```text
/loop Grow and harden @arbesk/cad-gen on branch feat/cad-gen-enhance-loop, one iteration
per firing, against live DeepSeek + Jev (keys in .env) ... (see the loop prompt in the
session that produced this file; the rules above are the substance). Start a NEW loop
from "What's next" in docs/superpowers/plans/2026-10-03-cad-gen-library-loop.md.
```

Prerequisites: `openscad` on PATH (2021.01 works); `test-results/reference/` holds cloned
reference repos and `candidates.json` (gitignored — rebuilt by the scripts if missing).

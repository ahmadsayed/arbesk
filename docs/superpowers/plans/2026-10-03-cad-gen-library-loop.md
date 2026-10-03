# cad-gen library loop — handoff

**Branch:** `feat/cad-gen-enhance-loop` (pushed). **Status:** iteration 9 of 12 done.
Next: **iteration 10** (below).

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
| 9 | (this commit) | `extrusionSpoolArm` for 2020 extrusion, first-party from published facts |

Library today: `extrusionSpoolArm` (spec-derived), `knob` (ported), `gt2Pulley` (spec-derived), plus `knuckleHinge`,
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

## Iteration 10 — start here

1. **Fused multi-piece parts (gate gap)** — the connected gate only caps bodies
   from ABOVE. attempt#4's two-half pipe clamp came back as one fused block (Jev
   expected 2) and passed. A request whose Jev `piece_count` is >= 2 and whose
   part is FEWER bodies is suspect, but not always wrong (a hinged box can be one
   piece with a living hinge). Options: a repair hint when bodies < expected; or a
   Jev `noul` on whether the pieces "must be printed separately" to decide
   whether fewer is a defect. Then the clamp itself (still no portable source -
   see backlog) is the natural follow-up.
2. **Finer usefulness ranking** — Jev's single 0-3 usefulness score saturates (45 repos
   ≥ 2.8). Split it into several questions (reusable / parametric / printable /
   general-purpose) and rank on the combination; re-rank `candidates.json`. Also screen
   out non-SCAD "skill" repos that ranked at the top.
3. **Allow CERN-OHL-P-2.0** in `cad-candidates.mjs`'s `PORTABLE_SPDX` — a permissive
   hardware licence; `3d-paws/3D-PAWS-Print-Files` was rejected only for that. Confirm
   with a read of the licence text before adding.

## Backlog after that

- **Pipe clamp (two halves, bolted)** — still fails (12 bodies after 2 repairs). No
  portable source found in 17: all real split clamps are unlicensed or GPL/AGPL. Options:
  keep searching (Printables/GitHub code search with other words: "split collar",
  "shaft collar", "tube clamp two piece"), or write a helper from first principles as
  with gears (a standard shape, not a hand-tuned profile).
- **Watch: `uno-case` flake** — `InvalidConstruction` after 2 repairs in the iteration-8
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
- **Threads** — `rcolyer/threads-scad` (CC0) and `adrianschlatter/threadlib` (BSD-3) passed
  the repo gate; useful for caps, bolts, jar lids.
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
session that produced this file; the rules above are the substance). Continue from
iteration 9 in docs/superpowers/plans/2026-10-03-cad-gen-library-loop.md, stop after
iteration 12.
```

Prerequisites: `openscad` on PATH (2021.01 works); `test-results/reference/` holds cloned
reference repos and `candidates.json` (gitignored — rebuilt by the scripts if missing).

# cad-gen library loop — handoff

**Branch:** `feat/cad-gen-enhance-loop` (pushed). **Status:** paused after iteration 7 of 12.
Resume at **iteration 8** (below).

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

Library today: `knob`, `knuckleHinge`, `printInPlaceHinge`, `spoolHolder`,
`gridfinityCup`, `wallHook` (ported), plus the earlier `phoneStand`, `boardCase`,
`spurGear`, `gridfinityBase`, `railHook`, `cupRack`. Each Jev call asks library fit
(one `score` per catalog entry), `piece_count` (choice) and `cad_suitable` (noul)
together.

Last full run (attempt#22, after iteration 7): 15/16 scenarios build. The `knob`
scenario now calls `knob()` (Jev `knobs=1.66`, one solid, 30 ms). `soap-dish` passed
again (its attempt#20 failure was nondeterministic - see the backlog note).
`pulley-gt2` FAILED in a new way: 21 detached bodies - DeepSeek drew teeth this
time and they do not fuse (attempt#20's toothless disc built fine). `hinge` and
`pipe-clamp` are 2 bodies by design (`piece_count`).

## Iteration 7 — DONE

Ported Maciej Małecki's MIT-licensed knob (`mmalecki/openscad-knobs:knob.scad`).
Round case matched OpenSCAD exactly on the first try; the star case exposed one
real porting bug - OpenSCAD `rotate(a) translate(t)` nests the translate INSIDE
the rotated frame, which is Manifold's `.translate().rotate()` chaining order,
not `.rotate().translate()`. Three reference cases (`knob-default`, `knob-round`,
`knob-big-star`) now match to 0.000 mm; the full reference suite (17 cases)
still passes. Live proof: the `knob` scenario builds through `knob({...})` with
the catalog's subtract-the-bore pattern (round bore + flat) - 1 solid,
30 x 30 x 18 mm, kernel 30 ms. Note the port returns the UNCUTOFF solid (the
SCAD's children() cut has no Manifold equivalent); the catalog entry documents
the bore/flat subtraction with worked numbers.

## Iteration 8 — start here

Pick the highest-value item after a fresh full run. Current ranking:

1. **GT2 pulley** — now the top defect: attempt#22 failed with 21 detached
   bodies (teeth drawn but unfused); attempt#20's toothless disc built but was
   wrong. No permissive GT2 source found in 17 repos (unlicensed/GPL), BOSL2
   has none. The belt profile is a published standard (like the involute maths
   behind `spurGear`), so write the helper from the spec: 2 mm pitch, 40°
   tooth, 20 teeth -> ~12.2 mm pitch diameter, plus flanges and a bore.
2. **Spool arm for 2020 extrusion** — the `spool-holder` scenario asks for an arm on 2020
   extrusion with M5 T-nuts; `spoolHolder` is a stand, so the arm is still hand-built and
   came apart once. Search for a permissive 2020-mount spool arm; the rcarmo arms are
   MIT but printer-specific (Prusa frame, KP3S).
3. **Finer usefulness ranking** — Jev's single 0-3 usefulness score saturates (45 repos
   ≥ 2.8). Split it into several questions (reusable / parametric / printable /
   general-purpose) and rank on the combination; re-rank `candidates.json`. Also screen
   out non-SCAD "skill" repos that ranked at the top.
4. **Allow CERN-OHL-P-2.0** in `cad-candidates.mjs`'s `PORTABLE_SPDX` — a permissive
   hardware licence; `3d-paws/3D-PAWS-Print-Files` was rejected only for that. Confirm
   with a read of the licence text before adding.

## Backlog after that

- **Pipe clamp (two halves, bolted)** — still fails (12 bodies after 2 repairs). No
  portable source found in 17: all real split clamps are unlicensed or GPL/AGPL. Options:
  keep searching (Printables/GitHub code search with other words: "split collar",
  "shaft collar", "tube clamp two piece"), or write a helper from first principles as
  with gears (a standard shape, not a hand-tuned profile).
- **GT2 pulley** — see iteration 8 ranking; the failure mode changed from toothless to
  21 detached bodies (teeth drawn, unfused).
- **Soap-dish repair blind spot (observed attempt#20, passed attempt#22)** — root cause
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
iteration 8 in docs/superpowers/plans/2026-10-03-cad-gen-library-loop.md, stop after
iteration 12.
```

Prerequisites: `openscad` on PATH (2021.01 works); `test-results/reference/` holds cloned
reference repos and `candidates.json` (gitignored — rebuilt by the scripts if missing).

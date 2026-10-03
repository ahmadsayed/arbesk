# cad-gen library loop — handoff

**Branch:** `feat/cad-gen-enhance-loop` (pushed). **Status:** paused after iteration 6 of 12.
Resume at **iteration 7** (below).

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

Library today: `knuckleHinge`, `printInPlaceHinge`, `spoolHolder`, `gridfinityCup`,
`wallHook` (ported), plus the earlier `phoneStand`, `boardCase`, `spurGear`,
`gridfinityBase`, `railHook`, `cupRack`. Each Jev call asks library fit (one `score` per
catalog entry), `piece_count` (choice) and `cad_suitable` (noul) together.

Last full run (attempt#17, before iterations 5-6): 17/17 scenarios build. Since then the
hook, the piece counts and the clamp's failure mode changed — **start iteration 7 with a
fresh full run** to re-rank.

## Iteration 7 — start here

Pick the highest-value item after a fresh full run. Current ranking:

1. **Knobs** — `mmalecki/openscad-knobs` passed the repo-level licence gate. Run the
   file-level gate, port the knob module, verify, and prove it on the `knob` scenario
   (today hand-built: D-shaft bore, minkowski knurl, ~0.6 s).
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
- **GT2 pulley** — still no teeth / wrong size. No permissive GT2 source found yet
  (unlicensed or GPL so far); BOSL2 has none.
- **Threads** — `rcolyer/threads-scad` (CC0) and `adrianschlatter/threadlib` (BSD-3) passed
  the repo gate; useful for caps, bolts, jar lids.
- **Gridfinity label tabs** — "label tabs" (plural) got one tab; the catalog guidance
  could say `leftchamber` gives one per compartment.
- **Wall-hook vs over-door** — "hook on a door" picked `wallHook`; an over-door hook is
  `railHook`. Consider a Jev `choice` between mounting styles.
- **Slow fillets** — hand-drawn parts using `filletEdges` in minkowski mode still take
  10-70 s (knob, earlier wall hook). Ports remove them one family at a time.
- **Browser worker (milestone 2)** — still unbuilt. `scripts/cad-eval.mjs`'s
  `buildWithClientRepair` + `bodyAllowance` are the reference for its repair loop; the UI
  must handle 422 `CAD_REQUEST_UNSUITABLE` by offering Tripo3D.

## How to resume

```text
/loop Grow and harden @arbesk/cad-gen on branch feat/cad-gen-enhance-loop, one iteration
per firing, against live DeepSeek + Jev (keys in .env) ... (see the loop prompt in the
session that produced this file; the rules above are the substance). Continue from
iteration 7 in docs/superpowers/plans/2026-10-03-cad-gen-library-loop.md, stop after
iteration 12.
```

Prerequisites: `openscad` on PATH (2021.01 works); `test-results/reference/` holds cloned
reference repos and `candidates.json` (gitignored — rebuilt by the scripts if missing).

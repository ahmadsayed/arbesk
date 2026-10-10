# `@arbesk/cad-gen` — Engineering CAD generation

Prompt → Manifold JS → GLB/3MF. DeepSeek writes a **design document** (a script
plus a PARAMETERS table); the server runs the **static gates** and returns it;
the **client** runs the kernel, the geometry gates and the export.

> Spec: `docs/superpowers/specs/2026-09-11-cad-generation-design.md` (LOCKED)
> Plan: `docs/superpowers/plans/2026-09-11-cad-generation.md` (LOCKED)

## The split, and why the root entry exports `core/` only

```
src/
  index.ts          ← the BROWSER entry. Exports core/ ONLY.
  types.ts          Port + shared types. No runtime code.
  errors.ts         CadError hierarchy.
  core/             Environment-agnostic. Bundled into the browser.
    contract.ts       CONTRACT_VERSION, PRELUDE_VERSION
    document.ts       CadDesign parse + validate
    guard.ts          static denylist + helper allowlist
    gates.ts          the gate table
    prelude.ts        the helper LIBRARY (this is the API)
    kernel.ts         design -> mesh + stats (kernel injected as a port)
    attribution.ts    licence credits, computed from the helpers called
    export/           GLB, 3MF, design sidecar
  backend/          Node ONLY. Never reachable from index.ts.
    deepseek.ts       OpenAI-compatible client
    prompt.ts         SYSTEM_PROMPT + turn assembly
    validate.ts       validateStatic (runtime) / validateDesign (harness)
    repair.ts         bounded repair loop
    facade.ts         createCadGenerator - the only entry a route needs
    child.ts          kernel child process   ─┐ EVALUATION HARNESS ONLY.
    validate-runner.ts spawn + timeout        ─┘ Not in the request path.
    index.ts          backend barrel
```

`src/index.ts` exports `core/` **only**. The browser bundles the root entry, so
a backend re-export there would drag `node:child_process` and the DeepSeek
client into the frontend bundle. Backend consumers import
`@arbesk/cad-gen/backend/index.js`. `eslint.config.js` enforces both
boundaries (`arbesk/cad-gen-core`, `arbesk/cad-gen-backend`,
`arbesk/cad-gen-boundary`).

## Where the kernel runs

**The server never executes generated code, never returns geometry and never
exports a file.** It generates the code and runs the static gates; it cannot
claim the geometry is sound, and `CadGenerateResult` therefore has **no
`validation` field** — a field named `validation` that no longer validates is a
trap for whoever reads the API next. What it does guarantee is that the design
passed every static gate, which is what `diagnostics.attempts` records.

Why it moved (ruling S11, all measured — see the ledger): a server-side kernel
run validated a **proxy** at a different fidelity, and the two provably
disagree. An 80×60×8 plate with six 5 mm holes is 15 466 triangles at the
validation profile and 245 652 at delivery fidelity against a 200 000 budget, so
the proxy passes what the real part fails. It was also 91 % of pipeline latency,
and it made the server execute untrusted model code.

The kernel limits (`timeoutMs`, `maxTriangles`, wasm directory) left
`CadLimits` along with the kernel. `CadLimits` is now `{ maxRepairAttempts }`.

## The guard runs on BOTH hosts

The server gates before returning; the **client gates again before executing**,
and must never trust that the server ran it. This is defence in depth, not
redundancy: the browser runs model-written code in the user's own tab. The blast
radius is bounded — a module worker has no DOM and no filesystem, and Arbesk's
session token lives in main-thread memory, so a rogue worker holds no
credentials — but that bound is *maintained* by the guard plus the CSP
`connect-src` allowlist.

The guard is a deny-list plus a helper allow-list, **not a sandbox**. The
worker boundary is the sandbox. It strips comments and strings before scanning
(`stripNonCode`), so a word in a comment cannot trip it and cannot hide a
construct either; it fails closed.

## The prelude IS the library (spec D6)

`core/prelude.ts` is not a convenience layer — it is the **published API** the
model is prompted against, and `PRELUDE_NAMES` is its surface. Adding,
removing or renaming a helper is a **breaking change**: bump `PRELUDE_VERSION`
in `core/contract.ts`. A client whose prelude version does not match the
server's **refuses to execute** rather than running the code against an API it
does not implement.

The single most useful empirical finding about this whole system: **a model
calls a helper when it believes it cannot do the job itself.** Families that
work do so because a primitive owns them (`spurGear`, `gridfinityBase`,
`phoneStand`, `boardCase`, `railHook`); families that fail repeatedly fail
while the model draws the part by hand. Rules must be ABSOLUTE, and a competing
recipe must be **demoted or removed** — a merely discouraged alternative still
wins.

**When a rule must hold, make it a gate.** A catalog entry's `requires`
(`{ when(prompt), helper, error }`) feeds the server's `required-helper` static
gate: a request of that kind whose script does not call the helper is a failed
attempt, and `error` is the repair instruction. Needed because a hand-drawn part
can be one watertight body that passes every geometric gate - "gridfinity
baseplat 2x3" came back as bumps on a slab, a single attempt, all gates green.
Keep `when` narrow (a part that merely *fits on* a baseplate is not one), or
the loop burns every attempt on a request it cannot satisfy.

## Fillet fidelity

Manifold is a **mesh** kernel, not a B-rep: there is no fillet primitive.
`filletEdges` is an approximation and says so:

| Mode | Use | Cost |
|------|-----|------|
| `exact` | prismatic parts, where the opening is really a chamfer/round on a 2D profile | cheap — prefer this |
| `minkowski` | true 3D rounds on convex edges | expensive (5–23 s at delivery fidelity, worse on concave geometry) |
| `smooth` | appearance only | cheap, geometrically wrong |

`filletEdges`/`chamferEdges` take a `quality` (`"draft"` default, `"high"` on
request), reported on `stats.filletQuality`, **so a draft fillet is never
mistaken for a high-quality one**. Steering the model to round the 2D profile
before extruding is the fix that actually works; hand-built fillets produce
empty solids and `add(empty)` is a silent no-op.

## Exporters

`core/export/` — used by the client, the harness and the tests, never by a
route.

- `meshToGlb(mesh, design)` — mm/Z-up → m/Y-up applied as a **node matrix**,
  never baked into vertices. Serialized through asset-core's `serializeGLB`;
  **never hand-roll a GLB container.** (The eval harness used to, and it wrote
  no normals and no design sidecar — exactly the drift a shared core prevents.)
- `meshToGltf(mesh, design)` — self-contained glTF JSON (the binary chunk as
  a base64 data URI), same `buildPartDocument` as the GLB, so the two cannot
  drift. (The generation pipeline's client-side render target is 3MF via
  `meshTo3mf` — the browser worker exports the part as `asset.3mf`; this
  glTF exporter serves previews and harnesses.)
- `meshTo3mf(mesh, design)` — hand-written OPC package, millimetres, Z-up.
  Deliberately not manifold's `lib/export-3mf.js`: that path pulls
  `@jscadui/3mf-export`, a second `@gltf-transform` and an esbuild-wasm peer,
  and offers no hook for the sidecar.
- The **design sidecar** travels in both: OPC part `Metadata/arbesk_cad.json`
  in the 3MF, `asset.extras.arbesk_cad` in the glTF. Any CID of a generated
  part therefore round-trips the **full design state**, which is what makes the
  stateless `sourceRef` path lossless.

## Licence attribution (spec D9, §8.1)

A ported design is a **derivative work**, so its licence travels with the output.
`core/attribution.ts` holds `ATTRIBUTED_HELPERS` (helper → work, author,
licence, url) and `attributionsFor(code)`, which intersects that table with
`referencedIdentifiers(code)` — the same scan the guard performs, so there is no
second parser to drift.

**The credit is computed, never model-authored.** A model cannot be relied on to
remember a licence, and an attribution that depends on remembering is one that
goes missing the first time the prompt is trimmed. Computing it also stops
over-claiming: a script that never calls the helper earns no credit for it. The
route returns it on every response, and it is **not optional** — an empty array
is the claim "nothing licensed was used", which the server can actually support.

The licence gate, as a rule:

- **Facts and standards** (a 42 mm grid, a board's hole spacing) — **no entry**.
  Dimensions are not creative works, so there is nothing to credit.
- **Permissive code** (MIT, BSD, Apache-2) — **entry here**, even though the
  licence only asks for a notice. A notice buried in our source is not a credit
  the person holding the printed part can see, and crediting costs nothing but
  the truth.
- **Attribution designs** (CC-BY) — **entry here, and required**.
- **Copyleft (LGPL, GPL, AGPL) is never ported.** Translating is creating a
  derivative work, so the copyleft would attach to our code. MCAD's gears are
  LGPL-2.1 and are out for exactly this reason; BOSL2's are BSD-2 and are in.

One sharp edge worth keeping: facts are not copyrightable, so reading a
GPL-licensed file to learn that a board is 85 mm long creates no derivative work
— only copying its **expression** would. Quote numbers from a primary source;
never lift code or prose from a copyleft file.

Because the attribution is a pure function of the code, and the code is embedded
in every export, a saved or published part keeps its credit after the
conversation is gone — and a correction to the table reaches every existing
part rather than freezing a wrong credit. Persisting it into the manifest is
the client's job: the browser CAD seam stamps
`metadata.cad = { summary, provider, attribution, providerTaskId }` on the
generation manifest (`stageCadAsset` in `frontend/src/js/services/api.ts`).

## The two endpoints

`POST /api/v1/cad/generations` and `POST /api/v1/cad/repairs`
(`src/api/routes/cad.ts`). Both run the **identical admission sequence**:
session auth → Zod → pre-checks → quota → lock → hourly limiter → work.
Extracted once; do not duplicate per route.

**Metering is the loop bound.** Every call to either endpoint costs one quota
unit (`CAD_DAILY_REQUEST_LIMIT`, **rounds** per wallet per UTC day), because
every one is a paid DeepSeek call. There is no server session, no `repairToken`
and no per-request round counter: a client cannot buy extra provider calls by
fabricating failures, because each fabricated failure costs its own wallet
quota. A quota rejection never takes the lock, and pre-checks (image size,
unresolvable `sourceRef`) run **before** the wallet is charged.

**Trust nothing from the client.** Reported `failures` are a **hint** fed to the
prompt, never a verdict: the server re-runs the guard on whatever comes back
regardless, and a client reporting no failures still gets a statically-gated
design.

## Two-stage generation: the catalog and Jev

The system prompt is no longer one fixed text. `backend/catalog.ts` holds one
entry per library module or knowledge block (summary, helper rows, guidance), and
`buildSystemPrompt(ids, fit)` sends the core rules plus the selected entries.
**Adding a part means adding a catalog entry, never a paragraph in prompt.ts.**

Stage one is **Jev** (TypeSafe AI, `backend/jev.ts`, `JEV_API_KEY`): a decision
model that answers typed questions with calibrated probabilities, ~100-400 ms,
$0.042/MTok. ONE call per request asks:

| question | type | used for |
|---|---|---|
| one per catalog entry | `score` 0-2 | entries ≥ `FIT_THRESHOLD` (1.0) are documented, with their fit |
| `piece_count` | `choice` one/two/three/four/many | the `connected` gate allows that many bodies (`bodyAllowance`), raised to what a multi-body helper builds (`MULTI_BODY_HELPERS`) |
| `pieces_separate` | `noul` | "would ONE fused solid be wrong?" - with `piece_count` >= 2 and this ≥ `SEPARATE_THRESHOLD` (0.75), the `pieces` gate needs at least `piece_count` bodies (`bodyFloor` → `KernelLimits.minBodies`) |
| `cad_suitable` | `noul` | < `SUITABILITY_THRESHOLD` (0.5) refuses the request |

The body count is gated from both sides. `connected` caps it from above
(`maxBodies`); `pieces` floors it from below (`minBodies`, 1 when absent), so a
two-half clamp fused into one block fails with a repair message that says to
SEPARATE the pieces - the opposite of `connected`'s "overlap" advice. Fewer bodies
is not always wrong (a hinged box may use a living hinge), which is why the floor
needs Jev's second judgement and not just the count. Calibrated live on 20
requests: fused-is-wrong 0.84-0.97 (clamp, four coasters, sliding/snap-fit lid,
three spacers, lift-off lid, earrings); fused-may-be-fine 0.05-0.65 (hinged box
0.65, print-in-place chain 0.45, print-in-place hinge 0.34, Gridfinity bin with
dividers 0.30, bracket 0.05). Missing answers give a floor of 1: Jev never fails
a part by being down.

Selection only ever adds documentation, and Jev **fails open**: no key, an
outage or a bad reply falls back to the whole catalog and never refuses. A
client repair skips Jev and reuses the entries its design already calls.

**Unsuitable requests.** An artistic or organic subject (a figurine, a bust, an
animal) throws `CadRequestUnsuitable` BEFORE any DeepSeek call. The route answers
**422 `CAD_REQUEST_UNSUITABLE`** with `details: { suitability, alternative:
{ kind: "organic-mesh", provider: "tripo3d" } }` and **refunds the quota unit** -
the UI should offer the Tripo3D generator instead. Measured: engineering parts
0.96-0.99, simple decorative geometry 0.73-0.91, sculpted subjects 0.03-0.18.

## Growing the library

1. `bun scripts/cad-candidates.mjs <owner/repo>[:<file.scad>] ...` - the licence
   gate. Jev classifies the LICENSE text and asks whether THIS file came from
   elsewhere (README provenance included); a source is portable only when
   GitHub's SPDX and Jev both say permissive/attribution AND a human has read it.
   Results accumulate in `test-results/reference/candidates.json`; `--all`
   re-judges every saved candidate (resumable: records already judged under the
   current `RUBRIC` are skipped unless `--force`).
   **Ranking** - the same Jev call asks `is_scad_design` (noul: real OpenSCAD
   modelling source, not an agent-skill bundle, app or converter) and four 0-3
   scores, combined as
   `rank = isScadDesign * (0.25 + 0.75*generalPurpose/3) * (parametric + printability + maturity)/9`.
   Both factors gate: skill bundles sink to ~0.02-0.06 and printer-specific
   one-offs to ~0.2, while BOSL2 and vector76's Gridfinity sit near 0.8. Port
   from the top of the ranked list the script prints.
2. Port per the `openscad-reference-port` skill into `core/library/<part>.ts`,
   reproducing the licence notice the licence requires (MIT and BSD do).
   **CERN-OHL-P-2.0** is accepted (permissive, s3.4 allows other terms), but its
   notices are heavier than MIT's: keep every Notice (s3.1-3.2), add a notice
   that you modified it with the date and a brief description (s3.3b), and
   ship a copy of the licence text with the port (s3.4b). CERN-OHL-S and
   CERN-OHL-W are reciprocal and stay rejected.
3. `bun scripts/cad-reference.mjs <case>` renders the UNMODIFIED original with
   OpenSCAD (`-D` overrides) and the port: size, volume and bodies must match.
4. `ATTRIBUTED_HELPERS` entry with `authorGithub`, a catalog entry, a
   `PRELUDE_VERSION` bump, a scenario - and a live run proving DeepSeek calls it.

## Harnesses

- `scripts/cad-smoke.mjs` — one prompt → design → **real GLB and 3MF on disk**.
  Doubles as the **reference implementation of the browser worker**: guard,
  prelude-version check, kernel, export. Start here when writing the worker.
- `scripts/cad-eval.mjs` — batch scenarios → PNG renders, component tinting and
  a per-`attempt#N` gallery under `test-results/cad-eval`. Use it to compare a
  change against earlier attempts.
- `scripts/cad-bench.mjs` — the **external score**: runs the public CADPrompt
  benchmark (200 prompts with ground-truth meshes, ICLR 2025) through the
  **hardened loop** it composes — the server's static repair, then its own
  kernel gates and 3 client repair rounds, which the browser worker does not yet
  apply (it renders once, with no geometric gates) — and writes `summary.md`
  beside the paper's GPT-4/Gemini rows,
  plus exact IoU and a Jev-triaged "where to improve" table, under
  `test-results/cad-bench/run#N/`. It also records an observe-only Jev
  complexity score per sample, banded in the summary, and `--thinking on|off`
  selects DeepSeek thinking mode for an A/B. CADPrompt has **no licence**: it
  is fetched into `test-results/` for local evaluation and must never be
  committed.
  Spec: `docs/superpowers/specs/2026-10-04-cad-bench-cadprompt-design.md`.
- `scripts/cad-scad-port.mjs` — ports a `polygon(points, paths)` OpenSCAD
  profile into Manifold JS. See the `openscad-reference-port` skill.

The harnesses import the package **source**, not the bare specifier: they run
under Bun before any build, where `dist/` is absent or stale.

## Porting an OpenSCAD reference

Use the `openscad-reference-port` skill — it is a 7-step gate, and step 1
(licence) is not optional. The short version: licence gate → find a reference
that ships an STL → render the reference → port the profile → verify size
against the reference → add the attribution entry → write an ABSOLUTE rule →
**prove the model calls the helper**.

That last step is the one that gets skipped. A helper nobody calls is dead
weight, and the only way to know is to run it.

## Testing

```bash
bun run test -- test/cad-gen test/api/cad-route.test.js
```

Never run the full repo suite from a bare worktree: it carries ~274 pre-existing
failures unrelated to this package. `bun run lint && bun run typecheck` before
every commit.

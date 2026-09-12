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
part rather than freezing a wrong credit. Persisting it into a manifest's
`metadata.chat` block is the client's job (milestone 2).

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

## Harnesses

- `scripts/cad-smoke.mjs` — one prompt → design → **real GLB and 3MF on disk**.
  Doubles as the **reference implementation of the browser worker**: guard,
  prelude-version check, kernel, export. Start here when writing the worker.
- `scripts/cad-eval.mjs` — batch scenarios → PNG renders, component tinting and
  a per-`attempt#N` gallery under `test-results/cad-eval`. Use it to compare a
  change against earlier attempts.
- `scripts/cad-scad-port.mjs` — ports a `polygon(points, paths)` OpenSCAD
  profile into Manifold JS. See the `openscad-reference-port` skill.

Both harnesses import the package **source**, not the bare specifier: they run
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

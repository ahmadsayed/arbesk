# Manifold-based engineering CAD generation (`@arbesk/cad-gen`) — design

**Date:** 2026-09-11 · **Revision:** 4 · **Status:** 🔒 **LOCKED** · **Milestone:** 1 (code generation service)

> **Locked 2026-09-11; revision 4 2026-09-12.** This document is the contract; changes require
> a new revision, not an edit. Revision 3 moved the kernel out of the server request path
> (D3, D5, §5) and made the daily quota meter **rounds** rather than generations (D8).
> Revision 4 adds **licence attribution** for parts derived from reference designs (D9, §8.1),
> which became necessary the moment porting a published design turned out to be a more
> reliable route to a correct part than generating one. The full ruling record with
> measurements behind every decision is
> `.superpowers/sdd/2026-09-11-cad-generation/progress.md` — read it before changing anything
> here. The plan that executes this spec is
> `docs/superpowers/plans/2026-09-11-cad-generation.md`, also locked.

## 1. Goal

Add a prompt-driven **engineering part** generator to Arbesk. A language model writes
Manifold code from a natural-language description (optionally with images); the server
**returns that code**, validated; the **client executes it** against the Manifold WASM
kernel to produce GLB/3MF and render it. Each turn is aware of the previous design *as
code*, so the user iterates: *create a box → add holes along X, −Y, Z → fillet the edges*.

**The server generates code. It does not produce files.** Manifold execution and 3MF/glTF
conversion belong to the client, which makes parameter changes free — a local re-run in
the browser worker with no network round trip and no server CPU.

Milestone 1 ships the code-generation service, its validation loop, and a local Node
harness that drives the *same shared core* the browser will later use. The Studio UI,
the browser worker and WASM bundling are milestone 2.

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Canonical design state is a **full Manifold script plus a required `PARAMETERS` object**; every turn rewrites the complete script | Never leaves anyone holding a half-applied patch; and because dimensions are references rather than literals, the script is *reusable* — which is what makes client-side parameter edits possible at all |
| D2 | New workspace package `@arbesk/cad-gen` with an **environment-agnostic core** plus a **backend adapter** | The design document, prelude, guard and exporters must run on **both** hosts, so the package is shaped like `@arbesk/asset-core` (ports + injected capabilities), not like `@arbesk/ai-asset-gen` (backend-only) |
| D3 | The server **does not execute generated code at all** — it runs the static gates and returns code the client executes. The kernel belongs to the client, which is the host that builds the delivered mesh | A server-side run evaluates a **proxy** at a different fidelity, and the two provably disagree: measured, an 80x60x8 plate with six 5 mm holes is 15 466 triangles at the validation profile and 245 652 at delivery fidelity against a 200 000 budget — the proxy **passes what the real part fails**. It was also 91 % of pipeline latency (2 203 ms generating, 23 023 ms in the kernel, 1 ms exporting), it made the server execute untrusted model code, and it caused two deployment blockers: no `child.ts` on disk in the compiled binary, no `manifold.wasm` in the runtime image |
| D4 | The API is **stateless**; continuity comes from an inline `priorDesign` (the full previous document — code *and* parameters) or a `sourceRef` (CID / asset ID) the backend resolves | No design-session registry to build, expire or replicate. Per-wallet **quota and concurrency** state (§6) is separate infrastructure state, not design state |
| D5 | The server runs the **static gates** plus a bounded auto-repair loop (3 attempts, env-tunable). The **client** runs the kernel, the geometry gates and the render, and reports failures back for repair | The host that builds the mesh is the only authority on whether it builds. The server guarantees what it can actually check — that the code is structurally sound and passed every static gate — and the response carries the attempt log so failures are debuggable |
| D6 | The model writes **free-form Manifold JS against a curated prelude** | Maximum expressiveness; the prelude is where the fillet strategy is encapsulated so the model never improvises it |
| D7 | **No `mode: "execute"`** and no server-side artifact production | With the client owning execution, a parameter edit is a local re-run: zero tokens, zero network, zero server CPU. The earlier server-side execute mode and its 500/day budget are deleted, not deferred |
| D9 | Parts derived from a **licensed reference design** carry **attribution**, surfaced in the API response and persisted with the design. The server derives the set from the helpers the script actually **calls**, never from the model's memory | A ported profile is a derivative work, so a CC-BY credit has to reach the user, not just the source tree. A model cannot be relied on to remember a licence, and an attribution that depends on remembering is one that goes missing the first time the prompt is trimmed. Deriving it from `referencedIdentifiers(code)` — the scan the guard already runs — also stops it being over-claimed: a design that never calls the helper carries no credit for it |
| D8 | Per-SIWE limits: a **rounds/day budget covering the whole loop** (initial attempt plus every repair), **one in-flight request per wallet**, plus the existing hourly limiter | Every round is one paid provider call, so the quota is denominated in **rounds, not generations**. A repair is a metered request like any other, which bounds abuse with no server-side session state at all: a client cannot buy extra LLM calls by fabricating failures, because each one costs its own wallet quota |

## 3. Architecture

```
packages/cad-gen/src/
  index.ts  types.ts  errors.ts
  core/                    environment-agnostic — Node AND browser
    document.ts            CadDesign type, parse/validate, PARAMETERS extraction
    contract.ts            CONTRACT_VERSION + prelude version (see §4)
    prelude.ts             curated CAD prelude (source text + helper factory)
    guard.ts               static allowlist — enforced on BOTH hosts
    gates.ts               static gate evaluation
    kernel.ts              createCadKernel(manifoldModule) → design → { mesh, stats }
    export/glb.ts          mesh → GLB (asset-core serializer)
    export/three-mf.ts     mesh → .3mf OPC package
    export/embed.ts        design-document sidecar read/write
  backend/                 Node-only — imported solely by the server
    deepseek.ts            OpenAI-compatible client (vision + JSON output mode)
    prompt.ts              system prompt, prelude API reference, turn assembly
    repair.ts              bounded repair loop + diagnostics
    validate-runner.ts     spawns the child, collects mesh *stats*, discards the mesh
    child.ts               child entry: load manifold.wasm, run script, emit stats
    quota.ts               per-wallet daily quota + in-flight lock
```

### Why the split

The whole point of moving execution to the client is that **one implementation of the
kernel path, the guard and the exporters serves both hosts**. The browser worker and the
server's validation child both call `createCadKernel(manifoldModule)`; both run the same
`guard`; both produce 3MF through the same writer. Nothing about the pipeline is
duplicated, so the two hosts cannot silently drift on geometry or format.

The kernel is injected as a **port** — the module is loaded by the host (Emscripten glue
in the child, bundled web build in the worker) and passed in. `core/` therefore contains
no Node globals and no browser globals.

### Boundaries

- `core/` — no Node globals, no browser globals, no imports from `frontend/`,
  `src/api/` or `constants/`. May be bundled into the frontend.
- `backend/` — may use Node globals. Imported only by `src/api/`.
- Depends on `@arbesk/asset-core` for glTF/GLB serialization
  (`@arbesk/asset-core/formats/gltf/gltf-core.js` → `serializeGLB`). The mesh→3MF
  writer stays in `cad-gen` because asset-core's 3MF module is a *composite-package
  rebuild* codec, not a mesh exporter. `packages/AGENTS.md` dependency order gains
  `asset-core ← cad-gen`.
- eslint: a `core/` block enforcing the environment-agnostic rules (mirroring the
  asset-core block) and a `backend/` block restricting imports to the backend tree.

## 4. The design document

DeepSeek is called in **JSON output mode** and must return exactly:

```jsonc
{
  "code": "const b = roundedBox(P.width, P.depth, P.height, P.fillet);\nreturn hole(b, { diameter: P.holeDia, axis: 'z', at: [0, 0] });",
  "parameters": {
    "width":   { "value": 60, "unit": "mm", "min": 10, "max": 200, "label": "Overall width" },
    "holeDia": { "value": 6,  "unit": "mm", "min": 1,  "max": 20,  "label": "Hole diameter" }
  },
  "summary": "Added three Ø6 through-holes along X, −Y and Z"
}
```

- `code` — the **body of a function** whose parameters are `PARAMETERS`, the prelude
  helpers, and `M` (the raw `Manifold` class as an escape hatch). It **must `return` a
  `Manifold`**.
- `parameters` — the single source of truth for dimensions, and the contract that makes
  client-side editing possible. Gates assert the script references `PARAMETERS`; a lint
  flags bare numeric literals above a threshold.
- `summary` — human-readable change note, reused later as `metadata.chat`-style
  provenance.

### Prelude surface (vetted, deterministic, injected into every run)

```js
// solids
box(w, d, h, opts?)                      cylinder(r, h, opts?)          sphere(r, opts?)
// profiles
rect(w, d, opts?)                        circle(r, opts?)               roundRect(w, d, r)
extrude(profile, h, opts?)               revolve(profile, opts?)
// engineering helpers
roundedBox(w, d, h, r)                   // exact prismatic fillet
hole(part, { diameter, axis, at, through })
boltCircle(part, { count, diameter, circleDiameter, axis, at })
filletEdges(part, r, { mode })           // "minkowski" | "smooth" | "auto"
chamferEdges(part, r)
// inspection
bbox(part) → { min, max, size }          volume(part) → number
```

Conventions pinned in the system prompt: **millimetres, Z-up, solids only, `Ø` means
diameter, prefer `roundRect`+extrude or `roundedBox` for prismatic parts.**

### The contract version problem (new, and unavoidable in a two-host design)

Because the **client** executes code the **server** prompted for, the prelude the model
was told about and the prelude the client actually has must be the same. Every response
therefore carries:

```jsonc
"runtime": { "contractVersion": 1, "preludeVersion": "2026-09-11" }
```

A client whose prelude version does not match **refuses to execute and reports a mismatch**
rather than running code against an API it does not implement. Bumping the prelude is a
breaking change to a published contract, not a refactor.

### Fillet fidelity (a real constraint, surfaced not hidden)

Manifold is a **mesh kernel**; it has no `fillet()`/`chamfer()`. Three strategies exist:

| Strategy | Fidelity | Cost |
|----------|-----------|------|
| `roundRect`/`roundedBox` → `extrude` | **Exact** on prismatic parts | Cheap — the recommended default |
| `minkowskiSum(sphere)` / `minkowskiDifference` | Geometrically correct rounding; convex edges (concave needs the difference form) | Triangle count grows fast |
| `smoothOut()` + `refineToLength()` | Tangent-based; looks filleted, mesh stays faceted | Cheap |

`filletEdges(part, r, { mode })` defaults to `"auto"`: attempt `minkowski`, downgrade to
`smooth` when the projected triangle count exceeds the budget, and **report the mode
actually used** in validation stats so fidelity is never silently overstated. True B-rep
fillets and STEP export would require an OCCT-class kernel — out of scope (§12).

## 5. Validation — split across the two hosts

### Static gates — always, in-process, no execution

Script size cap; reject `import`, `require`, `eval`, `Function`, `process`,
`globalThis`, `fetch`, `fs`, `child_process`, `WebAssembly`; require `PARAMETERS` and a
`return`; require that every called helper name **exists in the prelude** (this catches
hallucinated API calls for free, before spending a kernel run); parse the code without
executing it (`new Function(code)` compiles but is never invoked).

### Kernel validation — CLIENT ONLY, in the browser worker

The client runs the same `core/kernel.ts` the server would have, in a worker, against the
WASM build. It is the host that renders, so it is the host that decides. Gates: runs →
returns a `Manifold` → `status() === 'NoError'` → non-zero triangle count within budget →
positive volume → bounding box consistent with the declared parameters.

> **The triangle budget is fidelity-dependent and belongs here.** At the coarse validation
> profile the plate above reports 15 466 triangles; at delivery fidelity, 245 652. A budget
> checked anywhere but on the delivered mesh is checking a different object.

`backend/validate-runner.ts` + `backend/child.ts` survive as an **evaluation harness** —
offline build, measurement and rendering of a design — and are exported with that label.
They are not in the request path.

### Repair — split across the wire

A **static** failure is repaired server-side, inside one request: the failing code plus the
exact error go back as a further turn, up to `CAD_MAX_REPAIR_ATTEMPTS` (default 3).
Exhausting that budget returns `CAD_GENERATION_FAILED` with the last error and the full
attempt log.

A **geometric** failure is repaired across the wire, because only the client can detect it:
the client posts the failure back, the server spends one metered round, and the client
re-renders. The loop is bounded by the wallet's round budget rather than by a server-side
counter, so it needs no session state (D8).

> What the server can no longer promise: that the client receives code that builds.
> What it can promise: that the client receives code that passed every static gate, and
> that the attempt log says so.

## 6. HTTP API

Mounted in `src/api/index.ts` next to `v1.use("/generations", …)`.

### `POST /api/v1/cad/generations`

Session-authenticated, quota-gated, concurrency-locked, rate-limited.

```jsonc
{
  "prompt": "add three 6mm through-holes along X, -Y and Z",
  // stateless continuity — the whole previous document, echoed back verbatim.
  // Code alone is not enough: the prior parameter *values* live here, not in the script.
  "priorDesign": { "code": "…", "parameters": { … }, "summary": "…" },
  "sourceRef": { "cid": "bafy…" },                // or { "assetId": "…" }
  "images": [{ "data": "<base64>", "mime": "image/png" }],
  "repairAttempts": 3                             // capped by CAD_MAX_REPAIR_ATTEMPTS
}
```

Response — **code, never files**:

```jsonc
{
  "design": { "code": "…", "parameters": { … }, "summary": "…", "turn": 3 },
  "runtime": { "contractVersion": 1, "preludeVersion": "2026-09-11" },
  // NO "validation" field. The server ran no kernel, so it cannot claim the design is
  // geometrically sound; a field named "validation" that no longer validates is a trap
  // for whoever reads this API next. What it does guarantee is that the design passed
  // every static gate, which is what "diagnostics.attempts" records.
  "diagnostics": {
    "attempts": [{ "index": 0, "ok": false, "gates": { … }, "error": "…" }],
    "durationMs": 8412,
    "tokens": { "prompt": 3120, "completion": 840 }
  },
  "provider": { "id": "deepseek", "model": "deepseek-flash" },
  // Credit for any licensed reference design this part derives from (§8.1). Computed
  // from the helpers the script actually CALLS, never from what the model says. Empty
  // when nothing licensed is involved - standard dimensions and our own maths are
  // facts, not works. This is what the chat shows the user.
  "attribution": [
    { "work": "SmartPhoneHolder", "author": "DrLex", "licence": "CC-BY",
      "url": "https://github.com/DrLex0/print3d-customizable-smartphone-holder",
      "helper": "phoneStand" }
  ]
}
```

There is no `artifacts` array and no `formats` field: GLB and 3MF are produced on the
client (§7).

### `POST /api/v1/cad/repairs`

The client-driven half of the repair loop. When the client's kernel run fails a geometric gate,
it posts the failure back; the server spends **one metered round** and returns new code.

```jsonc
{
  "prompt": "add three 6mm through-holes along X, -Y and Z",  // the original request
  "priorDesign": { "code": "…", "parameters": { … }, "summary": "…" },  // REQUIRED
  "failures": [{ "gate": "kernel", "error": "part is empty after subtract" }]
}
```

`priorDesign` is required: a repair with nothing to repair is just a generation, and accepting
it would double the reachable provider calls for one prompt. The response body is identical to
`/generations` — the two endpoints differ only in what they feed the prompt.

**The reported failures are a hint, never a verdict.** They are rendered into the repair turn to
tell the model what went wrong, and that is all: the server re-runs the guard on whatever comes
back regardless, and a client reporting nothing still receives a statically-gated design. The
server never trusts a client's account of geometry it cannot see.

**Admission is identical to `/generations`** — same auth, same quota unit, same lock, same
headers. There is no session, no `repairToken` and no per-request round counter: the wallet's
round budget *is* the loop bound, and a client cannot buy extra provider calls by fabricating
failures, because each fabricated failure costs its own wallet quota.

### Quota, concurrency and budget

Three controls keyed by the **SIWE wallet address** (`res.locals.userAddress` — the same
key the existing limiters use), all enforced before any LLM call.

**One in-flight request per wallet.** An in-memory `Map<wallet, { token, startedAt }>`
(mirroring `generation-tasks.ts`), acquired synchronously at admission and released in a
`finally` so a failed or repaired request always frees it. A blocked request gets **409
`GENERATION_IN_PROGRESS`** with `Retry-After` and `details: { startedAt }`. A hard TTL
(`CAD_MAX_REQUEST_MS`) with lazy expiry stops a crashed request wedging a wallet. The default
is **derived**, not hard-coded: `attempts × providerTimeout + 30000` = 3 × 120 000 + 30 000 =
**390 000 ms**. There is no kernel term any more — the server runs static gates only — so
`CAD_EXEC_TIMEOUT_MS` is gone. The lock is deliberately **not** persisted — in-flight work cannot survive a
restart.

**Daily round quota — `CAD_DAILY_REQUEST_LIMIT`, per wallet, UTC day.** The unit is
**one provider round**, not one generation: every call to `/generations` *and* every call to
`/repairs` costs one unit, because every one of them is a paid API call. Consumption happens
at admission, which closes the fail-and-retry storm. Exhaustion returns **429
`DAILY_QUOTA_EXCEEDED`** with `details: { limit, used, resetsAt }`.

> This replaced the original "one accepted request is one unit regardless of how many repair
> attempts it internally spends". That rule held only while repairs were server-internal; once
> the client drives them, a repair is an ordinary metered request and must be charged like one.
> **The number also needs setting from the observed repair rate** — it now meters rounds, so a
> limit of 50 buys fewer generations than it used to. Most parts passed on the first attempt
> live; the hard ones took 2–3 rounds.

**Hourly limiter.** The existing wallet-keyed `express-rate-limit` pattern
(`src/api/rate-limiter.ts`), with a CAD-specific budget, bounds bursts inside the day.

**Persistence.** The counter lives in `.data/cad-quota.json`, resolved through
`PROJECT_ROOT` and written atomically (temp file + rename), following the
`src/api/token-indexer.ts` precedent — a daily cap that evaporates on restart is not a
cap. Loaded at boot, tolerated when missing or corrupt (log `[CAD] quota state
unreadable — starting from zero`), pruned of entries older than two days on write.
Increments are rare (≤50/wallet/day), so write-through needs no debouncing. Counter and
lock logic live in a focused `src/api/cad-quota.ts` with a `_resetCadQuota()` test
helper, mirroring `_resetRateLimiters()`, keeping the route thin.

**Admission order** (single-threaded between (d) and (e), so no TOCTOU race):
(a) session auth → (b) Zod validation → (c) `sourceRef`/`image` pre-checks → (d) quota
check → (e) lock acquire → (f) hourly limiter → (g) work. A quota rejection never takes
the lock.

**Observability.** `X-Cad-Quota-Limit`, `X-Cad-Quota-Remaining` and `X-Cad-Quota-Reset`
(epoch seconds) so a future UI can show "43 of 50 left today"; `[CAD]` log lines record
`wallet=0x… quota=used/limit` per request.

### Errors

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Zod body validation (existing `validateBody` helper) |
| 400 | `SOURCE_ASSET_UNSUPPORTED_FORMAT` | `sourceRef` resolves to something with no embedded design document |
| 400 | `SOURCE_ASSET_UNAVAILABLE` | `sourceRef` not found in storage/indexer |
| 401 | — | missing/invalid session (existing middleware) |
| 409 | `GENERATION_IN_PROGRESS` | this wallet already has a CAD request running |
| 413 | `IMAGE_TOO_LARGE` | image beyond `CAD_MAX_IMAGE_BYTES` |
| 429 | `RATE_LIMITED` | hourly limiter |
| 429 | `DAILY_QUOTA_EXCEEDED` | 50 LLM requests used today |
| 500 | `CAD_GENERATION_FAILED` | all repair attempts failed — carries `diagnostics` |
| 502 | `PROVIDER_ERROR` / `PROVIDER_AUTH_FAILED` | DeepSeek transport/auth (mirrors the existing `providerErrorCode` mapping) |
| 503 | `CAD_NOT_CONFIGURED` | `DEEPSEEK_API_KEY` unset |

The route is thin, per `docs/ARCHITECTURE.md §1.5`: it validates, authenticates, gates and
delegates — it holds no CAD logic.

### Environment (`.env.example`, `docs/CURRENT_STATUS.md §8`)

```bash
DEEPSEEK_API_KEY=            # server-only; never served to the browser
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
CAD_GENERATION_ENABLED=      # unset → enabled iff DEEPSEEK_API_KEY is present
CAD_MAX_REPAIR_ATTEMPTS=3
CAD_EXEC_TIMEOUT_MS=10000    # per validation attempt
CAD_MAX_TRIANGLES=200000
CAD_MAX_IMAGES=4
CAD_MAX_IMAGE_BYTES=8388608
CAD_DAILY_REQUEST_LIMIT=50   # LLM requests per wallet per UTC day
CAD_MAX_REQUEST_MS=120000    # in-flight lock TTL and hard request ceiling
CAD_RATE_LIMIT_MAX=          # hourly limiter override
```

## 7. The client pipeline (milestone 2 — the contract this API is built to serve)

Recorded here because it constrains milestone 1; **not built in milestone 1**.

1. The client receives `design` + `runtime`. If `preludeVersion` does not match its own,
   it refuses to execute (§4).
2. It runs the **same `core/guard.ts`** — independently, never trusting the server — then
   `createCadKernel(manifoldModule)` in a **module worker**, loading `manifold.wasm` the
   same way the browser already stages `brotli-wasm` (`frontend/scripts/bundle.js` stages
   the web build and its `.wasm` next to `app.js` and the worker).
3. It writes GLB (rotate −90° about X, scale 0.001, so mm/Z-up lands correctly on the
   Studio's meters/Y-up grid) and 3MF (mm, Z-up) via the shared core exporters, and
   embeds the design document as a declared OPC part `Metadata/arbesk_cad.json` in the
   3MF and as `asset.extras.arbesk_cad` in the glTF. Any CID or asset ID of a generated
   part therefore round-trips the **full design state** — which is what makes the
   stateless `sourceRef` path (D4) lossless, and it is why the generators live in `core/`
   rather than in the backend.
4. A parameter edit re-runs steps 2–3 locally. No server call, no tokens, no quota.
5. CSP must permit WASM compilation (`wasm-unsafe-eval` in the `script-src` directives
   defined in `src/hono/secure-headers.ts` and `src/index.ts` during the Hono migration).

**Why the client-side guard is not optional.** The browser executes model-written code in
the user's own tab. The blast radius is bounded — a module worker has no DOM, no filesystem,
and Arbesk's session token is a header held in main-thread memory, so a rogue worker holds
no credentials — but that bound is *maintained* by the guard plus the CSP `connect-src`
allowlist. Guard-on-both-hosts is defence in depth, not redundancy.

## 8. Security and cost

- The DeepSeek key is server-side and is the only secret; never logged, never returned.
  Cost is borne by the server, so the per-wallet daily quota, the hourly limiter and
  per-request token accounting are all mandatory.
- Generated code is treated as hostile on **both** hosts. The server executes it only for
  validation, in an isolated child with a timeout and a triangle budget, and never
  exports or returns geometry. The client executes it in a worker, guarded by the same
  allowlist and the CSP.
- Prompt injection through an attached image can at worst produce a wrong part — it cannot
  smuggle a command past the guard, and the guard's allowlist is a fixed list of prelude
  names rather than a pattern match on intent.
- No on-chain quota gate in milestone 1: nothing is minted and no asset is created, so the
  free-tier contract semantics do not apply yet. Revisit when generation becomes a
  published asset.

### Licences and attribution

A part this system produces can be a **derivative of someone else's design**, so the licence
of the source travels with the output. Four classes, and only one of them asks anything of us
at runtime:

| source | example | obligation |
|---|---|---|
| **Facts and standards** | Gridfinity's 42 mm grid and 4.75 mm base profile; Raspberry Pi board and hole dimensions; ISO gear proportions | **None.** Dimensions are facts, not creative works, so quoting them is not derivation |
| **Permissive code** (MIT, BSD-2/3, Apache-2) | BOSL2's gear maths | Keep the copyright notice in our source. No user-facing obligation |
| **Attribution designs** (CC-BY) | DrLex0's `SmartPhoneHolder` | **Attribution must reach the user.** A ported profile is a derivative work, so the credit belongs in the response, not only in the source tree |
| **Copyleft** (LGPL, GPL, AGPL) | MCAD | **Not usable, ever.** Translating is creating a derivative work, so the copyleft would attach to our ported code |

**Attribution is computed, never remembered.** Each prelude helper that derives from a
licensed source declares it in a table keyed by helper name; the server intersects that table
with `referencedIdentifiers(code)` — the same lexical scan the guard already performs for
`UNKNOWN_HELPER` — and returns the matches. Two properties fall out of doing it that way:

- It cannot be **forgotten**, because the model is not part of the calculation.
- It cannot be **over-claimed**, because a script that never calls the helper produces no
  credit for it.

The set is returned in the response body (`attribution`, §6) for the chat to display, **and**
written into the design's provenance, so a saved or published asset keeps its credit after the
conversation is gone.

> Open question for the owner, not a technical one: a ported design is a derivative work of
> the *design*, not merely of the code, and CC-BY's obligations on a 3D-printed derivative are
> a legal question, not an engineering one. Attribution-in-the-response is the conservative
> reading and the one this spec adopts; confirm it with whoever owns the licence position
> before shipping a ported helper.

## 9. Testing

| Layer | Approach |
|-------|----------|
| Core document | `CadDesign` parse/validate; PARAMETERS extraction; missing/renamed parameter rejection |
| Guard | Table-driven accept/reject for every denied construct — **run against the same module the browser will bundle**, so the two hosts cannot diverge |
| Static gates | Helper-name allowlist (hallucinated API call), parse-without-execute, missing `return` |
| Kernel gates | Scripted failures per gate (throw, empty mesh, non-manifold, oversized, degenerate volume, dimension mismatch) |
| DeepSeek client | Mocked `fetchImpl`; JSON-mode parse failures; auth and 5xx mapping |
| Repair loop | Fake generator returning a scripted failure sequence; assert attempt count and diagnostics |
| Exporters | Golden structure assertions on the 3MF parts and GLB header; **round-trip the emitted 3MF through asset-core's own 3MF parser + `to-gltf`** to prove third-party-shaped validity |
| Contract version | Mismatched `preludeVersion` is refused, not executed |
| Quota & lock | Per-wallet isolation; UTC-midnight rollover (injected clock); 50th accepted and 51st rejected; repair attempts cost exactly one unit; second concurrent request → 409; lock released after success *and* after total failure; stale lock expires; `.data/cad-quota.json` survives a simulated restart, tolerates a missing/corrupt file, prunes old entries |
| Route | `supertest` with a loopback fake LLM (existing pattern in `test/api.test.js`); no live API calls in CI |
| Harness (not CI) | `scripts/cad-smoke.mjs` — drives the shared core to execute returned code and write real GLB/3MF files; the browser worker's reference implementation |

The kernel is exercised **through the spawned child**, not by importing manifold into the
Jest VM — this sidesteps ESM/WASM-in-Jest entirely and tests the real isolation path.

## 10. Spike (must pass before feature work)

1. `manifold.wasm` loads and runs under **Bun**, returning mesh stats for cube − cylinder.
2. The same inside a spawned child process, with a timeout kill that actually terminates it.
3. It resolves inside the **compiled single-file server** (`bun run build:server`) —
   `scripts/build-server.mjs` already embeds brotli's wasm through exactly this shim
   pattern; manifold needs the sibling of that shim.
4. `core/kernel.ts` is **bundle-safe**: the module graph reachable from `core/` pulls no
   Node built-ins, so the browser worker can import it unchanged.
5. asset-core's `serializeGLB` accepts the produced glTF (normals, indices, one primitive).

If (1)–(3) fail, the documented fallback is static-only validation (§11) or shipping the
WASM-embedding shim up front rather than as a follow-up.

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| WASM under Bun / compiled binary | Spike §10 gates all feature work; shim precedent exists. Fallback: static-only validation with the kernel check disabled |
| Two-host drift | One `core/` implementation, one guard test table, one exporter set, and an explicit `preludeVersion` that makes a mismatch loud rather than silent |
| Client forgets the guard | Guard lives in `core/` and is part of the documented execute path; a client-side integration test asserts a denied script never reaches the kernel |
| Model reliability on multi-feature scripts | Repair loop + curated prelude + few-shot examples; tracked by a fixed ~10-prompt eval set as a regression baseline |
| Fillet fidelity | Documented in §4; actual mode reported in validation stats; prismatic path is exact |
| Latency (no streaming; 3–30 s) | Long route timeout, duration/token logging; streaming and progress are UI-milestone concerns |
| Cost/abuse | Per-wallet 50/day quota, one-in-flight lock, hourly limiter, token accounting |
| Quota state on multi-replica | File-backed counter assumes a single replica (true for k3s today); shared storage or a CAS store required before scaling out |
| Quota reset on deploy/restart | Persisted under `.data/`; a container without a persistent volume would reset it — flagged for the deploy milestone |
| Child-process memory rlimits absent | Recorded follow-up: `ulimit`-based wrapper or a worker pool with `resourceLimits` |
| Browser WASM bundling + CSP | Deferred to milestone 2, but §7 records the constraints now (bundle staging + `wasm-unsafe-eval`) so milestone 1's module layout does not have to change to accommodate them |

## 12. Out of scope (future milestones)

- **Milestone 2:** Studio UI (prompt/chat panel, orbit preview, parameter sliders), the CAD
  module worker, Manifold WASM bundling, client-side GLB/3MF export, CSP changes.
- IPFS persistence, manifest chain, publish — each version becomes a real Arbesk asset
  with `metadata.chat` provenance.
- STEP/IGES or B-rep (OCCT-class kernel) for manufacturing-exact fillets.
- Assemblies, mating constraints, drawings, tolerance stacks.
- `besk` CLI + MCP parity (required by the CLI↔MCP rule once a subcommand exists).
- Provider abstraction: DeepSeek is hard-wired in milestone 1; a second LLM provider would
  introduce the capability-gated facade pattern.

## 13. Assumptions

- `deepseek-flash` is reachable via the OpenAI-compatible endpoint and accepts inline
  base64 images (48 MiB request body cap) — confirmed in DeepSeek's Vision guide.
- The design document travels inside the artifacts (§7); any `sourceRef` produced by a
  *different* tool has no embedded code and is rejected with
  `SOURCE_ASSET_UNSUPPORTED_FORMAT`.
- Milestone 1 persists no **design** state server-side; the only server-side state is the
  per-wallet quota/lock file (§6). Callers hold the design document.
- The client is assumed to be Arbesk's own Studio. A third-party client that executes the
  code is responsible for running the guard (§7).

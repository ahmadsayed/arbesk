# Manifold-based engineering CAD generation (`@arbesk/cad-gen`) — design

**Date:** 2026-09-11 · **Revision:** 2 · **Status:** design, pending review · **Milestone:** 1 (code generation service)

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
| D3 | The server executes generated code **only to validate**, in a fresh child process behind a static allowlist — never exporting, never returning the mesh | Keeps the repair loop meaningful (broken code is fixed before the user sees it) at ~100 ms–1 s per attempt, against an LLM call of 3–30 s. The kernel was never the expensive part; exporting was the pointless part |
| D4 | The API is **stateless**; continuity comes from an inline `priorDesign` (the full previous document — code *and* parameters) or a `sourceRef` (CID / asset ID) the backend resolves | No design-session registry to build, expire or replicate. Per-wallet **quota and concurrency** state (§6) is separate infrastructure state, not design state |
| D5 | Every attempt passes **validation gates**; failures feed a **bounded auto-repair loop** (3 attempts, env-tunable) | The client only ever receives code that passed; the response carries the attempt log so failures are debuggable |
| D6 | The model writes **free-form Manifold JS against a curated prelude** | Maximum expressiveness; the prelude is where the fillet strategy is encapsulated so the model never improvises it |
| D7 | **No `mode: "execute"`** and no server-side artifact production | With the client owning execution, a parameter edit is a local re-run: zero tokens, zero network, zero server CPU. The earlier server-side execute mode and its 500/day budget are deleted, not deferred |
| D8 | Per-SIWE limits: **50 LLM requests/day**, **one in-flight request per wallet**, plus the existing hourly limiter | Generation costs server-side tokens and CPU; the quota is durable and the lock prevents a wallet running two at once |

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

## 5. Validation (the server's only use of the kernel)

### Static gates — always, in-process, no execution

Script size cap; reject `import`, `require`, `eval`, `Function`, `process`,
`globalThis`, `fetch`, `fs`, `child_process`, `WebAssembly`; require `PARAMETERS` and a
`return`; require that every called helper name **exists in the prelude** (this catches
hallucinated API calls for free, before spending a kernel run); parse the code without
executing it (`new Function(code)` compiles but is never invoked).

### Kernel validation — per attempt, in a fresh child process

`backend/validate-runner.ts` spawns `backend/child.ts`, which loads `manifold.wasm`,
runs the script, evaluates `status()`, `numTri()`, `volume()` and the bounding box, and
returns **stats only**. The mesh is discarded in the child; **no bytes cross back, and
nothing is exported**. Limits: wall-clock timeout (10 s, hard kill), JS heap flag, and a
triangle budget enforced in the child.

Gates: runs → returns a `Manifold` → `status() === 'NoError'` → non-zero triangle count
within budget → positive volume → bounding box consistent with the declared parameters.

> Honest limit: `child_process` has no built-in memory rlimit. Milestone 1 ships
> timeout + triangle budget + heap flag; true `ulimit`-based caps are a hardening
> follow-up (§11).

### Repair

On any gate failure the failing code plus the exact error go back as a further turn, up to
`CAD_MAX_REPAIR_ATTEMPTS` (default 3). Exhausting the budget returns
`CAD_GENERATION_FAILED` with the last error and the full attempt log — the client never
receives code that failed validation.

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
  "validation": {
    "mode": "kernel", "ok": true,
    "stats": { "triangles": 4820, "volume_mm3": 91234.5, "bbox_mm": [80, 60, 12], "filletMode": "minkowski" }
  },
  "diagnostics": {
    "attempts": [{ "index": 0, "ok": false, "gates": { … }, "error": "…" }],
    "durationMs": 8412,
    "tokens": { "prompt": 3120, "completion": 840 }
  },
  "provider": { "id": "deepseek", "model": "deepseek-flash" }
}
```

There is no `artifacts` array and no `formats` field: GLB and 3MF are produced on the
client (§7).

### Quota, concurrency and budget

Three controls keyed by the **SIWE wallet address** (`res.locals.userAddress` — the same
key the existing limiters use), all enforced before any LLM call.

**One in-flight request per wallet.** An in-memory `Map<wallet, { token, startedAt }>`
(mirroring `generation-tasks.ts`), acquired synchronously at admission and released in a
`finally` so a failed or repaired request always frees it. A blocked request gets **409
`GENERATION_IN_PROGRESS`** with `Retry-After` and `details: { startedAt }`. A hard TTL
(`CAD_MAX_REQUEST_MS`, default 120 s) with lazy expiry stops a crashed request wedging a
wallet. The lock is deliberately **not** persisted — in-flight work cannot survive a
restart.

**Daily request quota — 50 LLM requests.** `CAD_DAILY_REQUEST_LIMIT` (default 50) per
wallet over a **UTC calendar day**. One *accepted request* is one unit regardless of how
many repair attempts it internally spends, so a user is never charged for the model's
failures. Consumption happens at admission, which closes the fail-and-retry storm.
Exhaustion returns **429 `DAILY_QUOTA_EXCEEDED`** with `details: { limit, used, resetsAt }`.

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

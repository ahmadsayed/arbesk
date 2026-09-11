# Manifold-based engineering CAD generation (`@arbesk/cad-gen`) — design

**Date:** 2026-09-11 · **Status:** design, pending review · **Milestone:** 1 (generation engine only)

## 1. Goal

Add a prompt-driven **engineering part** generator to Arbesk: the user describes a part
in natural language (optionally with images), a language model writes Manifold code,
we execute that code against the Manifold WASM kernel, validate the resulting solid,
and return it as **GLB** and **3MF**. Each turn is aware of the previous design *as
code*, so the user iterates: *create a box → add holes along X, −Y, Z → fillet the edges*.

Explicitly out of scope for this milestone: Studio UI, IPFS persistence, publish/version
chain, CLI/MCP exposure. Those integrate later against the API defined here.

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Canonical design state is a **full Manifold script plus a required `PARAMETERS` object**; every turn rewrites the complete script | Never leaves the server holding a half-applied patch; a parameter tweak later needs no LLM call |
| D2 | New workspace package `@arbesk/cad-gen` + a backend HTTP route | The CAD path is a local kernel + code, not a remote "taskId → poll → download" provider; forcing it into the `GenerationProvider` facade would overload that abstraction |
| D3 | Generated code runs in a **fresh child process** per attempt, behind a static pre-flight allowlist | Real OS isolation boundary; `node:vm` is not a security boundary and `worker_threads` shares the process. Spawn cost (~100 ms) is negligible against an LLM round trip |
| D4 | The API is **stateless**; continuity comes from an inline `priorCode` or a `sourceRef` (CID / asset ID) the backend resolves | No server-side session registry to build, expire, or replicate. Durability is the caller's problem until IPFS integration lands |
| D5 | Every attempt passes **validation gates**; failures feed a **bounded auto-repair loop** (3 attempts, env-tunable) | The user only ever sees a mesh that passed; the response still carries the attempt log so failures are debuggable |
| D6 | The model writes **free-form Manifold JS against a curated prelude** | Maximum expressiveness; the prelude is where the fillet strategy is encapsulated so the model never improvises it |

## 3. Architecture

New package `packages/cad-gen/` → `@arbesk/cad-gen`, structured like
`@arbesk/ai-asset-gen`: erasable TypeScript, `.ts` relative imports, `tsc` → `dist/`
(ESM + `.d.ts`), consumed by bare specifier.

```
packages/cad-gen/src/
  index.ts                public exports
  types.ts                port + config types
  facade.ts               createCadGenerator(config) composition root
  errors.ts               CadError hierarchy
  design/document.ts      CadDesign type, parse/validate, PARAMETERS extraction
  codegen/deepseek.ts     OpenAI-compatible client (vision + JSON output mode)
  codegen/prelude.ts      curated CAD prelude, shipped as source into the sandbox
  codegen/prompt.ts       system prompt, API reference, turn assembly
  codegen/repair.ts       bounded repair loop + diagnostics
  kernel/runner.ts        parent side: spawn, IPC, timeout, caps
  kernel/child.ts         child entry: load manifold.wasm, run script, emit mesh
  kernel/guard.ts         static pre-flight allowlist/denylist
  kernel/validate.ts      mesh gates
  export/glb.ts           mesh → GLB (reuses asset-core's serializer)
  export/three-mf.ts      mesh → .3mf OPC package
  export/embed.ts         design-document sidecar read/write
```

### Boundaries

- Backend-only (Node globals: `Buffer`, `fs`, `path`, `child_process`, `fetch`,
  `AbortSignal`). Never imported by the browser.
- No imports from `frontend/`, `src/api/`, or `constants/`.
- **Depends on `@arbesk/asset-core`** for glTF/GLB serialization
  (`@arbesk/asset-core/formats/gltf/gltf-core.js` → `serializeGLB`). Reusing the
  sanctioned public subpath is preferable to hand-rolling a second GLB writer. The
  mesh→3MF writer lives in `cad-gen` because asset-core's 3MF module is a
  *composite-package rebuild* codec, not a mesh exporter; adding mesh export there is a
  separate, more invasive change. `packages/AGENTS.md` dependency order gains
  `asset-core ← cad-gen`.
- External inputs arrive through injected ports: `resolveAsset(ref)` (IPFS/indexer
  lookup owned by the backend) and an injectable `fetch` for the LLM client.
- eslint: add a `packages/cad-gen/src/**/*.ts` boundary block mirroring the existing
  per-package blocks (restricted imports + restricted globals).

### Facade

```ts
createCadGenerator(config: CadGenConfig): CadGenerator
```

```ts
interface CadGenConfig {
  id: "manifold-deepseek";
  apiKey: string;               // DEEPSEEK_API_KEY
  baseUrl?: string;             // default https://api.deepseek.com
  model?: string;               // default "deepseek-flash"
  resolveAsset?: (ref: AssetRef) => Promise<ResolvedAsset>;  // {cid}|{assetId}
  limits?: CadLimits;           // timeouts, triangle budget, attempts, image caps
  fetchImpl?: typeof fetch;     // test seam
}

interface CadGenerator {
  generate(input: CadGenerateInput): Promise<CadGenerateResult>;
  execute(input: CadExecuteInput): Promise<CadExecuteResult>;  // no LLM
  capabilities(): CadCapabilities;  // { formats: ["glb","3mf"], vision: true, maxImages: number }
}
```

## 4. The design document

The model is called in **JSON output mode** and must return exactly:

```jsonc
{
  "code": "const b = roundedBox(P.width, P.depth, P.height, P.fillet);\nreturn hole(b, { ... });",
  "parameters": {
    "width": { "value": 60, "unit": "mm", "min": 10, "max": 200, "label": "Overall width" }
  },
  "summary": "Added three Ø6 through-holes along X, −Y and Z"
}
```

- `code` — the **body of a function** whose parameters are `PARAMETERS`, the prelude
  helpers, and `M` (the raw `Manifold` class for anything the prelude does not cover).
  It **must `return` a `Manifold`**.
- `parameters` — the single source of truth for dimensions. Gates assert the script
  references `PARAMETERS`; a lint flags bare numeric literals above a threshold.
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
hole(part, { diameter, axis, at, through })                 // at: [a, b] in the plane ⟂ to axis;
boltCircle(part, { count, diameter, circleDiameter, axis, at })  // axis-aligned, centred on the part mid-axis
filletEdges(part, r, { mode })           // "minkowski" | "smooth" | "auto"
chamferEdges(part, r)
// inspection
bbox(part) → { min, max, size }          volume(part) → number
```

Conventions pinned in the system prompt: **millimetres, Z-up, solids only, `Ø` means
diameter, prefer `roundRect`+extrude or `roundedBox` for prismatic parts.**

### Fillet fidelity (a real constraint, surfaced not hidden)

Manifold is a **mesh kernel**; it has no `fillet()`/`chamfer()`. Three strategies exist:

| Strategy | Fidelity | Cost |
|----------|-----------|------|
| `roundRect`/`roundedBox` → `extrude` | **Exact** on prismatic parts | Cheap — the recommended default |
| `minkowskiSum(sphere)` / `minkowskiDifference` | Geometrically correct rounding; convex edges (concave needs the difference form) | Triangle count grows fast |
| `smoothOut()` + `refineToLength()` | Tangent-based; looks filleted, mesh stays faceted | Cheap |

`filletEdges(part, r, { mode })` defaults to `"auto"`: attempt `minkowski`, downgrade to
`smooth` when the projected triangle count exceeds the budget, and **record the mode
actually used in diagnostics** so fidelity is never silently overstated. True B-rep
fillets and STEP export would require an OCCT-class kernel — out of scope (see §12).

## 5. Execution and validation

**Pre-flight (parent, static, before spawning).** Script size cap; reject
`import`, `require`, `eval`, `Function`, `process`, `globalThis`, `fetch`, `fs`,
`child_process`, `WebAssembly`; require `PARAMETERS` and a `return`. A rejection is a
repair turn, not a hard failure.

**Execution.** `kernel/runner.ts` spawns `kernel/child.ts` once per attempt. The child
loads `manifold.wasm`, wraps the script
(`new Function("PARAMETERS", ...preludeNames, code)`), runs it, and writes a compact
mesh — `Float32Array` positions + `Uint32Array` indices — to a temp file, with a small
JSON stats header on stdout. Limits: wall-clock timeout (default 10 s, hard kill),
JS heap flag, and a triangle budget enforced **in the child** before it returns.

> Honest limit: `child_process` has no built-in memory rlimit. Milestone 1 ships
> timeout + triangle budget + heap flag; true `ulimit`-based memory caps are a
> hardening follow-up recorded in §11.

**Gates (after each attempt).** Parses → runs → returns a `Manifold` →
`status() === 'NoError'` → `numTri()` non-zero and within budget → bounding box
consistent with declared parameters. Every gate result is recorded.

**Repair.** On any gate failure the failing code plus the exact error go back as a
further turn, up to `CAD_MAX_REPAIR_ATTEMPTS` (default 3). Exhausting the budget
returns `CAD_GENERATION_FAILED` with the last error and the full attempt log — never a
partial or unvalidated mesh.

**Determinism.** Manifold is deterministic; identical `(code, parameters)` yields an
identical mesh, which is what makes `mode: "execute"` trustworthy.

## 6. HTTP API

Mounted in `src/api/index.ts` next to `v1.use("/generations", …)`.

### `POST /api/v1/cad/generations`

Session-authenticated (`Authorization: Session <token>`) and rate-limited.

```jsonc
{
  "prompt": "add three 6mm through-holes along X, -Y and Z",
  "priorCode": "…previous Manifold script…",      // stateless continuity
  "parameters": { "width": 80 },                  // optional overrides
  "mode": "generate",                             // "generate" | "execute"
  "sourceRef": { "cid": "bafy…" },                // or { "assetId": "…" }
  "images": [{ "data": "<base64>", "mime": "image/png" }],
  "formats": ["glb", "3mf"],   // default: both
  "repairAttempts": 3            // capped by CAD_MAX_REPAIR_ATTEMPTS
}
```

`mode: "execute"` re-runs known-good code with parameter overrides and makes **no LLM
call** — the cheap path for interactive slider edits.

Response:

```jsonc
{
  "design": { "code": "…", "parameters": { … }, "summary": "…", "turn": 3 },
  "artifacts": [
    { "format": "glb", "path": "asset.glb", "assetData": "<base64>",
      "byteLength": 84213, "sha256": "…" }
  ],
  "diagnostics": {
    "attempts": [{ "index": 0, "ok": false, "error": "…", "gates": { … } }],
    "durationMs": 8412,
    "tokens": { "prompt": 3120, "completion": 840 },
    "filletMode": "minkowski"
  },
  "provider": { "id": "deepseek", "model": "deepseek-flash" }
}
```

### Errors

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Zod body validation (existing `validateBody` helper) |
| 400 | `SOURCE_ASSET_UNSUPPORTED_FORMAT` | `sourceRef` resolves to something with no embedded design document |
| 400 | `SOURCE_ASSET_UNAVAILABLE` | `sourceRef` not found in storage/indexer |
| 401 | — | missing/invalid session (existing middleware) |
| 413 | `IMAGE_TOO_LARGE` | image beyond `CAD_MAX_IMAGE_BYTES` |
| 429 | `RATE_LIMITED` | CAD rate limiter |
| 500 | `CAD_GENERATION_FAILED` | all repair attempts failed — carries `diagnostics` |
| 502 | `PROVIDER_ERROR` / `PROVIDER_AUTH_FAILED` | DeepSeek transport/auth (mirrors the existing `providerErrorCode` mapping) |
| 503 | `CAD_NOT_CONFIGURED` | `DEEPSEEK_API_KEY` unset |

The route is thin, per `docs/ARCHITECTURE.md §1.5`: it validates, authenticates, rate
limits, and delegates — it holds no CAD logic.

### Environment (`.env.example`, `docs/CURRENT_STATUS.md §8`)

```bash
DEEPSEEK_API_KEY=            # server-only; never served to the browser
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
CAD_GENERATION_ENABLED=      # unset → enabled iff DEEPSEEK_API_KEY is present
CAD_MAX_REPAIR_ATTEMPTS=3
CAD_EXEC_TIMEOUT_MS=10000
CAD_MAX_TRIANGLES=200000
CAD_MAX_IMAGES=4
CAD_MAX_IMAGE_BYTES=8388608
CAD_RATE_LIMIT_MAX=          # override for the CAD limiter
```

## 7. Export

- **Units/orientation.** Manifold works in **mm, Z-up**. glTF is **meters, Y-up**, so GLB
  export applies rotate −90° about X and scale 0.001 — the same convention
  `packages/asset-core/src/formats/3mf/to-gltf.ts` already applies for 3MF input, so a
  CAD part sits at true size on the Studio grid. The 3MF stays mm/Z-up.
- **GLB.** Single mesh, computed normals, default material, via asset-core
  `serializeGLB`.
- **3MF.** New writer emitting `[Content_Types].xml`, `_rels/.rels`,
  `3D/3dmodel.model` (mesh object + build item), and the sidecar part below. manifold's
  own `lib/export-3mf.js` is deliberately **not** reused: it pulls
  `@jscadui/3mf-export`, a second `@gltf-transform` (4.2.x vs the catalog's 4.1.2), and
  an `esbuild-wasm` peer, and offers no hook for custom parts.
- **Self-describing artifacts.** The design document is embedded as a declared OPC part
  `Metadata/arbesk_cad.json` in the 3MF and as `asset.extras.arbesk_cad` in the glTF.
  Any CID or asset ID of a previously generated part therefore round-trips the full
  design state — that is what turns statelessness (D4) into a feature rather than a
  limitation, and it needs no manifest-schema change.

## 8. Security and cost

- The DeepSeek key is server-side and is the *only* secret; it is never logged or
  returned. Cost is therefore borne by the server, unlike Tripo's BYOK — so rate
  limiting and token accounting are mandatory, and per-request token usage is logged.
- Generated code is treated as hostile: static pre-flight, isolated child process,
  timeout kill, triangle budget. Prompt injection through an attached image can at
  worst produce a wrong part, never a command — the isolation is what makes that true.
- No on-chain quota gate in milestone 1: nothing is minted and no asset is created, so
  the free-tier contract semantics do not apply yet. Revisit when generation becomes a
  published asset.

## 9. Testing

| Layer | Approach |
|-------|----------|
| Prelude helpers | Run real Manifold geometry and assert volumes/bboxes (cube − cylinder = expected volume) |
| Guard | Table-driven accept/reject cases for every denied construct |
| Gates | Scripted failures per gate (throw, empty mesh, non-manifold, oversized, dimension mismatch) |
| DeepSeek client | Mocked `fetchImpl`; JSON-mode parse failures; auth and 5xx mapping |
| Repair loop | Fake generator returning a scripted failure sequence; assert attempt count and diagnostics |
| Exporters | Golden structure assertions on the 3MF parts and GLB header; **round-trip the emitted 3MF back through asset-core's own 3MF parser + `to-gltf`** to prove third-party-shaped validity |
| Route | `supertest` with a loopback fake LLM (existing pattern in `test/api.test.js`); no live API calls in CI |
| Smoke (not CI) | `scripts/cad-smoke.mjs` — runs the three-turn example against the live API when `DEEPSEEK_API_KEY` is set |

The kernel is exercised **through the spawned child**, not by importing manifold into the
Jest VM — this sidesteps ESM/WASM-in-Jest entirely and tests the real isolation path.

## 10. Spike (must pass before feature work)

1. `manifold.wasm` loads and runs under **Bun**, returning a mesh for cube − cylinder.
2. The same inside a spawned child process, with a timeout kill that actually terminates it.
3. It resolves inside the **compiled single-file server** (`bun run build:server`) —
   `scripts/build-server.mjs` already embeds brotli's wasm through exactly this shim
   pattern; manifold needs the sibling of that shim.
4. asset-core's `serializeGLB` accepts the produced glTF (normals, indices, one primitive).

If (1)–(3) fail, the fallback is to ship the WASM-embedding shim from the start rather
than as a follow-up.

## 11. Risks

| Risk | Mitigation |
|------|-----------|
| WASM under Bun / compiled binary | Spike §10 gates all feature work; shim precedent exists |
| Model reliability on multi-feature scripts | Repair loop + curated prelude + few-shot examples; tracked by a fixed ~10-prompt eval set used as a regression baseline |
| Fillet fidelity | Documented in §4; actual mode reported in diagnostics; prismatic path is exact |
| Latency (no streaming; 3–30 s) | Long route timeout, duration/token logging; streaming and progress are UI-milestone concerns |
| Cost/abuse | Rate limiter, global daily cap, token accounting |
| Child-process memory rlimits absent | Recorded follow-up: `ulimit`-based wrapper or a worker pool with `resourceLimits` |
| 3MF rejected by slicers | Round-trip through asset-core's parser in tests; manual check in PrusaSlicer/Bambu Studio before calling the milestone done |

## 12. Out of scope (future milestones)

- Studio UI: prompt/chat panel, orbit preview, parameter sliders (uses `mode: "execute"`).
- IPFS persistence, manifest chain, publish — each version becomes a real Arbesk asset
  with `metadata.chat` provenance.
- Client-side parametric re-execution in the browser (Manifold WASM in a module worker).
- STEP/IGES or B-rep (OCCT-class kernel) for manufacturing-exact fillets.
- Assemblies, mating constraints, drawings, tolerance stacks.
- `besk` CLI + MCP parity (required by the CLI↔MCP rule once a subcommand exists).
- Provider abstraction: DeepSeek is hard-wired in milestone 1; a second LLM provider
  would introduce the capability-gated facade pattern.

## 13. Assumptions

- `deepseek-flash` is reachable via the OpenAI-compatible endpoint and accepts inline
  base64 images (48 MiB request body cap) — confirmed in DeepSeek's Vision guide.
- The design document travels inside the artifacts (§7); any `sourceRef` produced by a
  *different* tool has no embedded code and is rejected with
  `SOURCE_ASSET_UNSUPPORTED_FORMAT`.
- Milestone 1 persists nothing server-side; callers hold the design document.

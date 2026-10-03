# CAD generation as a provider in `@arbesk/ai-asset-gen` — design

Date: 2026-10-04 · Status: approved direction, pending implementation plan

## Goal

Make `@arbesk/cad-gen` a first-class provider of `@arbesk/ai-asset-gen`, alongside
`mock` and `tripo3d`, so one provider id (`"cad"`) routes through the existing
`POST/GET /api/v1/generations` pipeline. In the same change, replace the
if/else factory in `createGenerationProvider` with an IoC provider registry,
and add a glTF exporter to cad-gen (the client-side render target).

## Decision log (user-approved)

1. **Pattern**: keep the `GenerationProvider` facade; replace the hard-coded
   factory with a **provider registry** — factories injected at the composition
   root (registry pattern / IoC, not a DI container, no module-global
   `registerProvider()`).
2. **Design-on-the-wire**: the cad provider returns the `CadDesign` document
   (Manifold code + parameters + summary). The API never runs the kernel and
   never returns geometry — cad-gen ruling S11 is unchanged. The client runs
   guard → kernel → export later (frontend is out of scope here).
3. **glTF, not GLB**: the future client-side export produces **self-contained
   glTF JSON** (base64 data-URI buffer) via a new `meshToGltf`, parallel to
   `meshToGlb`.
4. **Backend only** in this task: registry + cad provider + route wiring +
   `meshToGltf` + tests. The browser worker and create-panel wiring are a
   follow-up milestone.

## Non-goals

- Frontend cad runner (browser worker, provider select entry, chat/version
  integration). The response contract below is shaped so that work can land
  without API changes.
- CAD follow-ups (retexture/retopo/rig of CAD parts), image-to-3D via cad,
  `sourceRef` repair rounds through `/api/v1/generations`.
- Any STL format work.

## 1. Provider registry (`packages/ai-asset-gen`)

New `src/registry.ts`:

```ts
export type ProviderFactory = (config: GenerationConfig) => GenerationProvider;
export interface ProviderRegistry {
  resolve(id: string, config: GenerationConfig): GenerationProvider;
}
export function createProviderRegistry(
  factories: Readonly<Record<string, ProviderFactory>>,
): ProviderRegistry
```

- Unknown id → `throw new Error("unknown generation provider: " + id)`
  (message identical to today's, so existing error handling keeps working).
- `facade.ts`'s `createGenerationProvider` is re-implemented on top of a
  default registry `{ mock, tripo3d }` — one source of truth, byte-identical
  behavior for existing callers (the backend and package tests).
- `src/index.ts` additionally exports `createProviderRegistry`,
  `ProviderRegistry`, `ProviderFactory`, and the cad provider entry points.
- Cad-specific construction input (a `CadGenerator`) does not fit
  `GenerationConfig`, so `createCadProvider` takes its own options object
  (§2) and the composition root binds it into a `ProviderFactory` closure.

## 2. Cad provider (`packages/ai-asset-gen/src/providers/cad-provider.ts`)

```ts
export interface CadProviderOptions {
  /** Facade config: id ("cad") + declared capabilities (["text-to-3d"]). */
  config: GenerationConfig;
  /** Injected CAD generator (built from env at the composition root). */
  generator: CadGenerator;          // from @arbesk/cad-gen/backend/index.js
  /** Invoked exactly once when a task settles (success or failure). */
  onSettle?: (taskId: string, outcome: CadSettleOutcome) => void;
}

export type CadSettleOutcome =
  | { ok: true; result: CadGenerateResult }
  | { ok: false; error: { message: string; code?: string;
                          suitability?: number; alternative?: unknown } };
```

Behavior:

- **Capabilities**: exactly what the config declares — the composition root
  passes `["text-to-3d"]`. Every other facade method gates through
  `requireCapability` → `UnsupportedCapabilityError`, like mock.
- **Task lifecycle** (collapsed in-process, the mock precedent):
  - `textToModel({prompt})` → `requireCapability("text-to-3d")`, creates an
    `AbortController`, registers a running task, starts
    `generator.generate({ prompt, signal })` detached (all rejections are
    captured into task state — nothing escapes unhandled), returns the
    `cad-<uuid>` taskId immediately.
  - Settle: success stores the `CadGenerateResult`; failure maps
    `CadRequestUnsuitable` → `{ code: "CAD_REQUEST_UNSUITABLE", suitability,
    alternative: err.alternative }`, other errors → `{ message }`. Then
    `onSettle` fires exactly once.
  - `poll(taskId)`: running → `{ status: "running", progress: 0 }`; success →
    `{ status: "success", format: "cad-design", output: <CadGenerateResult> }`;
    failed → `{ status: "failed", error: <message>, output: <error details> }`;
    unknown/expired → `{ status: "failed", error: "unknown task" }`.
  - `download(taskIdOrUrl)`: rejects URLs (cad has none); returns the
    `TextEncoder` bytes of the wire-result JSON (the same shape the route
    returns, §4) for a succeeded taskId; throws otherwise.
  - `cancel(taskId)` → `controller.abort()`, drop the task, return whether it
    existed.
- **Module-level task store**: `Map<taskId, state>` at module scope, lazily
  swept at access with the same 1 h TTL as `src/api/generation-tasks.ts`.
  Closure scope (the mock precedent) is not viable here: the poll/DELETE
  handlers rebuild the provider per request from env — cad has no BYOK key to
  reconstruct with — so the store must outlive any provider instance. Same
  process-lifetime guarantee as the route's task registry: tasks complete
  in-process or not at all.
- **Quota is not the provider's business**: the provider only generates and
  emits `onSettle`; charging, refunding and locks live in the route (§4).

## 3. glTF exporter (`packages/cad-gen`)

New `src/core/export/gltf.ts`: `meshToGltf(mesh, design): string`.

- Refactor `glb.ts` to extract the shared document builder
  (`buildPartDocument(mesh, design)` → `{ gltf, bin }`: node matrix, normals,
  material, accessors, `asset.extras.arbesk_cad` sidecar, `arbesk_units: "mm"`).
  `meshToGlb` = `serializeGLB(doc, bin)`; `meshToGltf` = same document with
  `buffers[0].uri = "data:application/octet-stream;base64,..."` and
  `JSON.stringify`. Never hand-roll either container.
- Output is a **self-contained** glTF 2.0 JSON document: the single binary
  chunk rides as a base64 data URI, so one string carries the whole part plus
  the lossless design sidecar. This matches how the platform already handles
  `.gltf` assets (base64 data URIs at render ↔ `ipfs://` in storage via the
  asset-core composer) and matches the existing `.gltf` mock sample
  (`mock-gltf-assets/suka.gltf`).
- Browser-safe (core/), exported from the core barrel next to `meshToGlb` /
  `meshTo3mf`. Nothing consumes it in the frontend yet — it ships now because
  it is the export step of the follow-up client-side runner.

## 4. Backend wiring (`src/api`)

### Composition root — new `src/api/generation-providers.ts`

- `resolveCadProvider(deps, onSettle)` reuses the exported
  `cadConfigFromEnv(env, deps)` from `src/api/routes/cad.ts` (same env vars:
  `CAD_GENERATION_ENABLED`, `DEEPSEEK_*`, `JEV_*`, `CAD_MAX_REPAIR_ATTEMPTS`,
  `CAD_DAILY_REQUEST_LIMIT`, …) and wraps its generator:
  `createCadProvider({ config: { id: "cad", capabilities: CAD_CAPABILITIES },
  generator, onSettle })`. `onSettle` is supplied by the route (§4) because it
  must close over the quota slot taken after config resolution.
- `GenerationProvidersDeps` mirrors `CadRouteDeps` (`generator?`,
  `authenticateOverride?`-free, `quotaStatePath?`, `fetchImpl?`, injectable
  `env`) so tests can inject a stub generator and a temp quota file.
- `CAD_CAPABILITIES = ["text-to-3d"]`, declared next to `MOCK_CAPABILITIES` /
  `TRIPO_CAPABILITIES` in `generate-node.ts`.
- The `onSettle` semantics (implemented by the route, which owns metering):
  release the cad slot unconditionally; refund the unit when
  `!ok && error.code === "CAD_REQUEST_UNSUITABLE"`.

### `src/api/generation-tasks.ts`

`TaskEntry`/`RegisterTaskInput` gain `provider?: "tripo3d" | "cad"`
(absent = `"tripo3d"`, preserving every existing entry and call site). Cad
entries store the cad taskId in `tripoTaskId` (the field is provider-generic
in practice) and `providerKey: ""`.

### `src/api/assets/generate-node.ts`

- `resolveProvider` gains a third arm; the POST handler branches on
  `effectiveProvider === "cad"` **before** the BYOK gate (cad is server-paid,
  no `providerKey`), alongside the existing mock/tripo arms. Unknown provider
  stays 501 `NOT_IMPLEMENTED`.
- **POST cad branch**: `resolveCadProvider()` → 503 `CAD_NOT_CONFIGURED` when
  unconfigured (same body the cad routes use) → pre-checks already handled by
  `generateAssetSchema` → `acquireCadSlot(userAddress, quota)` → on refusal,
  409 `GENERATION_IN_PROGRESS` / 429 `DAILY_QUOTA_EXCEEDED` with the
  `X-Cad-Quota-*` headers (identical bodies to `refuseAdmission` in
  `routes/cad.ts`) → now the slot token exists, so build the provider with an
  `onSettle` that closes over wallet + token + quota (release the slot; refund
  on `CAD_REQUEST_UNSUITABLE`) → `provider.textToModel({prompt})` →
  `registerTask(..., { provider: "cad" })` → **202** `{ taskId, provider:
  "cad", status: "running" }` with quota headers. The slot is taken before the
  provider call and `onSettle` fires exactly once per task, so an in-flight
  LLM round always releases exactly once and refunds at most once.
- **GET `/:taskId`**: branch on `entry.provider === "cad"` before
  `buildTripoProvider` — rebuild the cad provider from env, `poll`, then
  `respondToPoll` (below). The cad provider's module-level store answers the
  poll even though this is a fresh instance.
- **`respondToPoll`**: success with `poll.format === "cad-design"` →
  `completeCadTask` (no `download`, no `assetData`): mark complete, 200 body
  in §4. Failure with `poll.output?.code === "CAD_REQUEST_UNSUITABLE"` → 200
  `{ status: "failed", error: { code: "CAD_REQUEST_UNSUITABLE", message,
  suitability, alternative } }` and evict (the refund already happened at
  settle time). All other cad failures use the existing
  `sendTaskFailed` path.
- **DELETE `/:taskId`**: cad branch → `provider.cancel(entry.tripoTaskId)`,
  evict, `{ status: "cancelled", upstreamCancelled }` (same body).
- The hourly `cadRateLimit` middleware stays on `/api/v1/cad/*` only; the
  unified cad path is bounded by the global `generationRateLimit` plus the
  cad quota (daily rounds + one in-flight per wallet).

### Response shapes

Poll success for cad (200):

```json
{
  "status": "success",
  "format": "cad-design",
  "design": { "code": "...", "parameters": {}, "summary": "...", "turn": 1 },
  "runtime": { "contractVersion": 1, "preludeVersion": "..." },
  "provider": { "id": "deepseek", "model": "deepseek-flash" },
  "attribution": [],
  "diagnostics": { "selection": {}, "attempts": [], "durationMs": 0, "tokens": {} },
  "providerTaskId": "cad-<uuid>"
}
```

There is deliberately **no `validation` field** and no `assetData` — the server
ran no kernel (S11), and the client-side kernel/export is the follow-up. The
`format: "cad-design"` discriminator is what the future frontend branches on.

## 5. Error handling

| Condition | Response |
|---|---|
| `CAD_GENERATION_ENABLED=false` / missing `DEEPSEEK_API_KEY` / unusable bounds | 503 `CAD_NOT_CONFIGURED` (from `cadConfigFromEnv`) |
| Wallet already has a cad request in flight | 409 `GENERATION_IN_PROGRESS` + `Retry-After` |
| Daily cad rounds exhausted | 429 `DAILY_QUOTA_EXCEEDED` + `X-Cad-Quota-*` |
| Organic/artistic subject (`CadRequestUnsuitable`) | settle-time quota refund; poll → 200 `status:"failed"`, `error.code: "CAD_REQUEST_UNSUITABLE"` + `suitability` + `alternative: { kind: "organic-mesh", provider: "tripo3d" }` |
| DeepSeek/provider failure | poll → 200 `status:"failed"`, existing `PROVIDER_TASK_FAILED` shape |
| Unknown provider id (not mock/tripo3d/cad) | 501 `NOT_IMPLEMENTED` (unchanged) |

## 6. Testing

- `test/ai-asset-gen/cad-provider.test.js` — fake `CadGenerator`: success
  lifecycle (running → success with full result in `output`, `format:
  "cad-design"`), `download` JSON round-trip, unsuitable/generic failure
  mapping, `onSettle` exactly once, cancel aborts + deletes, unknown/expired
  task, undeclared capabilities throw `UnsupportedCapabilityError`.
- `test/ai-asset-gen/registry.test.js` — resolve dispatches per id, unknown id
  throws, factory receives the config; `createGenerationProvider` behavior
  unchanged (existing facade tests keep passing unmodified).
- `test/cad-gen/exporters.test.js` — `meshToGltf`: parses as glTF 2.0 JSON,
  data-URI buffer decodes to `byteLength`, accessors/bufferViews/material/node
  matrix byte-identical to the `meshToGlb` document for the same mesh,
  `asset.extras.arbesk_cad` sidecar present.
- Backend route tests (new `test/api/generations-cad.test.js`): POST
  `provider:"cad"` → 202 → poll running → success design JSON; no
  `providerKey` required; 409/429 admission refusals; unsuitable → refund
  verified in quota state; disabled → 503; unknown provider → 501; tripo/mock
  paths unaffected.
- `bun run lint && bun run typecheck`; `bun run test -- test/ai-asset-gen
  test/cad-gen test/api` (subjects of this change).

## 7. Docs to update

- `packages/ai-asset-gen/AGENTS.md` — boundary: now depends on
  `@arbesk/cad-gen` (backend entry); registry pattern; cad provider section
  (design-on-the-wire, module-level store rationale).
- `packages/AGENTS.md` — dependency-order diagram: `ai-asset-gen → cad-gen`.
- `packages/cad-gen/AGENTS.md` — exporters: add glTF; `package.json`
  description "GLB/3MF" → "glTF/GLB/3MF".
- Root `AGENTS.md` §1 — provider list gains cad (one line); the frontend
  integration stays marked as not-yet-wired.
- `docs/API_SPEC.md` — `provider: "cad"` on `POST /api/v1/generations` and the
  cad-design poll response.

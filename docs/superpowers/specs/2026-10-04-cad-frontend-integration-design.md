# CAD Provider Frontend Integration — Design

Date: 2026-10-04
Status: approved-for-implementation (follows `2026-10-04-cad-gen-provider-design.md`, backend milestone committed as `8d4f29e..f85bbca`)

## 1. Goal

Make the `cad` generation provider usable end-to-end from the Studio UI:

1. User picks **Parametric CAD** in the create panel, submits a prompt.
2. Backend returns the Manifold design document (`format: "cad-design"`, no `assetData`).
3. The **browser** runs guard → kernel → export and produces **3MF bytes** (3MF is the
   default and only client export for CAD results).
4. The 3MF is staged through the **same manifest layer and IPFS dedup machinery** as
   glTF assets (raw upload at generation time; composite-3mf decomposition with
   per-part CIDs at save time).
5. Rejection and misconfiguration cases get first-class UI copy instead of raw error text.

## 2. Non-goals

- Parametric re-render UI (the `design.parameters` table is preserved in the 3MF
  sidecar; a future edit panel can re-run the kernel client-side).
- Client-driven repair flow (`POST /api/v1/cad/repairs` stays backend/CLI-only for now).
- Provider-availability discovery endpoint (CAD stays an optimistic option; a
  `CAD_NOT_CONFIGURED` error explains itself — see §7).
- glTF/GLB export option for CAD results (the worker protocol leaves room for it).
- Tripo-style follow-up actions on CAD bubbles (retexture/retopo/rig/animate do not
  apply to parametric meshes).

## 3. Architecture

```
create panel ──POST /generations {provider:"cad"}──► backend (task, quota)
      ▲                                                    │
      │ poll GET /generations/:taskId                      ▼
      │                                          CadGenerateResult (design doc)
      │                                                    │
generateCadAsset() ◄────────── poll success (format "cad-design")
      │
      ├─► cad-render service ──postMessage──► cad-worker.js (module worker)
      │                                         1. guardScript(design.code)   ← client-side guard
      │                                         2. runtime.preludeVersion check
      │                                         3. manifold-3d (WASM) + createCadKernel
      │                                         4. kernel.run(design) → CadMesh
      │                                         5. meshTo3mf(mesh, design) → bytes
      │                                      ◄── {bytes, stats} | {code, message}
      ├─► writeToIPFS(bytes, "asset.3mf") → sourceAssetCid
      ├─► buildGenerationManifest(...) → assetManifestCid   (reused verbatim)
      ▼
GenerateAssetResult {format:"3mf", provider:"cad", ...} ──► presentGenerationResult()
                                                                │
                          existing machinery, zero new code:    ▼
                    ┌─ version-card bubble (format badge "3MF", no action row)
                    ├─ orbit preview via threeMfHandler.load (in-memory 3MF→glTF)
                    ├─ "Show in Studio" → Studio loads the 3MF
                    └─ save/publish → decomposeForSave → composite-3mf,
                        parts as separate CIDs (uploadWithDedup — the glTF layer)
```

Key property: **the cad path converges to the existing `format: "3mf"` asset pipeline
before any UI consumes it.** The 3MF handler (`frontend/src/js/formats/handlers/3mf-handler.ts`)
already implements load/preview/save/dedup for 3MF; the mock provider already proves the
end-to-end 3MF bubble flow. The only genuinely new frontend machinery is the render worker
and the poll-to-render seam.

The design document is persisted at generation time: `meshTo3mf` embeds it as the OPC
part `Metadata/arbesk_cad.json`, so the IPFS-stored 3MF alone reconstructs the design
(and its licence credits) via `readDesignFrom3mf`. This satisfies the backend contract's
"success is delivered exactly once — persist immediately" requirement.

## 4. Components

### 4.1 `frontend/src/js/workers/cad-render-core.ts` (new, pure)

`renderCadDesign(design: CadDesign, manifoldModule, opts): { bytes: Uint8Array, stats, summary }`

- `guardScript(design.code, PRELUDE_NAMES)` — rejection → throw `CadRenderError("CAD_GUARD_REJECTED", …)`
- `createCadKernel(module, { segments: 64 }).run(design)` → mesh + stats
- `meshTo3mf(mesh, design)` → bytes
- Imports only `@arbesk/cad-gen` core (browser-safe: no Node, no manifold loader — the
  host injects the module, matching the kernel's port design).

### 4.2 `frontend/src/js/workers/cad-worker.ts` (new, worker entry)

- Self-contained ESM bundle (same treatment as `gltf-worker.ts`; module workers get no
  import map).
- Loads `manifold-3d` glue with `locateFile` pointing at the staged `manifold.wasm`
  sibling; calls `module.setup()` (mandatory).
- Protocol: `{type:"render", design, runtime}` → `{type:"ok", bytes, stats, summary}` |
  `{type:"error", code, message}`. Transferables for the bytes.
- The worker is the sandbox boundary (per `packages/cad-gen/AGENTS.md`): it holds no
  session token, performs no network I/O, and re-runs the guard locally even though the
  backend already guarded the code — never trust the server's guard.

### 4.3 `frontend/src/js/services/cad-render.ts` (new)

Main-thread wrapper: spawn/terminate `cad-worker.js`, 90 s timeout (kernel has no
client-side bounding; minkowski at segments 64 can run 5–23 s server-side), map worker
errors to `ApiError`-shaped failures with stable codes:
`CAD_GUARD_REJECTED`, `CAD_PRELUDE_MISMATCH`, `CAD_KERNEL_FAILED`, `CAD_RENDER_TIMEOUT`.

### 4.4 `frontend/src/js/services/api.ts` (extend)

- `generateCadAsset({ prompt, signal, onProgress })`: POST `{provider:"cad", prompt}` →
  `pollGeneration` → on `format === "cad-design"` success: `cadRender(design, runtime)` →
  `writeToIPFS(bytes, "asset.3mf")` → `buildGenerationManifest` → returns the standard
  `GenerateAssetResult` with `format: "3mf"`, `provider: "cad"`, `taskId`, `providerTaskId`,
  and `summary` (design summary, used as bubble subtitle/provenance).
- `ApiError` gains an optional `details` field; `parseErrorBody` passes
  `error.details`-style extras through so poll failures keep `suitability`/`alternative`.
- Poll `onProgress` for cad stays indeterminate (backend reports `progress: 0`).

### 4.5 `frontend/src/js/ui/create-panel.ts` + `studio-sidebar.pug` (extend)

- Provider select gains `<option value="cad">Parametric CAD</option>`.
- `isRealProvider()` stays tripo-only (CAD is server-paid; a BYOK key must not gate it),
  but the stop/cancel path must include cad (DELETE works for cad tasks) — change that
  gate from `isRealProvider()` to `provider !== "mock"`.
- Provider-conditional UI: hide view attachments + texture quality + typed-refine chip
  for cad (they are tripo-only upstream).
- `onGenerate` branches to `generateCadAsset` when `provider === "cad"`.
- `generationErrorMessage` gains code-based branches (see §7).
- Tripo-branded copy generalized ("Generating 3D asset…" instead of "on Tripo3D…").

### 4.6 Backend mock seam: `CAD_MOCK_GENERATION`

`src/api/generation-providers.ts`: when `CAD_MOCK_GENERATION=true`, the cad provider is
built with a canned deterministic generator (a small parametric design that passes guard +
kernel, e.g. a sized box) instead of the DeepSeek-backed facade, and the DeepSeek-key
requirement is waived. Mirrors the `MOCK_3D_GENERATION` precedent (warn-but-allow in
production; documented in API_SPEC + AGENTS.md). This exists so dev and E2E can exercise
the full UI flow without a model key.

### 4.7 Bundle/staging (`frontend/scripts/bundle.js`, `compress.js`)

- New worker entry → `dist/workers/cad-worker.js` (self-contained ESM).
- Stage `node_modules/manifold-3d/manifold.wasm` next to the worker
  (resolve from `packages/cad-gen` like the brotli-wasm alias; `manifold-3d` glue is ESM
  and worker-aware).
- `compress.js` must not brotli-precompress the `.wasm` (match existing brotli wasm
  treatment).
- `test/frontend/deployment-integrity.test.js` asserts the new artifacts exist in dist.

## 5. Data flow notes

- **Provenance**: the bubble record carries `provider: "cad"`, `taskId`, `providerTaskId`;
  at save time the chat-provenance entry (manifest `metadata.chat`) is written as for any
  generation, plus the cad `attribution` array is persisted into the generation manifest
  metadata so licence credits survive (`packages/cad-gen/AGENTS.md` marks attribution
  persistence as the client's job).
- **No action row** on cad bubbles: `followupActionsFor` already returns `[]` for
  `provider !== "tripo3d"/"upload"`, and `format "3mf"` would fail its format gate anyway.
- **Preview**: `createChatPreview` resolves `format: "3mf"` through the registered
  handler; the design badge shows "3MF".

## 6. Error handling matrix

| Case | Wire | UI |
|---|---|---|
| Request unsuitable | poll 200 `error.code: CAD_REQUEST_UNSUITABLE` (+`suitability`, `alternative`) | Dedicated copy: what happened, why CAD declined, and — when `alternative.provider === "tripo3d"` — a one-click **Retry with Tripo 3D** action that switches provider and resubmits the same prompt |
| CAD not configured | POST 503 `CAD_NOT_CONFIGURED` | Copy: "Parametric CAD isn't enabled on this deployment" |
| Already in flight | POST 409 `GENERATION_IN_PROGRESS` (+Retry-After) | Existing message-based fallback is human-readable; keep |
| Daily quota | POST 429 `DAILY_QUOTA_EXCEEDED` | Existing 429 mapping; message is human-readable |
| Guard/prelude/kernel/timeout | client-side | Stable codes → copy: refresh-the-app for prelude mismatch, rephrase-prompt for guard rejection, generic retry for kernel/timeout |
| Cancel | DELETE → `cancelled` | Existing stoppable-message flow |

## 7. Testing

- **Unit (`bun test`)**
  - `test/frontend/cad-render-core.test.js`: render a real design with the real manifold
    module (bun can load the WASM, cf. `scripts/lib/cad-harness.mjs`) → 3MF bytes parse
    via asset-core `parse3mfModel`/`parsed3mfToGltf`; guard rejection path; prelude
    mismatch path.
  - `test/frontend/cad-render.test.js`: mocked `Worker` — ok path, error mapping, timeout.
  - `test/frontend/generate-cad-asset.test.js`: poll → render → upload → result shape
    (worker + IPFS + manifest collaborators mocked); `CAD_REQUEST_UNSUITABLE` keeps
    `details`; `CAD_NOT_CONFIGURED` surfaces.
  - create-panel: provider option, `isRealProvider`/stop gating, cad hides tripo-only UI.
  - `test/cad-gen/`: mock-mode backend seam (canned design settles; quota still applies).
  - 3MF round trip: `meshTo3mf` → `threeMfCodec.decompose` → `compose` byte-parity of the
    model part (with asset-core memory runtime).
- **E2E (Playwright)** — new `e2e/specs/20-cad-generation.spec.js` under
  `CAD_MOCK_GENERATION=true` (plumbed through the e2e stack env): select CAD → generate →
  version-card bubble with 3MF badge → live preview canvas non-blank → save/publish →
  manifest `metadata.computed.format === "3mf"` and design sidecar recoverable. Selectors
  added to `e2e/helpers/studio-selectors.mjs`.
- **Full gate**: `bun run test`, `bun run test:frontend`, `bun run lint`, `bun run
  typecheck`, `bun run test:e2e -- --project=chromium` (generation-flow change ⇒ E2E is
  mandatory per repo AGENTS.md §10).

## 8. Risks

| Risk | Mitigation |
|---|---|
| Worker WASM loading differences (locateFile typing bug in manifold-3d `.d.ts`) | Known pattern from brotli-wasm; typed as `any` per `cad-harness.mjs`; E2E exercises the real bundle |
| Kernel runaway (no server-side timeout anymore) | 90 s client timeout + worker termination; guard deny-list runs before eval |
| `manifold.wasm` brotli-compressed by `compress.js` | Explicit exclusion, mirroring `brotli_wasm_bg.wasm` |
| Success delivered once | Design persisted immediately as the 3MF sidecar at generation time |
| Unknown-format fallback in `resolveFormatHandler` | Cad results are staged as `format: "3mf"` — a registered handler — before any UI sees them |

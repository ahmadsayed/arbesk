# Tripo3D Backend Adapter — Design

**Date:** 2026-07-21
**Status:** Approved (pending implementation plan)
**Scope:** Close the `501 NOT_IMPLEMENTED` gap for the `tripo3d` provider on `POST /api/v1/generations` with a task-based async flow, BYOK only.

## 1. Context

The codebase is already scaffolded end-to-end for Tripo3D **except** the backend adapter:

- UI: `#providerSelect` with a `tripo3d` option, BYOK key dialog, localStorage persistence (`arbesk-byok-key`, `arbesk-provider`) — `frontend/src/js/ui/create-panel.js`, `frontend/src/pug/app.pug`.
- Wire contract: `provider` + `providerKey` fields on `POST /api/v1/generations` (Zod-validated, key ≤ 200 chars) — `src/api/schemas.js`.
- Missing: `src/api/assets/generate-node.js` returns `501 NOT_IMPLEMENTED` for any non-mock provider.

Prior design spec (`2026-07-19-ai-generation-sidebar-design.md`) explicitly deferred the Tripo3D backend adapter as a separate effort. This is that effort.

### Verified Tripo3D API facts (tested 2026-07-21)

- The project's key authenticates against the **v2 API** only: `https://api.tripo3d.ai/v2/openapi`, `Authorization: Bearer <key>`. The newer v3 API (`openapi.tripo3d.com/v3`) rejects it (`Invalid API key`).
- Verified endpoints: `GET /v2/openapi/user/balance` → `{code:0,data:{balance,frozen}}`; `POST /v2/openapi/task` → `{code, data:{task_id}}` or error `{code:2010, message:"You don't have enough credit..."}`.
- **Live end-to-end test passed (2026-07-21):** `text_to_model` with `model_version v2.5-20250123`, `texture:true, pbr:true` completed in ~60 s (progress polled 30→100), consumed **20 credits**, and returned `output.pbr_model` — a pre-signed CloudFront GLB URL downloadable **without** auth headers. The download verified as a valid glTF 2.0 binary (~14 MB). `output` also carries `generated_image` (jpeg) and `rendered_image` (webp); a `data.result` map duplicates the URLs with explicit `type` fields (`pbr_model.type: "glb"`).
- **There is no official TS/JS SDK** (Python `tripo3d` only). The adapter uses plain `fetch` — no new dependency.
- Async task pattern: `POST /task {type:"text_to_model", ...}` → poll `GET /task/{task_id}` → `data.status` ∈ `queued|running|success|failed|cancelled`, `data.progress` (0–100), on success `data.output.pbr_model` (GLB URL; fallback `output.model`), plus `output.rendered_image`.
- Observed generation time: ~1 minute for a simple prompt; allow up to several minutes under load.

### Decisions locked during brainstorming

1. **BYOK only** — key arrives per request as `providerKey`; never logged, never persisted. The `.env` `TRIPO_3D_KEY` is a development/testing convenience only and is **not** wired into the server as a fallback.
2. **Task-based API** — `POST /generations` returns a `taskId` immediately; a new polling endpoint delivers progress and the final GLB. (Rejected: polling inside the POST request.)
3. **Model version `v2.5-20250123`** — balanced cost/quality, textured PBR GLB output.
4. **Rate limit skipped for BYOK** — `generationRateLimit` does not count non-mock requests that carry a `providerKey`; mock keeps current limits (1000/hr mock, 10/hr otherwise).
5. **Wallet-bound task ownership** — a task can only be polled by the SIWE wallet that created it (details §4).

## 2. Architecture

```
Browser (create-panel → api.js generateAsset)
   │ POST /api/v1/generations {prompt, nodeId, provider:"tripo3d", providerKey}
   ▼
generate-node.js ── dispatch ──► tripo3d-adapter.createTask(prompt, key)
   │                                │ POST api.tripo3d.ai/v2/openapi/task
   │ ◄── tripoTaskId ──────────────┘
   │ generation-tasks.register(taskId → {tripoTaskId, providerKey, userAddress, createdAt})
   ▼
202 { taskId, provider:"tripo3d", status:"running" }
   │
   │ GET /api/v1/generations/:taskId   (Session auth, every ~3s)
   ▼
task-status route ──► registry lookup + wallet check ──► tripo3d-adapter.pollTask(...)
   │                                                       │ GET /task/{tripoTaskId}
   ├─ queued/running ─► { status, progress }
   ├─ success ─► adapter.downloadModel(output.pbr_model) ─► { status:"success", assetData(base64), format:"glb", path:"asset.glb", provider:"tripo3d" }
   └─ failed/cancelled ─► { status:"failed", error }
   │
   ▼ (frontend, on success — EXISTING flow, unchanged)
api.js: base64 decode → writeToIPFS → build/extend asset manifest → chat preview (GLB handler)
```

GLB output flows through the existing format-handler registry, chat preview, Studio load, and save/publish with **zero changes** to those subsystems.

## 3. Components

### 3.1 `src/api/adapters/tripo3d-adapter.js` (new)

Plain-`fetch` client for the v2 API. Three exported functions:

- `createTask(prompt, providerKey) → Promise<string>` (tripoTaskId)
  - `POST /v2/openapi/task` body: `{ type: "text_to_model", prompt, model_version: "v2.5-20250123", texture: true, pbr: true }`
  - Non-zero `code` → throw typed error carrying Tripo `code`/`message`.
- `pollTask(tripoTaskId, providerKey) → Promise<{ status, progress, glbUrl?, error? }>`
  - `GET /v2/openapi/task/{tripoTaskId}`; maps Tripo statuses; on `success` picks `output.pbr_model || output.model`.
- `downloadModel(glbUrl) → Promise<Buffer>`
  - Plain GET of the CDN URL (pre-signed, no auth header); validates non-empty body.

Never logs `providerKey`. Constants: `TRIPO_API_BASE = "https://api.tripo3d.ai/v2/openapi"`, `TRIPO_MODEL_VERSION = "v2.5-20250123"` (overridable via env `TRIPO_3D_MODEL` for ops flexibility — default stays v2.5).

### 3.2 `src/api/generation-tasks.js` (new)

In-memory registry, no persistence:

- `register({ tripoTaskId, providerKey, userAddress }) → taskId` (crypto-random UUID).
- `get(taskId) → entry | undefined`.
- `evict(taskId)`.
- TTL sweep: entries expire after 1 hour (interval-based sweep, unref'd timer so tests can exit).

### 3.3 `src/api/assets/generate-node.js` (modified)

Dispatch after validation:

- `mock` (or `MOCK_3D_GENERATION=true`) → existing synchronous mock path, unchanged.
- `tripo3d` → `createTask` → `register` (with `res.locals.userAddress`) → `202 { taskId, provider: "tripo3d", status: "running" }`.
- Any other provider → `501 NOT_IMPLEMENTED` (unchanged behavior).

BYOK gate (400 `MISSING_PROVIDER_KEY`) stays as-is. Tripo errors map to: invalid key → `401 { PROVIDER_AUTH_FAILED }`, `2010` insufficient credits → `402 { PROVIDER_CREDITS_EXHAUSTED }`, other → `502 { PROVIDER_ERROR }`.

### 3.4 `GET /api/v1/generations/:taskId` (new route, defined in `generate-node.js`)

Defined alongside the existing POST in `src/api/assets/generate-node.js` so the whole generation flow (dispatch, registry access, error mapping) stays in one file.

Middleware: `authenticate` only (session required; **no** generation rate limit — polling is cheap and local).

Flow:
1. Registry lookup; missing/expired → `404 { GENERATION_TASK_NOT_FOUND }`.
2. **Ownership check:** `entry.userAddress !== res.locals.userAddress` → same `404` (no existence leak).
3. `pollTask`:
   - `queued|running` → `200 { status, progress }`.
   - `success` → `downloadModel` → evict entry → `200 { status: "success", assetData: <base64>, format: "glb", path: "asset.glb", provider: "tripo3d" }`.
   - `failed|cancelled` → evict entry → `200 { status: "failed", error: { code: "PROVIDER_TASK_FAILED", message } }`.

### 3.5 `src/api/rate-limiter.js` (modified)

`generationRateLimit` skips (`next()`) when `req.body.provider` is set, `!== "mock"`, and `req.body.providerKey` is non-empty. Mock behavior unchanged.

### 3.6 Frontend: `frontend/src/js/services/api.js` (modified)

`generateAsset()`:
- POST as today. If response contains `taskId` → poll `GET /generations/:taskId` every 3 s (via `fetchWithSession`), overall timeout 10 min → throw `GENERATION_TIMEOUT`.
- Poll responses with `progress` invoke an optional `onProgress` callback so the pending chat bubble can show % (small additive change in `create-panel.js` / `pending-generations.js`; degrades gracefully if unused).
- On `status: "failed"` → throw with the provider message.
- On `success` → the payload is the same `{ assetData, format, path }` shape as today → existing decode → `writeToIPFS` → manifest flow runs unchanged.

### 3.7 Frontend: `frontend/src/js/ui/create-panel.js` (modified)

- Remove the "Cloud generation is not yet enabled. Switch to mock mode." 501 special-case; surface real backend errors (insufficient credits, auth failed, timeout) in the chat/status area.

## 4. Security

- **Wallet binding (SIWE):** the registry entry stores `res.locals.userAddress` (from the SIWE-issued session) at creation; every poll re-authenticates the session and compares addresses. Mismatch → `404`. The Tripo `task_id` never leaves the backend, so tasks cannot be queried on Tripo's side by third parties either.
- **BYOK hygiene (hard requirements, test-enforced):**
  1. **Storage:** `providerKey` exists only in (a) the incoming POST body and (b) the in-memory registry entry (RAM, ≤1 h TTL, evicted on any terminal state). It is never written to disk, database, session store, or `.env`. The registry module must not import `fs`/`path`/any persistence layer.
  2. **Logging:** the key is never logged in any form — the only permitted log line is the existing masked pattern `key=*** (len=N)`. The adapter must never log request/response bodies or headers (Tripo error payloads don't contain the key, but adapter-thrown errors must be constructed from Tripo's `code`/`message` only, never from raw request data). The global `console.error("[GEN] error:", err.message)` path is safe only if adapter error messages are sanitized — this is a code-review checkpoint.
  3. **Responses:** the key never appears in any API response body or header, including error responses.
  4. **Transport:** the key crosses the wire exactly once per generation (the POST body). Poll requests carry only the session token.
- **Verified clean today (audit 2026-07-21):** `generate-node.js` logs only `key=*** (len=N)`; `morgan` in `src/index.js` logs method/URL/status/client-IP/response-time only (no body, no auth headers); no route dumps `req.body`; `sessions.js` never touches `providerKey`.
- **No server-held key:** `TRIPO_3D_KEY` in `.env` is used only by developers for manual/integration testing; the server never reads it.
- Rate limiting: BYOK task creation is exempt (users spend their own credits); the status endpoint needs no generation limit. Session auth still applies to both.

## 5. Error handling matrix

| Condition | HTTP | Code |
|---|---|---|
| Non-mock provider, no key | 400 | `MISSING_PROVIDER_KEY` (existing) |
| Unknown provider | 501 | `NOT_IMPLEMENTED` (existing) |
| Tripo rejects key | 401 | `PROVIDER_AUTH_FAILED` |
| Tripo `2010` insufficient credits | 402 | `PROVIDER_CREDITS_EXHAUSTED` |
| Other Tripo create/poll failure | 502 | `PROVIDER_ERROR` |
| Unknown/expired taskId, or wallet mismatch | 404 | `GENERATION_TASK_NOT_FOUND` |
| Tripo task failed/cancelled | 200 | `{ status:"failed", error.code:"PROVIDER_TASK_FAILED" }` |
| Frontend poll timeout (10 min) | — | client-side `GENERATION_TIMEOUT` |

## 6. Testing

- **Jest — adapter unit tests** (`test/api/tripo3d-adapter.test.js`, mocked `fetch`): create/poll/download happy path, error-code mapping, `pbr_model` → `model` fallback, key never logged.
- **Jest — route tests** (extend `test/api.test.js`): `tripo3d` POST returns `202 { taskId }`; status endpoint queued/running/success/failed transitions; terminal-state eviction; **wallet-mismatch → 404**; unknown taskId → 404; BYOK rate-limit skip; update the existing assertions that expect 501 for non-mock providers.
- **Registry tests:** TTL expiry sweep; eviction on terminal states; assert the registry module has no persistence imports.
- **BYOK hygiene tests:** spy on `console.log`/`console.error` across the create/poll/error paths and assert the key string never appears in any logged output; assert no API response (success or error) contains the key; assert the registry entry is the only place the key is retained and that it is evicted on terminal state and TTL expiry.
- **Docs:** `docs/API_SPEC.md` (task-based contract), `docs/CURRENT_STATUS.md` (remove 501 gap entries), `src/api/openapi.json` (`202` response + new GET route), `.env.example` (document `TRIPO_3D_MODEL`, note `TRIPO_3D_KEY` is dev-test only), `AGENTS.md` (adapter + route rows, status counts).
- **Live verification:** ✅ done 2026-07-21 — full create → poll → download cycle passed with the `.env` key (20 credits, ~60 s, valid GLB). A second live pass through the real backend route is still required after implementation.
- **E2E:** run the Playwright suite (`--project=chromium`) per AGENTS.md, since generation UI/API is touched. Mock-mode E2E behavior is unchanged by design.

## 7. Explicitly out of scope (YAGNI)

- Image-to-3D, multiview, refine, texture, animation, format-conversion Tripo task types.
- Per-request model options (negative prompt, face limit, quality tiers) in the UI.
- Webhook/callback delivery from Tripo (polling only).
- Server-persisted task history (registry is memory-only; a backend restart orphans in-flight tasks, surfaced as `404` → clean client error).
- Server-side fallback API key.

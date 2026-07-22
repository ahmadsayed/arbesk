# Clear Chat + Tripo3D Refine Chain — Design

**Date:** 2026-07-22
**Status:** Approved (auto mode; user request)
**Scope:** Add a "Clear Chat" button to the AI Generation pane and chain consecutive Tripo3D generations via `texture_model` refinement.

## 1. Context

Follow-up to the Tripo3D BYOK integration (`2026-07-21-tripo3d-adapter-design.md`). The user asked for:

1. A **Clear Chat** button to start a new model.
2. If the chat has a previously generated model, the next generation should **use the previous task ID to refine** it.

### Verified API facts (live-tested 2026-07-22)

- **`refine_model` is unusable** — `{"code":2006,"message":"The original task type is not supported"}` for v2.5 tasks, v2.0 tasks, and v2.0 textureless drafts. Tested 3×. Do not use it.
- **`texture_model` works** on v2.5 tasks: `{type:"texture_model", original_model_task_id, text_prompt, texture:true, pbr:true}` → success in ~40s, 10 credits, output GLB at `output.model` (no `pbr_model`). **Texture/material changes only; geometry is unchanged.**
- Cost comparison: refine (texture_model) = 10 credits vs fresh generation (text_to_model v2.5) = 20 credits.

### Decisions (auto mode, no user prompts)

1. Refinement = `texture_model` with the user's new prompt as `text_prompt`. The UI/system chat message states the texture-only limitation.
2. Refinement is **automatic**: if the chat has a completed Tripo3D generation, the next Generate refines it. Clear Chat resets the chain. Mock provider never refines.
3. Completed tasks stay in the registry (status `complete`, TTL refreshed at completion, wallet-bound) so the Tripo task ID never reaches the browser.
4. Missing/expired refine source → `404 REFINE_SOURCE_NOT_FOUND`; frontend falls back to a fresh `text_to_model` transparently.

## 2. Architecture

```
Clear Chat (pane header button)
  └─ create-panel.clearChat()
      ├─ disposeAllChatPreviews()
      ├─ _resetPendingGenerations()
      ├─ assetMessages.clear()
      ├─ #chatHistoryList emptied, .chat-welcome re-shown
      └─ lastTripoTaskId = null

Refine chain (provider=tripo3d only)
  Generate #1  → POST /generations {prompt, provider, providerKey}
                 → 202 {taskId} → poll → success → lastTripoTaskId = taskId
  Generate #2  → POST /generations {prompt, provider, providerKey, refineTaskId}
                 → registry lookup (wallet-bound, status=complete)
                 → texture_model task → 202 {taskId} → poll → success
                 → lastTripoTaskId = new taskId (chain continues)
  Source gone  → 404 REFINE_SOURCE_NOT_FOUND → frontend retries without refineTaskId
```

## 3. Components

### 3.1 `src/api/generation-tasks.js` (modified)

- Entries gain `status: "running" | "complete"`.
- `getTask(taskId, userAddress)` — unchanged contract: returns only `"running"` entries (GET poll route behavior preserved).
- `markTaskComplete(taskId, userAddress)` — sets `status: "complete"` and refreshes `createdAt` (1h refine window from completion).
- `getCompletedTask(taskId, userAddress)` — returns entry only if `status === "complete"` (used by the refine path).

### 3.2 `src/api/adapters/tripo3d-adapter.js` (modified)

- New `createRefineTask(prompt, originalTripoTaskId, apiKey) → taskId` — POST `{type:"texture_model", original_model_task_id, texture_prompt: {text: prompt}, texture:true, pbr:true}`. (The prompt **must** be wrapped in `texture_prompt.text`; a flat `text_prompt` field is silently ignored by the v2 API — verified live 2026-07-22.)
- `pollTask` already falls back to `output.model` when `pbr_model` is absent (texture_model output) — no change needed.

### 3.3 `src/api/assets/generate-node.js` (modified)

- POST accepts optional `refineTaskId`:
  - Only honored when `provider === "tripo3d"`; ignored otherwise.
  - Lookup via `getCompletedTask(refineTaskId, res.locals.userAddress)`; missing/not-complete → `404 REFINE_SOURCE_NOT_FOUND`.
  - `createRefineTask(prompt, entry.tripoTaskId, key)` → register new task → `202 {taskId, provider:"tripo3d", status:"running", refined:true}`.
- GET poll route: on success calls `markTaskComplete` instead of `evictTask`; subsequent GETs of a completed task → `404 GENERATION_TASK_NOT_FOUND` (unchanged client-visible behavior).

### 3.4 `src/api/schemas.js` (modified)

- `generateAssetSchema` gains `refineTaskId: z.string().max(64).optional()`.

### 3.5 Frontend `frontend/src/js/services/api.js` (modified)

- `generateAsset()` accepts `refineTaskId`; includes it in the POST body when present; the returned result includes `taskId` (from the 202 response) so the caller can chain.

### 3.6 Frontend `frontend/src/js/ui/create-panel.js` (modified)

- Module-level `lastTripoTaskId`.
- On successful tripo3d generation: `lastTripoTaskId = result.taskId`; system chat note when a refine was used ("Refined previous model — texture/material only, geometry unchanged").
- On Generate with provider `tripo3d` + `lastTripoTaskId`: pass `refineTaskId`; on `ApiError` with code `REFINE_SOURCE_NOT_FOUND` → retry once without it.
- `clearChat()`: `disposeAllChatPreviews()` → `_resetPendingGenerations()` → `assetMessages.clear()` → empty `#chatHistoryList` and re-show `.chat-welcome` → `lastTripoTaskId = null` → system message "Chat cleared. Start a new model."

### 3.7 `frontend/src/pug/app.pug` (modified)

- Chat pane `.sidebar-view-header`: add `button#clearChatBtn.btn.btn-icon.btn-sm` (trash/clear SVG icon, `title="Clear chat — start new model"`), mirroring `.outliner-toolbar`.

### 3.8 E2E selectors (`e2e/helpers/studio-selectors.mjs`)

- Add `clearChatBtn: "#clearChatBtn"`.

## 4. Security

- Refine source lookup is wallet-bound (`getCompletedTask` compares SIWE session address); foreign/expired → 404.
- Tripo task IDs never reach the browser; only the public UUID `taskId` chains.
- BYOK key handling unchanged (RAM-only, TTL, never logged).
- Rate limit: refine is a BYOK request (has providerKey) → skipped, consistent with generation.

## 5. Error handling

| Condition | HTTP | Code |
|---|---|---|
| refineTaskId unknown / not complete / wrong wallet | 404 | `REFINE_SOURCE_NOT_FOUND` |
| Tripo rejects refine (credits, auth) | 401/402 | existing `PROVIDER_*` codes |
| Refine task fails at Tripo | 200 | `{status:"failed", error.code:"PROVIDER_TASK_FAILED"}` |
| Frontend: REFINE_SOURCE_NOT_FOUND | — | retry once without refineTaskId |

## 6. Testing

- Registry: `markTaskComplete` + `getCompletedTask` + running/complete separation + TTL refresh.
- Adapter: `createRefineTask` body (`texture_model`, `text_prompt`, original id) — mocked fetch.
- Route: refine happy path (202 `refined:true`), unknown refineTaskId → 404 `REFINE_SOURCE_NOT_FOUND`, refine source owned by other wallet → 404, GET after completion → 404, mock provider ignores refineTaskId.
- Frontend: `generateAsset` sends refineTaskId and returns taskId; fallback retry on REFINE_SOURCE_NOT_FOUND; `clearChat` DOM/state reset (jsdom); `lastTripoTaskId` chaining in create-panel (unit).
- Docs: `API_SPEC.md`, `openapi.json`, `AGENTS.md`, e2e selectors.
- Live verification: two chained generations with the `.env` key.
- E2E: full suite (generation UI touched).

## 7. Out of scope (YAGNI)

- `refine_model` endpoint (dead upstream).
- Geometry-level prompt editing (not supported by Tripo v2).
- Image-to-3D, stylize, rig/animation, mesh segmentation/completion.
- Persisting the refine chain across page reloads (chat is in-memory by design).
- A manual "Refine" button per bubble (automatic chain per user request).

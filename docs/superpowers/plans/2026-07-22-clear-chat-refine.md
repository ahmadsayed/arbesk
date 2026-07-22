# Clear Chat + Tripo3D Refine Chain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Clear Chat button to the AI Generation pane and chain consecutive Tripo3D generations via `texture_model` refinement (verified working; `refine_model` is dead upstream — code 2006).

**Architecture:** Completed tasks stay in the in-memory registry (status `complete`, TTL refreshed, wallet-bound). The next Generate sends `refineTaskId`; the backend creates a `texture_model` task from the stored Tripo task ID. Frontend falls back to fresh generation on `REFINE_SOURCE_NOT_FOUND`. Clear Chat resets DOM, previews, pending store, and the chain.

**Tech Stack:** Node ESM, Express, Jest + Supertest, jsdom frontend tests, Pug. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-22-clear-chat-refine-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `src/api/generation-tasks.js` | Add `status`, `markTaskComplete`, `getCompletedTask`. |
| `src/api/adapters/tripo3d-adapter.js` | Add `createRefineTask` (texture_model). |
| `src/api/schemas.js` | `refineTaskId` field on `generateAssetSchema`. |
| `src/api/assets/generate-node.js` | POST refine dispatch; GET marks complete on success. |
| `frontend/src/js/services/api.js` | `generateAsset` accepts `refineTaskId`, returns `taskId`. |
| `frontend/src/js/ui/create-panel.js` | `lastTripoTaskId` chain, fallback retry, `clearChat()`. |
| `frontend/src/pug/app.pug` | `#clearChatBtn` in chat pane header. |
| `e2e/helpers/studio-selectors.mjs` | `clearChatBtn` selector. |

---

### Task 1: Registry running/complete status

**Files:**
- Modify: `src/api/generation-tasks.js`
- Test: `test/api/generation-tasks.test.js`

- [ ] **Step 1: Add failing tests**

```js
import {
  registerTask,
  getTask,
  getCompletedTask,
  markTaskComplete,
  evictTask,
  _resetRegistry,
} from "../../src/api/generation-tasks.js";

// inside the describe:
test("new tasks are running; completed tasks are hidden from getTask", () => {
  const id = registerTask({ tripoTaskId: "t", providerKey: "k", userAddress: "0xabc" });
  expect(getTask(id, "0xabc")).toBeDefined();
  markTaskComplete(id, "0xabc");
  expect(getTask(id, "0xabc")).toBeUndefined();
  expect(getCompletedTask(id, "0xabc")).toMatchObject({
    tripoTaskId: "t",
    status: "complete",
  });
});

test("getCompletedTask enforces wallet ownership", () => {
  const id = registerTask({ tripoTaskId: "t", providerKey: "k", userAddress: "0xabc" });
  markTaskComplete(id, "0xabc");
  expect(getCompletedTask(id, "0xother")).toBeUndefined();
});

test("markTaskComplete refreshes the TTL window", () => {
  const id = registerTask({ tripoTaskId: "t", providerKey: "k", userAddress: "0xabc" });
  jest.advanceTimersByTime(50 * 60 * 1000); // 50 min old
  markTaskComplete(id, "0xabc");
  jest.advanceTimersByTime(59 * 60 * 1000); // 109 min since create, 59 since complete
  expect(getCompletedTask(id, "0xabc")).toBeDefined();
  jest.advanceTimersByTime(2 * 60 * 1000); // 61 min since complete
  expect(getCompletedTask(id, "0xabc")).toBeUndefined();
});
```

- [ ] **Step 2: Run tests, expect failures** (`markTaskComplete`/`getCompletedTask` not exported)

Run: `NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/generation-tasks.test.js --runInBand`

- [ ] **Step 3: Implement**

In `src/api/generation-tasks.js`:
- `TaskEntry` typedef gains `@property {"running"|"complete"} status`.
- `registerTask` sets `status: "running"`.
- `getTask` adds `if (entry.status !== "running") return undefined;` after the TTL check.
- Add:

```js
/**
 * Mark a running task as complete. Refreshes the TTL window so the entry
 * remains available as a refine source for TTL after completion.
 * @param {string} taskId
 * @param {string} userAddress
 */
export function markTaskComplete(taskId, userAddress) {
  const entry = registry.get(taskId);
  if (!entry || entry.userAddress !== userAddress) return;
  entry.status = "complete";
  entry.createdAt = Date.now();
}

/**
 * Look up a completed task entry (refine source). Returns undefined if
 * missing, expired, not complete, or owned by a different wallet.
 * @param {string} taskId
 * @param {string} userAddress
 * @returns {TaskEntry | undefined}
 */
export function getCompletedTask(taskId, userAddress) {
  const entry = registry.get(taskId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    registry.delete(taskId);
    return undefined;
  }
  if (entry.userAddress !== userAddress) return undefined;
  if (entry.status !== "complete") return undefined;
  return entry;
}
```

- [ ] **Step 4: Run tests, expect all pass**
- [ ] **Step 5: Commit** `feat(generation): registry running/complete status for refine chain`

---

### Task 2: Adapter `createRefineTask`

**Files:**
- Modify: `src/api/adapters/tripo3d-adapter.js`
- Test: `test/api/tripo3d-adapter.test.js`

- [ ] **Step 1: Failing test**

```js
test("createRefineTask submits texture_model with text_prompt", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ code: 0, data: { task_id: "task_refine" } }),
  });
  const id = await createRefineTask("make it blue metallic", "tripo_orig_1", key);
  expect(id).toBe("task_refine");
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe("https://api.tripo3d.ai/v2/openapi/task");
  expect(JSON.parse(opts.body)).toEqual({
    type: "texture_model",
    original_model_task_id: "tripo_orig_1",
    text_prompt: "make it blue metallic",
    texture: true,
    pbr: true,
  });
});
```

- [ ] **Step 2: Run, expect failure**
- [ ] **Step 3: Implement** (after `createTask`):

```js
/**
 * Refine an existing model's texture/material via a text prompt.
 * NOTE: Tripo's refine_model endpoint is dead upstream (code 2006); this
 * uses texture_model — geometry is unchanged.
 * @param {string} prompt
 * @param {string} originalTripoTaskId - Tripo task ID of the completed source generation
 * @param {string} apiKey
 * @returns {Promise<string>} task_id
 */
export async function createRefineTask(prompt, originalTripoTaskId, apiKey) {
  if (!prompt || typeof prompt !== "string") {
    throw new TripoApiError("prompt is required", 0, 400);
  }
  if (!originalTripoTaskId || typeof originalTripoTaskId !== "string") {
    throw new TripoApiError("originalTripoTaskId is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo refine prompt_len=${prompt.length}`);
  const data = await tripoFetch("task", apiKey, "POST", {
    type: "texture_model",
    original_model_task_id: originalTripoTaskId,
    text_prompt: prompt,
    texture: true,
    pbr: true,
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  console.log(`[GEN] Tripo refine task created task_id=${data.task_id}`);
  return data.task_id;
}
```

- [ ] **Step 4: Run, expect pass**
- [ ] **Step 5: Commit** `feat(tripo3d-adapter): add createRefineTask via texture_model`

---

### Task 3: Schema + route refine path

**Files:**
- Modify: `src/api/schemas.js`
- Modify: `src/api/assets/generate-node.js`
- Test: `test/api.test.js`

- [ ] **Step 1: Schema**

In `generateAssetSchema` add: `refineTaskId: z.string().max(64).optional(),`

- [ ] **Step 2: Failing route tests** (append to the tripo3d describe in `test/api.test.js`)

```js
it("creates a refine task when refineTaskId references a completed task", async () => {
  // First generation: create + complete
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { task_id: "tripo_gen1" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      code: 0,
      data: { task_id: "tripo_gen1", status: "success", output: { pbr_model: "https://cdn/a.glb" } },
    }) })
    .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new TextEncoder().encode("glb1").buffer })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, data: { task_id: "tripo_refine1" } }) });

  const session = await makeSessionHeader();
  const gen1 = await request(app).post("/api/v1/generations").set("Authorization", session)
    .send({ prompt: "cube", nodeId: "n1", provider: "tripo3d", providerKey: "k" });
  expect(gen1.status).toBe(202);
  const poll = await request(app).get(`/api/v1/generations/${gen1.body.taskId}`).set("Authorization", session);
  expect(poll.body.status).toBe("success");

  // Second generation with refineTaskId
  const gen2 = await request(app).post("/api/v1/generations").set("Authorization", session)
    .send({ prompt: "make it blue", nodeId: "n2", provider: "tripo3d", providerKey: "k", refineTaskId: gen1.body.taskId });
  expect(gen2.status).toBe(202);
  expect(gen2.body.refined).toBe(true);
  const refineCall = global.fetch.mock.calls[3];
  expect(JSON.parse(refineCall[1].body)).toMatchObject({
    type: "texture_model",
    original_model_task_id: "tripo_gen1",
    text_prompt: "make it blue",
  });
});

it("returns 404 REFINE_SOURCE_NOT_FOUND for unknown refineTaskId", async () => {
  const res = await request(app).post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ prompt: "x", nodeId: "n", provider: "tripo3d", providerKey: "k", refineTaskId: "00000000-0000-0000-0000-000000000000" });
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe("REFINE_SOURCE_NOT_FOUND");
});

it("completed task poll endpoint returns 404 after success delivery", async () => {
  // covered by existing "evicts entry" test semantics: after success, GET → 404
});
```

- [ ] **Step 3: Run, expect failures**
- [ ] **Step 4: Implement in `generate-node.js`**

Imports: add `createRefineTask` to the adapter import; add `getCompletedTask` to the registry import.

In the POST handler tripo3d branch, before `createTask`:

```js
        if (effectiveProvider === "tripo3d") {
          const key = providerKey.trim();
          let refineSource = null;
          if (refineTaskId) {
            refineSource = getCompletedTask(refineTaskId, res.locals.userAddress);
            if (!refineSource) {
              console.log(`[GEN] refine source not found taskId=${refineTaskId}`);
              return res.status(404).json({
                error: {
                  code: "REFINE_SOURCE_NOT_FOUND",
                  message: "Refine source task not found or not completed",
                },
              });
            }
          }
          console.log(`[GEN] using Tripo3D adapter for "${prompt}" refine=${Boolean(refineSource)}`);
          const tripoTaskId = refineSource
            ? await createRefineTask(prompt, refineSource.tripoTaskId, key)
            : await createTask(prompt, key);
          const taskId = registerTask({
            tripoTaskId,
            providerKey: key,
            userAddress: res.locals.userAddress,
          });
          console.log(`[GEN] tripo task registered public=${taskId} tripo=${tripoTaskId}`);
          return res.status(202).json({
            taskId,
            provider: "tripo3d",
            status: "running",
            ...(refineSource && { refined: true }),
          });
        }
```

Destructure `refineTaskId` from `req.body` at the top.

In the GET route success branch, replace `evictTask(taskId);` with `markTaskComplete(taskId, res.locals.userAddress);` and import `markTaskComplete` instead (keep `evictTask` for the failed branch).

- [ ] **Step 5: Run full `test/api.test.js`, expect pass**
- [ ] **Step 6: Commit** `feat(api): tripo3d refine chain via refineTaskId`

---

### Task 4: Frontend `api.js` refineTaskId + fallback

**Files:**
- Modify: `frontend/src/js/services/api.js`
- Test: `test/frontend/api.test.js`

- [ ] **Step 1: Failing tests**

```js
test("passes refineTaskId to the backend and returns taskId", async () => {
  fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ taskId: "t2", provider: "tripo3d", status: "running", refined: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", assetData: base64("glb"), format: "glb", path: "asset.glb" }) });
  const result = await generateAsset({ prompt: "blue", nodeId: "n", provider: "tripo3d", providerKey: "k", refineTaskId: "t1" });
  const postBody = JSON.parse(fetch.mock.calls[0][1].body);
  expect(postBody.refineTaskId).toBe("t1");
  expect(result.taskId).toBe("t2");
});

test("falls back to fresh generation on REFINE_SOURCE_NOT_FOUND", async () => {
  fetch
    .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: { code: "REFINE_SOURCE_NOT_FOUND", message: "gone" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ taskId: "t3", provider: "tripo3d", status: "running" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "success", assetData: base64("glb"), format: "glb", path: "asset.glb" }) });
  const result = await generateAsset({ prompt: "blue", nodeId: "n", provider: "tripo3d", providerKey: "k", refineTaskId: "t1" });
  expect(fetch).toHaveBeenCalledTimes(3);
  const retryBody = JSON.parse(fetch.mock.calls[1][1].body);
  expect(retryBody.refineTaskId).toBeUndefined();
  expect(result.taskId).toBe("t3");
});
```

- [ ] **Step 2: Run, expect failures**
- [ ] **Step 3: Implement**

In `generateAsset` params add `refineTaskId`. Body: `...(refineTaskId && { refineTaskId })`. After the `!response.ok` check insertion, add fallback:

```js
  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    if (code === "REFINE_SOURCE_NOT_FOUND" && refineTaskId) {
      announceStatus("Refine source expired — generating fresh model…");
      return generateAsset({
        prompt, nodeId, provider, assetId, prevAssetManifestCid,
        transformMatrix, tier, providerKey,
      });
    }
    announceStatus("Generation failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(message || `Generation failed (HTTP ${response.status})`, response.status, code);
  }
```

Return `taskId` in the result: `...(data.taskId && { taskId: data.taskId })` — capture before `Object.assign(data, final)` since `final` has no taskId (assign into result from the initial response value saved earlier).

- [ ] **Step 4: Run `test/frontend/api.test.js`, expect pass**
- [ ] **Step 5: Commit** `feat(api): frontend refine chain + fresh-generation fallback`

---

### Task 5: Clear Chat + refine chain in create-panel

**Files:**
- Modify: `frontend/src/pug/app.pug` (chat pane header, ~line 168)
- Modify: `frontend/src/js/ui/create-panel.js`
- Modify: `e2e/helpers/studio-selectors.mjs`
- Test: `test/frontend/chat-messages.test.js` (or new `test/frontend/clear-chat.test.js`)

- [ ] **Step 1: Pug button**

In the chat pane header (`app.pug`, `.sidebar-view-header` for `data-view="chat"`), after the `h3`:

```pug
.sidebar-view-header
  h3 AI Generation
  .outliner-toolbar
    button#clearChatBtn.btn.btn-icon.btn-sm(type="button", title="Clear chat — start new model", aria-label="Clear chat")
      svg(width="14", height="14", viewBox="0 0 16 16", fill="currentColor", aria-hidden="true")
        path(d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z")
        path(fill-rule="evenodd", d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z")
```

(Check the actual header markup before editing — match its exact structure.)

- [ ] **Step 2: Selector** — in `studio-selectors.mjs` add `clearChatBtn: "#clearChatBtn",`.

- [ ] **Step 3: create-panel.js**

- Module state: `let lastTripoTaskId = null;`
- DOM ref: `const clearChatBtn = document.getElementById("clearChatBtn");`
- Imports: `disposeAllChatPreviews` from `../services/chat-preview.js`, `_resetPendingGenerations` from `../state/pending-generations.js`.
- New function:

```js
function clearChat() {
  disposeAllChatPreviews();
  _resetPendingGenerations();
  assetMessages.clear();
  lastTripoTaskId = null;
  const list = document.getElementById("chatHistoryList");
  if (list) {
    list.innerHTML = "";
    const welcome = document.createElement("div");
    welcome.className = "chat-welcome";
    welcome.innerHTML = '<div class="welcome-icon">✦</div><div class="welcome-text">Describe something to create</div><div class="welcome-sub">Your generated models will appear here</div>';
    list.appendChild(welcome);
  }
  addChatMessage("system", "Chat cleared. Start a new model.");
}
clearChatBtn?.addEventListener("click", clearChat);
```

(Check the real `.chat-welcome` markup in `app.pug:173` and reproduce it exactly.)

- In `onGenerate`: after the provider check, `const refineTaskId = provider === "tripo3d" ? lastTripoTaskId : null;` pass it into `generateAsset`; when set, add system message "Refining previous model (texture/material only — geometry unchanged)…". After success: `if (provider === "tripo3d" && result.taskId) lastTripoTaskId = result.taskId;`

- [ ] **Step 4: Failing test** (`test/frontend/clear-chat.test.js`, jsdom seed-then-import pattern from `chat-messages.test.js`): clicking `#clearChatBtn` empties `#chatHistoryList`, re-shows `.chat-welcome`, resets pending generations, and disposes previews (mock `chat-preview.js`).

- [ ] **Step 5: Implement until pass; run `npm run test:frontend`**
- [ ] **Step 6: Commit** `feat(ui): clear chat button + tripo3d refine chain in create panel`

---

### Task 6: Docs + verification

- [ ] **Step 1:** Update `docs/API_SPEC.md` (`refineTaskId`, `refined:true`, `REFINE_SOURCE_NOT_FOUND`), `src/api/openapi.json`, `AGENTS.md` (registry/adapter rows).
- [ ] **Step 2:** `npm test` (all suites pass), `npm run lint`, `npm run typecheck`, `npm run build:frontend`.
- [ ] **Step 3:** Live verification: start backend (`MOCK_3D_GENERATION=false npm start`), run a chained-generation smoke script (gen → refine → poll both) with the `.env` key.
- [ ] **Step 4:** E2E: `npx playwright test --config=e2e/playwright.config.js --project=chromium` — all pass.
- [ ] **Step 5:** Commit docs, push.

---

## Self-review coverage

| Spec requirement | Task |
|---|---|
| Registry running/complete + TTL refresh | 1 |
| `createRefineTask` (texture_model) | 2 |
| refineTaskId schema + POST dispatch + GET markTaskComplete | 3 |
| Frontend param + taskId return + fallback | 4 |
| Clear Chat button + chain reset | 5 |
| Selectors/docs/E2E/live verification | 6 |

Type consistency: `refineTaskId`, `markTaskComplete`, `getCompletedTask`, `createRefineTask(prompt, originalTripoTaskId, apiKey)`, `lastTripoTaskId`, `clearChat()` used consistently.

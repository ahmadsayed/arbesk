# Asset Chat Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist AI chat prompts into asset manifest versions (`metadata.chat`, version-scoped, save-anchored) and render them as a read-only history view when an asset is opened; remove the dormant `node.history[]` spec.

**Architecture:** Each manifest version records only the prompts consumed since the previous version; the `prev_asset_manifest_cid` chain walk reconstructs the full conversation. The browser collects prompts from sent pending-generation records at manifest build time — no new backend infrastructure beyond surfacing the provider task ID. Read path: client-side chain walk rendered as muted chat bubbles in the Create panel.

**Tech Stack:** Node/Express backend (ESM), browser frontend (ESM, no bundler), Zod schemas, Jest (jsdom for frontend tests), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-08-02-asset-chat-provenance-design.md`

**Key facts an implementer must know:**
- The refine chain (`refineTaskId`) looks up the **backend registry** task ID via `getCompletedTask` — the registry `taskId` returned by `generateAsset()` must NOT be replaced; `providerTaskId` is an additional field. Only `providerTaskId` is persisted.
- `pending-generations.js` records already carry `prompt`; the store spreads `...data`, so new fields need only typedef docs (plus a contract test).
- `walkManifestChain` (`engine/time-travel.ts`) has a per-session `chainCache` keyed by start CID — tests must use distinct CIDs.
- Root Jest runs ESM (`@jest/globals`, `jest.unstable_mockModule` + dynamic import after `jest.resetModules()`).
- `manifest-builder.test.js`: the 3MF test must stay LAST in its describe (its scene-graph mock leaks) — insert new tests before it.
- CDN/Pug/SCSS: frontend changes require `npm run build:frontend` before E2E.

---

### Task 1: Manifest schema — add `metadata.chat`, remove `historyEntrySchema`

**Files:**
- Modify: `src/api/schemas.ts:115-176`
- Test: `test/api/validation.test.js` (append a new describe block at end of file)

- [ ] **Step 1: Write the failing tests**

Append to `test/api/validation.test.js` (the file already imports `validateManifest` from `../../src/api/schemas.ts`):

```js
describe("manifest metadata.chat provenance", () => {
  const baseManifest = {
    version: 1,
    type: "asset",
    scene: { nodes: [] },
  };

  it("accepts a manifest with valid metadata.chat entries", () => {
    const result = validateManifest({
      ...baseManifest,
      metadata: {
        chat: [
          { prompt: "a cabin", provider: "mock", task: "model", timestamp: 1780000100 },
          {
            prompt: "mossy texture",
            provider: "tripo3d",
            task: "texture",
            taskId: "tripo-task-1",
            timestamp: 1780000200,
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a manifest without metadata", () => {
    expect(validateManifest(baseManifest).valid).toBe(true);
  });

  it("rejects chat entries missing required fields", () => {
    const result = validateManifest({
      ...baseManifest,
      metadata: { chat: [{ provider: "mock", task: "model", timestamp: 1 }] },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects chat entries with an empty prompt", () => {
    const result = validateManifest({
      ...baseManifest,
      metadata: { chat: [{ prompt: "", provider: "mock", task: "model", timestamp: 1 }] },
    });
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/api/validation.test.js`
Expected: FAIL — `metadata.chat` entries are not validated against the new schema (the "rejects" tests fail because unknown keys pass through today).

- [ ] **Step 3: Implement the schema change**

In `src/api/schemas.ts`:

a. Delete the `historyEntrySchema` block (lines 123-136):

```js
const historyEntrySchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  node_id: z.string().optional(),
  operation: z.string(),
  params: z.record(z.unknown()).optional(),
  // Per-version source snapshot (see manifest-chain-walker.ts): the glTF CID
  // is required, the UnixFS bundle directory CID is optional metadata.
  src: z
    .object({
      cid: z.string().min(1),
      bundleCid: z.string().min(1).optional(),
    })
    .optional(),
});
```

b. Insert after `thumbnailSchema` (ends line 121):

```js
const chatProvenanceEntrySchema = z.object({
  prompt: z.string().min(1),
  provider: z.string().min(1),
  task: z.string().min(1),
  taskId: z.string().min(1).optional(),
  timestamp: z.number(),
});
```

c. In `nodeSchema` (lines 152-158) delete this line:

```js
  history: z.array(historyEntrySchema).optional(),
```

d. In `manifestSchema` (lines 160-176) add after the `comments_archive_cid` line:

```js
  metadata: z
    .object({
      chat: z.array(chatProvenanceEntrySchema).optional(),
    })
    .optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/api/validation.test.js`
Expected: PASS (all tests, including pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.ts test/api/validation.test.js
git commit -m "feat: add metadata.chat provenance schema, drop dormant node.history schema"
```

---

### Task 2: Backend poll-success response surfaces `providerTaskId`

**Files:**
- Modify: `src/api/assets/generate-node.ts:246-252`

Note: no existing backend test covers the Tripo poll route (it requires a live BYOK provider); the response contract is pinned consumer-side by the Task 3 frontend test. This change is additive and cannot alter existing route behavior.

- [ ] **Step 1: Add `providerTaskId` to the poll-success payload**

Replace (lines 246-252):

```js
        return res.json({
          status: "success",
          assetData: buffer.toString("base64"),
          format: "glb",
          path: "asset.glb",
          provider: "tripo3d",
        });
```

with:

```js
        return res.json({
          status: "success",
          assetData: buffer.toString("base64"),
          format: "glb",
          path: "asset.glb",
          provider: "tripo3d",
          providerTaskId: entry.tripoTaskId,
        });
```

- [ ] **Step 2: Run the backend suites**

Run: `npx jest test/api.test.js test/api/`
Expected: PASS (no regressions)

- [ ] **Step 3: Commit**

```bash
git add src/api/assets/generate-node.ts
git commit -m "feat: surface provider task id in Tripo3D poll success payload"
```

---

### Task 3: `generateAsset()` returns `providerTaskId` alongside registry `taskId`

**Files:**
- Modify: `frontend/src/js/services/api.ts:455,603-610`
- Test: `test/frontend/api.test.js` (add a test after the "polls a Tripo3D task until success" test, ~line 773)

- [ ] **Step 1: Write the failing test**

In `test/frontend/api.test.js`, add after the existing Tripo polling success test:

```js
  test("returns providerTaskId from the Tripo3D poll success payload", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          status: 202,
          body: { taskId: "task-abc-123", provider: "tripo3d", status: "running" },
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          body: {
            status: "success",
            assetData: Buffer.from("glb-bytes").toString("base64"),
            format: "glb",
            path: "asset.glb",
            provider: "tripo3d",
            providerTaskId: "tripo-task-xyz",
          },
        })
      );
    const { generateAsset } = await loadApi({ fetchMock });
    localStorage.setItem(
      "arbesk_session",
      makeSession(TEST_TOKEN, Date.now() + 60_000, TEST_ADDRESS)
    );

    const result = await generateAsset({
      prompt: "a robot",
      nodeId: "robot-node",
      provider: "tripo3d",
      providerKey: "tripo-key",
    });

    // Registry taskId unchanged (refine chain depends on it); providerTaskId is new.
    expect(result.taskId).toBe("task-abc-123");
    expect(result.providerTaskId).toBe("tripo-task-xyz");
  }, 15_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/api.test.js -t providerTaskId`
Expected: FAIL — `result.providerTaskId` is `undefined`.

- [ ] **Step 3: Implement**

In `frontend/src/js/services/api.ts`:

a. Update the `@returns` JSDoc (line 455) to:

```js
 * @returns {Promise<{assetManifestCid: string, sourceAssetCid: string, format: string, path: string, tier?: number, taskId?: string, providerTaskId?: string}>}
```

b. In the return object (lines 603-610), add one line after the `taskId` spread:

```js
  return {
    assetManifestCid,
    sourceAssetCid,
    format: data.format,
    path: data.path || `asset.${data.format}`,
    ...(tier !== undefined && tier !== null && { tier: Number(tier) }),
    ...(data.taskId && { taskId: data.taskId }),
    ...(data.providerTaskId && { providerTaskId: data.providerTaskId }),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/api.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/api.ts test/frontend/api.test.js
git commit -m "feat: return providerTaskId from generateAsset"
```

---

### Task 4: Pending-generation record documents provenance fields

**Files:**
- Modify: `frontend/src/js/state/pending-generations.ts:12-23`
- Test: `test/frontend/pending-generations.test.js` (append)

The store already spreads `...data`, so this is a typedef + contract test change only.

- [ ] **Step 1: Write the contract test**

Append to `test/frontend/pending-generations.test.js`:

```js
test("provenance fields round-trip through add/update", () => {
  const id = addPendingGeneration({
    assetManifestCid: "cid",
    sourceAssetCid: "src",
    prompt: "a cabin",
    prevAssetManifestCid: null,
    provider: "tripo3d",
    task: "model",
    taskId: "tripo-task-1",
  });
  const rec = getPendingGeneration(id);
  expect(rec.provider).toBe("tripo3d");
  expect(rec.task).toBe("model");
  expect(rec.taskId).toBe("tripo-task-1");
  expect(rec.recorded).toBeUndefined();
  updatePendingGeneration(id, { recorded: true });
  expect(getPendingGeneration(id).recorded).toBe(true);
});
```

- [ ] **Step 2: Update the typedef**

In `frontend/src/js/state/pending-generations.ts`, extend the `PendingGeneration` typedef (lines 12-23) with:

```js
 * @property {string} [provider] - generation provider ("mock", "tripo3d")
 * @property {string} [task] - AI task kind ("model", "texture")
 * @property {string} [taskId] - provider-side task id (e.g. Tripo); chat provenance only
 * @property {boolean} [recorded] - true once written into a saved manifest version
```

- [ ] **Step 3: Run tests**

Run: `npx jest test/frontend/pending-generations.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/state/pending-generations.ts test/frontend/pending-generations.test.js
git commit -m "feat: provenance fields on pending-generation records"
```

---

### Task 5: `create-panel.js` passes provenance fields into the pending record

**Files:**
- Modify: `frontend/src/js/ui/create-panel.ts:461-470`

Covered end-to-end by the Task 13 E2E (no unit harness exists for create-panel).

- [ ] **Step 1: Pass the fields through**

Replace the `addPendingGeneration({...})` call (lines 461-470):

```js
    const generationId = addPendingGeneration({
      assetManifestCid: result.assetManifestCid,
      sourceAssetCid: result.sourceAssetCid,
      prompt,
      format: result.format,
      path: result.path,
      prevAssetManifestCid: prevAssetManifestCid || null,
      transformMatrix,
      ...(result.tier !== undefined && { tier: result.tier }),
    });
```

with:

```js
    const generationId = addPendingGeneration({
      assetManifestCid: result.assetManifestCid,
      sourceAssetCid: result.sourceAssetCid,
      prompt,
      format: result.format,
      path: result.path,
      prevAssetManifestCid: prevAssetManifestCid || null,
      transformMatrix,
      provider,
      task: refineTaskId ? "texture" : "model",
      ...(result.providerTaskId && { taskId: result.providerTaskId }),
      ...(result.tier !== undefined && { tier: result.tier }),
    });
```

(`provider` and `refineTaskId` are already in scope in `onGenerate` — see lines 447 and 452.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:frontend`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/ui/create-panel.ts
git commit -m "feat: record provider/task/taskId on pending generations"
```

---

### Task 6: Manifest builder writes version-scoped `metadata.chat`

**Files:**
- Modify: `frontend/src/js/services/asset-save/manifest-builder.ts` (imports at top; new helper above `prepareManifestForWrite`; injection before the return at lines 565-569)
- Test: `test/frontend/manifest-builder.test.js` (insert two tests inside `describe("prepareManifestForWrite")`, BEFORE the 3MF test which must stay last)

Trade-off note: records are marked `recorded` at collection time (inside `prepareManifestForWrite`). If the subsequent IPFS write fails, that prompt is not re-recorded — same loss semantics as any unsaved state. Accepted per spec.

- [ ] **Step 1: Write the failing tests**

In `test/frontend/manifest-builder.test.js`, inside `describe("prepareManifestForWrite")`, insert BEFORE the `keeps color edits as overlays for stored-form 3MF nodes` test (that test has a "keep this test LAST" comment):

```js
  it("records sent pending generations as version-scoped metadata.chat", async () => {
    const pg = await import(
      "../../frontend/src/js/state/pending-generations.ts"
    );
    pg._resetPendingGenerations();
    const sentId = pg.addPendingGeneration({
      assetManifestCid: "cid-gen",
      sourceAssetCid: "src-gen",
      prompt: "a low-poly cabin",
      prevAssetManifestCid: null,
      provider: "mock",
      task: "model",
    });
    pg.updatePendingGeneration(sentId, { status: "sent" });
    // Stays "pending" — must NOT be recorded.
    pg.addPendingGeneration({
      assetManifestCid: "cid-draft",
      sourceAssetCid: "src-draft",
      prompt: "discarded draft",
      prevAssetManifestCid: null,
      provider: "mock",
      task: "model",
    });

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    // Stale entries from the previous version must be dropped (version-scoped).
    manifest.metadata = {
      chat: [{ prompt: "old version prompt", provider: "mock", task: "model", timestamp: 1 }],
    };
    assetState.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("Chat Asset");

    expect(result.manifest.metadata.chat).toHaveLength(1);
    const entry = result.manifest.metadata.chat[0];
    expect(entry.prompt).toBe("a low-poly cabin");
    expect(entry.provider).toBe("mock");
    expect(entry.task).toBe("model");
    expect(entry.taskId).toBeUndefined();
    expect(typeof entry.timestamp).toBe("number");
    expect(pg.getPendingGeneration(sentId).recorded).toBe(true);
  });

  it("omits metadata when no prompts were consumed", async () => {
    const pg = await import(
      "../../frontend/src/js/state/pending-generations.ts"
    );
    pg._resetPendingGenerations();

    const manifest = makeManifest([
      makeNode({ cid: "bafyCached", path: "composite.gltf", format: "gltf" }),
    ]);
    manifest.metadata = {
      chat: [{ prompt: "old", provider: "mock", task: "model", timestamp: 1 }],
    };
    assetState.set({
      activeAssetManifestCid: "bafyManifest",
      currentManifest: { ...manifest, _manifestCid: "bafyManifest" },
    });

    const result = await ctx.mod.prepareManifestForWrite("No Chat Asset");

    expect(result.manifest.metadata).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/frontend/manifest-builder.test.js -t metadata`
Expected: FAIL — `result.manifest.metadata.chat` is undefined / stale metadata not cleared.

- [ ] **Step 3: Implement**

In `frontend/src/js/services/asset-save/manifest-builder.ts`:

a. Add the import alongside the existing state imports at the top of the file:

```js
import {
  listPendingGenerations,
  updatePendingGeneration,
} from "../../state/pending-generations.js";
```

b. Add the helper above `prepareManifestForWrite`:

```js
/**
 * Collect chat provenance entries from pending-generation records sent to the
 * Studio since the last saved version, and mark them recorded so each prompt
 * lands in exactly one manifest version.
 * @returns {Array<{prompt: string, provider: string, task: string, taskId?: string, timestamp: number}>}
 */
function collectChatProvenanceEntries() {
  const entries = [];
  const nowSec = Math.floor(Date.now() / 1000);
  for (const record of listPendingGenerations()) {
    if (record.status !== "sent" || record.recorded) continue;
    entries.push({
      prompt: record.prompt,
      provider: record.provider || "mock",
      task: record.task || "model",
      ...(record.taskId && { taskId: record.taskId }),
      timestamp: nowSec,
    });
    updatePendingGeneration(record.id, { recorded: true });
  }
  return entries;
}
```

c. In `prepareManifestForWrite`, insert between the version-advance block (lines 558-563) and the `return` (line 565):

```js
  // Chat provenance is version-scoped: drop entries carried over from the
  // previous version, then record prompts consumed since that version.
  if (manifest.metadata) delete manifest.metadata.chat;
  const chatEntries = collectChatProvenanceEntries();
  if (chatEntries.length > 0) {
    manifest.metadata = { ...(manifest.metadata || {}), chat: chatEntries };
  } else if (manifest.metadata && Object.keys(manifest.metadata).length === 0) {
    delete manifest.metadata;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/frontend/manifest-builder.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/asset-save/manifest-builder.ts test/frontend/manifest-builder.test.js
git commit -m "feat: write version-scoped metadata.chat at manifest build time"
```

---

### Task 7: `walkManifestChain` carries `chat` per chain entry

**Files:**
- Modify: `frontend/src/js/engine/time-travel.ts:114-176`
- Test: `test/frontend/time-travel-chain.test.js` (append describe)

- [ ] **Step 1: Write the failing test**

Append to `test/frontend/time-travel-chain.test.js`:

```js
describe("walkManifestChain chat provenance", () => {
  test("entries carry metadata.chat (null when absent)", async () => {
    const manifests = {
      "cid-chat-v2": {
        version: 2,
        prev_asset_manifest_cid: "cid-chat-v1",
        scene: { nodes: [] },
        metadata: {
          chat: [
            { prompt: "a cabin", provider: "mock", task: "model", timestamp: 1780000000 },
          ],
        },
      },
      "cid-chat-v1": {
        version: 1,
        prev_asset_manifest_cid: null,
        scene: { nodes: [] },
      },
    };
    getFromRemoteIPFS.mockImplementation(async (cid) => manifests[cid]);
    const chain = await walkManifestChain("cid-chat-v2");

    expect(chain).toHaveLength(2);
    expect(chain[0].chat).toBeNull();
    expect(chain[1].chat).toHaveLength(1);
    expect(chain[1].chat[0].prompt).toBe("a cabin");
  });
});
```

(The distinct `cid-chat-*` start CID avoids the module-level `chainCache` colliding with earlier tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/time-travel-chain.test.js -t chat`
Expected: FAIL — `chain[1].chat` is `undefined`, not an array.

- [ ] **Step 3: Implement**

In `frontend/src/js/engine/time-travel.ts`, inside `walkManifestChain`, add one line to the `chain.unshift({...})` object (lines 149-159), after the `timestamp` line:

```js
        chat: manifest.metadata?.chat || null,
```

Also update the JSDoc `@returns` (line 120) to include `chat`:

```js
 * @returns {Promise<Array<{cid: string, version: number, color: string|null, scale: object, sourceCid: string|null, nodes: Record<string, string>, chat: Array|null}>>}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/time-travel-chain.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/time-travel.ts test/frontend/time-travel-chain.test.js
git commit -m "feat: carry metadata.chat through walkManifestChain"
```

---

### Task 8: `addChatMessage` supports timestamp + extra class options

**Files:**
- Modify: `frontend/src/js/ui/chat-messages.ts:30-64`
- Test: `test/frontend/chat-messages.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/frontend/chat-messages.test.js`:

```js
test("addChatMessage honors timestamp and extraClass options", () => {
  const when = new Date("2026-08-02T10:20:00Z");
  addChatMessage("user", "old prompt", {
    timestamp: when,
    extraClass: "chat-bubble-history",
  });
  const bubble = document.querySelector(".chat-bubble-history");
  expect(bubble).not.toBeNull();
  expect(bubble.classList.contains("chat-bubble-user")).toBe(true);
  expect(bubble.querySelector("time").dateTime).toBe(when.toISOString());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/chat-messages.test.js -t extraClass`
Expected: FAIL — no `.chat-bubble-history` element rendered.

- [ ] **Step 3: Implement**

In `frontend/src/js/ui/chat-messages.ts`:

a. Replace `buildTimestamp` (lines 30-43):

```js
/**
 * @param {Date} [date]
 * @returns {HTMLElement}
 */
function buildTimestamp(date = new Date()) {
  const time = document.createElement("time");
  time.className = "chat-bubble-time";
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return time;
}
```

b. Replace `addChatMessage` (lines 45-64):

```js
/**
 * Append a plain text chat message.
 * @param {"user"|"system"} role
 * @param {string} text
 * @param {Object} [options]
 * @param {Date} [options.timestamp] - defaults to now
 * @param {string} [options.extraClass] - extra CSS class on the bubble
 */
export function addChatMessage(role, text, options = {}) {
  if (!chatHistoryList) return;
  hideWelcome();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}${options.extraClass ? ` ${options.extraClass}` : ""}`;

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;
  bubble.appendChild(content);

  bubble.appendChild(buildTimestamp(options.timestamp));
  appendBubble(bubble);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/frontend/chat-messages.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/chat-messages.ts test/frontend/chat-messages.test.js
git commit -m "feat: timestamp/extraClass options for chat bubbles"
```

---

### Task 9: Chat provenance history view (new module + wiring + styles)

**Files:**
- Create: `frontend/src/js/ui/chat-history.ts`
- Modify: `frontend/src/js/ui/create-panel.ts` (import; `clearChat()` lines 242-249; `SCENE_READY` handler lines 531-534; `SCENE_EMPTY` handler lines 536-537)
- Modify: `frontend/src/scss/components/_chat.scss` (append)
- Test: `test/frontend/chat-history.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `test/frontend/chat-history.test.js`:

```js
/**
 * Chat provenance history view tests (jsdom).
 *
 * chat-history.js and chat-messages.js resolve #chatHistoryList at module
 * load, so the DOM is seeded before the dynamic imports.
 *
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

async function load() {
  jest.resetModules();
  document.body.innerHTML =
    '<div id="chatHistoryList"><div class="chat-welcome" hidden></div></div>';
  const walkManifestChain = jest.fn();
  jest.unstable_mockModule(
    "../../frontend/src/js/engine/time-travel.ts",
    () => ({ walkManifestChain })
  );
  const mod = await import("../../frontend/src/js/ui/chat-history.ts");
  return { mod, walkManifestChain };
}

test("renders chain metadata.chat entries oldest-first as history bubbles", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "first cabin", provider: "mock", task: "model", timestamp: 1780000000 }] },
    { cid: "v2", chat: null },
    { cid: "v3", chat: [{ prompt: "red roof", provider: "parametric", task: "parametric", timestamp: 1780000100 }] },
  ]);

  await mod.renderChatProvenance("v3");

  const bubbles = document.querySelectorAll(".chat-bubble-history");
  expect(bubbles).toHaveLength(4); // header + 2 prompts + divider
  const texts = [...bubbles].map((b) => b.textContent);
  expect(texts[0]).toContain("Prompt history");
  expect(texts[1]).toContain("first cabin");
  expect(texts[2]).toContain("red roof");
});

test("is a no-op for the same CID and clears on clearHistoryBubbles", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([
    { cid: "v1", chat: [{ prompt: "p", provider: "mock", task: "model", timestamp: 1 }] },
  ]);

  await mod.renderChatProvenance("v1");
  await mod.renderChatProvenance("v1");
  expect(walkManifestChain).toHaveBeenCalledTimes(1);

  mod.clearHistoryBubbles();
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(0);
});

test("renders nothing when the chain has no chat records", async () => {
  const { mod, walkManifestChain } = await load();
  walkManifestChain.mockResolvedValue([{ cid: "v1", chat: null }]);
  await mod.renderChatProvenance("v1");
  expect(document.querySelectorAll(".chat-bubble-history")).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/frontend/chat-history.test.js`
Expected: FAIL — module `chat-history.js` does not exist.

- [ ] **Step 3: Create the module**

Create `frontend/src/js/ui/chat-history.ts`:

```js
/**
 * Chat provenance history.
 *
 * Renders metadata.chat records from the asset's manifest chain as read-only
 * bubbles in the AI Generation pane when an asset is opened. The full
 * conversation is the concatenation of each version's metadata.chat, oldest
 * to newest; live session chat is unaffected. Records are save-anchored:
 * prompts only appear once their result was saved into a manifest version.
 */

import { walkManifestChain } from "../engine/time-travel.js";
import { addChatMessage } from "./chat-messages.js";

const chatHistoryList = document.getElementById("chatHistoryList");

/** @type {string | null} CID of the manifest the history was last rendered for. */
let renderedForCid = null;

/** Remove rendered history bubbles (asset switch, new project, clear chat). */
export function clearHistoryBubbles() {
  chatHistoryList
    ?.querySelectorAll(".chat-bubble-history")
    .forEach((el) => el.remove());
  renderedForCid = null;
}

/**
 * Walk the manifest chain from `manifestCid` and render every metadata.chat
 * record as a read-only bubble, oldest first. No-op when already rendered for
 * this CID or when the chain has no records.
 * @param {string} manifestCid
 */
export async function renderChatProvenance(manifestCid) {
  if (!manifestCid || manifestCid === renderedForCid) return;
  clearHistoryBubbles();
  renderedForCid = manifestCid;

  const chain = await walkManifestChain(manifestCid).catch(
    (/** @type {any} */ err) => {
      console.warn("[CHAT-HISTORY] chain walk failed:", err?.message);
      return null;
    }
  );
  if (!chain) return;

  /** @type {Array<{prompt: string, task?: string, timestamp?: number}>} */
  const entries = [];
  for (const item of chain) {
    for (const entry of item.chat || []) entries.push(entry);
  }
  if (entries.length === 0) return;

  addChatMessage("system", "Prompt history", {
    extraClass: "chat-bubble-history",
  });
  for (const entry of entries) {
    const label =
      entry.task && entry.task !== "model" ? ` (${entry.task})` : "";
    addChatMessage("user", `${entry.prompt}${label}`, {
      timestamp: new Date((entry.timestamp || 0) * 1000),
      extraClass: "chat-bubble-history",
    });
  }
  addChatMessage("system", "— New session —", {
    extraClass: "chat-bubble-history",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/frontend/chat-history.test.js`
Expected: PASS

- [ ] **Step 5: Wire into create-panel**

In `frontend/src/js/ui/create-panel.ts`:

a. Add the import with the other `./chat-messages.js`-adjacent imports:

```js
import { renderChatProvenance, clearHistoryBubbles } from "./chat-history.js";
```

b. In `clearChat()` (lines 242-249), add `clearHistoryBubbles();` after `clearChatMessages();`:

```js
function clearChat() {
  disposeAllChatPreviews();
  _resetPendingGenerations();
  assetMessages.clear();
  lastTripoTaskId = null;
  clearChatMessages();
  clearHistoryBubbles();
  addChatMessage("system", "Chat cleared. Start a new model.");
}
```

c. Replace the `SCENE_READY` handler (lines 531-534):

```js
on(EVENTS.SCENE_READY, (event) => {
  const name = event?.manifest?.name || assetState.get().activeAssetName;
  if (name) syncAssetNameDisplay(name);
  const manifestCid =
    event?.manifestCid || assetState.get().activeAssetManifestCid;
  if (manifestCid) void renderChatProvenance(manifestCid);
});
```

(`scene-loader.js:389` emits `EVENTS.SCENE_READY` with `{ manifest, manifestCid }`.)

d. In the `SCENE_EMPTY` handler (lines 536-537), add `clearHistoryBubbles();`:

```js
on(EVENTS.SCENE_EMPTY, () => {
  syncAssetNameDisplay();
  clearHistoryBubbles();
```

(Keep the rest of that handler unchanged.)

- [ ] **Step 6: Add styles**

Append to `frontend/src/scss/components/_chat.scss`:

```scss
// Read-only prompt-history bubbles (manifest provenance) — visually muted so
// they recede behind live session messages.
.chat-bubble-history {
  opacity: 0.65;

  .chat-bubble-content {
    font-style: italic;
  }
}
```

- [ ] **Step 7: Build the frontend and run checks**

Run: `npm run build:frontend && npm run typecheck:frontend && npm run lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/js/ui/chat-history.ts frontend/src/js/ui/create-panel.ts frontend/src/scss/components/_chat.scss test/frontend/chat-history.test.js
git commit -m "feat: read-only chat provenance history in the Create panel"
```

(`frontend/dist` is gitignored — the build output is not committed.)

---

### Task 10: Ledger panel reads `metadata.chat` instead of `node.history`

**Files:**
- Modify: `frontend/src/js/ui/ledger-panel.ts:135-162`

- [ ] **Step 1: Replace the node-history extraction loop**

Replace the `// Node-level history entries (generation, parametric)` block (lines 135-162):

```js
    // Node-level history entries (generation, parametric)
    for (const node of manifest.nodes || []) {
      for (const h of node.history || []) {
        const key = `${node.node_id}-v${h.v}-${h.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);

        entries.push({
          id: key,
          timestamp: h.timestamp || 0,
          opType: h.type?.toUpperCase() || "GENERATION",
          manifestId: manifest.asset_id || manifest.manifest_id || "-",
          cid: h.src?.cid || manifestCid,
          prevCid: null,
          actorType: "USER",
          actorAddress: h.txHash
            ? walletState.get().walletAddress || "system"
            : "system",
          payload: {
            prompt: h.prompt,
            provider: h.provider,
            txHash: h.txHash,
            nodeId: node.node_id,
            params: h.params,
          },
        });
      }
    }
```

with:

```js
    // Chat provenance entries. metadata.chat is version-scoped and the walk
    // covers every version, so each prompt appears exactly once. Entry
    // timestamps are unix seconds; normalize to ms for sorting.
    for (const h of manifest.metadata?.chat || []) {
      const key = `chat-${manifestCid}-${h.timestamp}-${h.prompt}`;
      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({
        id: key,
        timestamp: (h.timestamp || 0) * 1000,
        opType: "AI",
        manifestId: manifest.asset_id || manifest.manifest_id || "-",
        cid: manifestCid,
        prevCid: null,
        actorType: "USER",
        actorAddress: walletState.get().walletAddress || "system",
        payload: {
          prompt: h.prompt,
          provider: h.provider,
          task: h.task,
          taskId: h.taskId,
        },
      });
    }
```

- [ ] **Step 2: Sweep for remaining `node.history` consumers**

Run: `grep -rn "node?.history\|node\.history\|historyEntry" frontend/src/js src/api --include="*.js"`
Expected: no matches (the backend walker is cleaned in Task 11; if this sweep finds other consumers, evaluate and remove them the same way before proceeding).

- [ ] **Step 3: Run checks**

Run: `npm run typecheck:frontend && npx jest test/frontend/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/ui/ledger-panel.ts
git commit -m "refactor: ledger reads metadata.chat provenance instead of dormant node.history"
```

---

### Task 11: Backend chain walker drops `history[].src` handling

**Files:**
- Modify: `src/api/manifest-chain-walker.ts:191-212`
- Test: `test/api/manifest-chain-walker.test.js:129-147,349-366`

- [ ] **Step 1: Update the tests**

a. In `test/api/manifest-chain-walker.test.js`, delete the entire test `marks history src.cid and src.bundleCid as shared` (lines 129-147).

b. Replace the test `ignores non-string source/history CIDs gracefully` (lines 349-366) with:

```js
  it("ignores non-string source CIDs gracefully", async () => {
    const cid = putManifest({
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "n",
            source: { cid: 123, bundleCid: null },
          },
        ],
      },
    });

    const { shared } = await walkManifestChain(cid);

    expect(Array.from(shared)).toHaveLength(0);
  });
```

- [ ] **Step 2: Remove the walker block**

In `src/api/manifest-chain-walker.ts`, delete the `if (Array.isArray(node?.history)) { ... }` block (lines 191-212).

- [ ] **Step 3: Run tests**

Run: `npx jest test/api/manifest-chain-walker.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/manifest-chain-walker.ts test/api/manifest-chain-walker.test.js
git commit -m "refactor: drop dormant node.history handling from burn chain walker"
```

---

### Task 12: Documentation — ARCHITECTURE.md and AGENTS.md

**Files:**
- Modify: `docs/ARCHITECTURE.md:287-317,340`
- Modify: `AGENTS.md` (§1 bullet; §7 new bullet)

- [ ] **Step 1: Update the manifest example**

In `docs/ARCHITECTURE.md` §4.1, delete the `"history": [ ... ]` array from the node example (lines 287-317), and add a top-level metadata example immediately after the `"comments_archive_cid": "bafyCommentsArchiveCid...",` line at line 263:

```json
  "metadata": {
    "chat": [
      {
        "prompt": "A wooden house",
        "provider": "mock",
        "task": "model",
        "taskId": "tripo-task-abc123",
        "timestamp": 1780000000
      }
    ]
  },
```

- [ ] **Step 2: Update the §4.1 closing note**

Replace the final sentence of the `**Manifest–asset boundary.**` paragraph (line 340):

> The optional `scene.nodes[].history` array can carry a per-node provenance log (generation events, parametric edits); it is consumed by the activity ledger and burn cleanup, but current generation and save paths do not populate it.

with:

```markdown
**Chat provenance (`metadata.chat`).** Each manifest version produced by AI chat activity carries a top-level `metadata.chat` array holding the prompts consumed since the previous version: `{prompt, provider, task, taskId?, timestamp}`. Entries are version-scoped — the full conversation is reconstructed by walking `prev_asset_manifest_cid` and concatenating each version's array, oldest to newest. Records are written at save/publish time only (save-anchored); unaccepted generations stay ephemeral. `taskId` holds the provider-side task ID (e.g. Tripo) for future cross-session enhance flows. Versions with no AI activity omit the field.
```

- [ ] **Step 3: Update AGENTS.md**

a. In §1, replace the bullet:

```
- Parametric color/scale edits append history entries client-side — no cloud regeneration.
```

with:

```
- Parametric color/scale edits are applied client-side — no cloud regeneration.
```

b. In §7 (Key Data Concepts), add after the comments-archive bullet:

```
- **Chat provenance** (`metadata.chat`): each manifest version records the AI prompts that produced it — `{prompt, provider, task, taskId?, timestamp}`, version-scoped (not cumulative); the chain walk reconstructs the full conversation. Unsaved chat is ephemeral (Nostr-based preservation is a future phase).
```

- [ ] **Step 4: Sweep docs for other `node.history` mentions**

Run: `grep -n "history" docs/API_SPEC.md docs/ARCHITECTURE.md | grep -iv "version history\|chat provenance\|manifest chain"`
Expected: no remaining references to `scene.nodes[].history` as a live feature (historical/changelog mentions may stay; fix anything presented as current behavior).

- [ ] **Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md AGENTS.md
git commit -m "docs: document metadata.chat provenance; remove dormant node.history spec"
```

---

### Task 13: E2E — save anchors prompts, reopen renders history

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs` (add one selector)
- Create: `e2e/specs/18-chat-provenance.spec.js`

- [ ] **Step 1: Add the selector**

In `e2e/helpers/studio-selectors.mjs`, find the `chatHistoryList` entry in `SELECTORS` and add directly below it:

```js
  chatHistoryBubbles: ".chat-bubble-history",
```

- [ ] **Step 2: Write the spec**

Create `e2e/specs/18-chat-provenance.spec.js`:

```js
import { test, expect } from "../fixtures/coverage.mjs";
import { MANIFEST_URL_REGEX, fetchManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateToChatBubble,
  saveDraft,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT_A = "provenance cabin";
const PROMPT_B = "provenance tower";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("chat provenance", () => {
  test("save records accepted prompts in metadata.chat and reopen renders history", async ({
    page,
  }) => {
    await connectStudio(page);

    // Two generations, both accepted into the Studio before one save.
    const firstSend = await generateToChatBubble(page, PROMPT_A);
    await firstSend.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    const genCid = manifestCidFromUrl(page.url());

    const secondSend = await generateToChatBubble(page, PROMPT_B);
    await secondSend.click();
    await page.waitForURL((url) => {
      const cid = manifestCidFromUrl(url.toString());
      return Boolean(cid) && cid !== genCid;
    });

    // Save anchors both prompts into a single new manifest version.
    const saveCid = await saveDraft(page, manifestCidFromUrl(page.url()));
    const saved = await fetchManifest(saveCid);
    expect(saved.metadata?.chat?.map((e) => e.prompt)).toEqual([
      PROMPT_A,
      PROMPT_B,
    ]);
    for (const entry of saved.metadata.chat) {
      expect(entry.provider).toBe("mock");
      expect(entry.task).toBe("model");
      expect(typeof entry.timestamp).toBe("number");
    }

    // Generation manifests themselves carry no chat records (save-anchored).
    const gen = await fetchManifest(genCid);
    expect(gen.metadata?.chat).toBeUndefined();

    // Saving fires SCENE_READY for the new tip: history renders live.
    await expect(page.locator(SELECTORS.chatHistoryBubbles)).toHaveCount(4); // header + 2 prompts + divider

    // Cold reopen: boot's loadFromParams() reads ?manifest= and the chain
    // walk renders the history again.
    await page.reload();
    await expect(page.locator(SELECTORS.chatHistoryBubbles)).toHaveCount(4);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT_A);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT_B);
  });
});
```

- [ ] **Step 3: Start infra and run the new spec**

```bash
./scripts/start-dev.sh --setup-only
npm run build:frontend
npm run test:e2e -- --project=chromium e2e/specs/18-chat-provenance.spec.js
```

Expected: PASS (1 test)

- [ ] **Step 4: Run the neighboring generation/save specs (regression)**

```bash
npm run test:e2e -- --project=chromium e2e/specs/02-generate-asset.spec.js e2e/specs/03-save-and-publish.spec.js e2e/specs/04-parametric-version.spec.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/specs/18-chat-provenance.spec.js
git commit -m "test: e2e for save-anchored chat provenance and history view"
```

---

### Task 14: Full verification

- [ ] **Step 1: Lint + typecheck**

```bash
npm run lint && npm run typecheck && npm run typecheck:frontend
```

Expected: PASS

- [ ] **Step 2: Full Jest suite**

```bash
npm test
```

Expected: PASS — all suites, including `test/api/validation.test.js`, `test/api/manifest-chain-walker.test.js`, `test/frontend/{api,pending-generations,manifest-builder,time-travel-chain,chat-messages,chat-history}.test.js`.

- [ ] **Step 3: E2E critical path**

```bash
npm run test:e2e -- --project=chromium
```

Expected: PASS (18 specs)

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: chat provenance verification fixes"
```

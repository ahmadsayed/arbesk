# Tripo3D Backend Adapter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `501 NOT_IMPLEMENTED` gap for the `tripo3d` provider on `POST /api/v1/generations` with a wallet-bound, task-based async flow that never logs or persists the user's BYOK key.

**Architecture:** A new `tripo3d-adapter.js` calls the Tripo v2 REST API with plain `fetch`. A tiny in-memory registry (`generation-tasks.js`) maps public `taskId`s to Tripo task IDs and the transient BYOK key (RAM only, TTL, evicted on terminal state), bound to the SIWE wallet address. The existing `generate-node.js` dispatches the adapter and adds a `GET /generations/:taskId` polling endpoint. The frontend `api.js` polls that endpoint and then runs the existing base64→IPFS→manifest flow unchanged.

**Tech Stack:** Node.js ESM, Express, `fetch` (Node 18+), Jest + Supertest, no new npm dependencies.

---

## File map

| File | Responsibility |
|---|---|
| `src/api/adapters/tripo3d-adapter.js` | Plain-fetch client for Tripo v2: create, poll, download. Throws typed errors. Never logs the key. |
| `src/api/generation-tasks.js` | In-memory task registry: create/evict/lookup, wallet ownership, TTL sweep. |
| `src/api/assets/generate-node.js` | Routes: `POST /generations` dispatches mock vs Tripo; `GET /generations/:taskId` polls registry + adapter. |
| `src/api/rate-limiter.js` | Skip rate limit when request is BYOK (non-mock + providerKey). |
| `frontend/src/js/services/api.js` | `generateAsset()` supports `202 taskId` → polling loop with progress callback. |
| `frontend/src/js/ui/create-panel.js` | Replace the 501 error copy with real Tripo/backend error messages. |
| Tests (`test/api/tripo3d-adapter.test.js`, `test/api/generation-tasks.test.js`, updates to `test/api.test.js`, `test/api/rate-limiter.test.js`, `test/frontend/api.test.js`) | Adapter/registry/route/rate-limit/frontend polling coverage. |
| Docs (`docs/API_SPEC.md`, `docs/CURRENT_STATUS.md`, `src/api/openapi.json`, `.env.example`, `AGENTS.md`) | Reflect the new contract and status. |

---

### Task 1: Tripo v2 adapter with typed errors

**Files:**
- Create: `src/api/adapters/tripo3d-adapter.js`
- Test: `test/api/tripo3d-adapter.test.js`

**Constants:**
- `TRIPO_API_BASE = "https://api.tripo3d.ai/v2/openapi"`
- `TRIPO_MODEL_VERSION = process.env.TRIPO_3D_MODEL || "v2.5-20250123"`

- [ ] **Step 1: Write the failing adapter tests**

```js
import { jest } from "@jest/globals";
import {
  createTask,
  pollTask,
  downloadModel,
  TripoApiError,
} from "../src/api/adapters/tripo3d-adapter.js";

const key = "tsk_test_secret_key_xyz";

describe("tripo3d adapter", () => {
  beforeEach(() => {
    jest.spyOn(global, "fetch").mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("createTask submits text_to_model with v2.5 defaults", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_abc" } }),
    });
    const id = await createTask("a red cube", key);
    expect(id).toBe("task_abc");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.tripo3d.ai/v2/openapi/task");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      type: "text_to_model",
      prompt: "a red cube",
      model_version: "v2.5-20250123",
      texture: true,
      pbr: true,
    });
  });

  test("createTask throws TripoApiError with code on auth failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 1002, message: "Authentication failed" }),
    });
    await expect(createTask("x", key)).rejects.toThrow(TripoApiError);
    try {
      await createTask("x", key);
    } catch (e) {
      expect(e.code).toBe(1002);
      expect(e.status).toBe(401);
    }
  });

  test("createTask throws TripoApiError 402 on insufficient credits", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 2010,
        message: "You don't have enough credit",
      }),
    });
    await expect(createTask("x", key)).rejects.toThrow(TripoApiError);
    try {
      await createTask("x", key);
    } catch (e) {
      expect(e.status).toBe(402);
    }
  });

  test("pollTask returns status and progress", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { task_id: "task_abc", status: "running", progress: 42 },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result).toEqual({ status: "running", progress: 42 });
  });

  test("pollTask returns glbUrl on success using pbr_model", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "success",
          progress: 100,
          output: { pbr_model: "https://cdn/result.glb" },
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result.status).toBe("success");
    expect(result.glbUrl).toBe("https://cdn/result.glb");
  });

  test("pollTask falls back to output.model if pbr_model missing", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "success",
          output: { model: "https://cdn/model.glb" },
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result.glbUrl).toBe("https://cdn/model.glb");
  });

  test("pollTask returns failed on Tripo failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "failed",
          message: "generation failed",
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("generation failed");
  });

  test("downloadModel returns Buffer", async () => {
    const buf = Buffer.from("glb binary");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });
    const out = await downloadModel("https://cdn/result.glb");
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe("glb binary");
  });

  test("no function logs the provider key", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_abc" } }),
    });
    await createTask("x", key);
    const logs = logSpy.mock.calls.flat().join(" ");
    expect(logs).not.toContain(key);
    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/tripo3d-adapter.test.js --runInBand --silent
```

Expected: failures because `tripo3d-adapter.js` does not exist / functions are not defined.

- [ ] **Step 3: Implement the adapter**

```js
import { randomUUID } from "crypto";

export const TRIPO_API_BASE = "https://api.tripo3d.ai/v2/openapi";
export const TRIPO_MODEL_VERSION = process.env.TRIPO_3D_MODEL || "v2.5-20250123";

export class TripoApiError extends Error {
  /**
   * @param {string} message
   * @param {number} code - Tripo API error code
   * @param {number} [status=500] - HTTP status to return to the browser
   */
  constructor(message, code, status = 500) {
    super(message);
    this.name = "TripoApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Low-level fetch wrapper for Tripo v2.
 * @param {string} path - path after base, e.g. "task"
 * @param {string} apiKey
 * @param {"GET"|"POST"} method
 * @param {object} [body]
 */
async function tripoFetch(path, apiKey, method = "GET", body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${TRIPO_API_BASE}/${path}`, opts);
  const json = await res.json().catch(() => ({}));
  if (json.code !== 0) {
    const status = mapTripoCodeToHttp(json.code);
    throw new TripoApiError(json.message || "Tripo provider error", json.code, status);
  }
  return json.data;
}

function mapTripoCodeToHttp(code) {
  // 1002 = auth failed, 2010 = insufficient credits
  if (code === 1002) return 401;
  if (code === 2010) return 402;
  return 502;
}

/**
 * Create a text-to-3D task.
 * @param {string} prompt
 * @param {string} apiKey
 * @returns {Promise<string>} task_id
 */
export async function createTask(prompt, apiKey) {
  const data = await tripoFetch("task", apiKey, "POST", {
    type: "text_to_model",
    prompt,
    model_version: TRIPO_MODEL_VERSION,
    texture: true,
    pbr: true,
  });
  if (typeof data.task_id !== "string") {
    throw new TripoApiError("Tripo did not return a task ID", 0, 502);
  }
  return data.task_id;
}

/**
 * Poll a task.
 * @param {string} taskId
 * @param {string} apiKey
 * @returns {Promise<{status: string, progress?: number, glbUrl?: string, error?: string}>}
 */
export async function pollTask(taskId, apiKey) {
  const data = await tripoFetch(`task/${taskId}`, apiKey);
  const status = data.status;
  if (status === "queued" || status === "running") {
    return { status, progress: data.progress ?? 0 };
  }
  if (status === "success") {
    const glbUrl = data.output?.pbr_model || data.output?.model;
    if (!glbUrl) {
      throw new TripoApiError("Tripo success response missing model URL", 0, 502);
    }
    return { status, glbUrl };
  }
  if (status === "failed" || status === "cancelled") {
    return { status: "failed", error: data.message || `Task ${status}` };
  }
  throw new TripoApiError(`Unknown Tripo status: ${status}`, 0, 502);
}

/**
 * Download the generated GLB.
 * @param {string} glbUrl
 * @returns {Promise<Buffer>}
 */
export async function downloadModel(glbUrl) {
  const res = await fetch(glbUrl);
  if (!res.ok) {
    throw new TripoApiError(`Model download failed: HTTP ${res.status}`, 0, 502);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/tripo3d-adapter.test.js --runInBand --silent
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/adapters/tripo3d-adapter.js test/api/tripo3d-adapter.test.js
git commit -m "feat(generation): add Tripo v2 adapter with typed errors and key hygiene"
```

---

### Task 2: In-memory generation task registry

**Files:**
- Create: `src/api/generation-tasks.js`
- Test: `test/api/generation-tasks.test.js`

- [ ] **Step 1: Write the failing registry tests**

```js
import { jest } from "@jest/globals";
import {
  registerTask,
  getTask,
  evictTask,
  _resetRegistry,
} from "../src/api/generation-tasks.js";

jest.useFakeTimers();

describe("generation-tasks registry", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  test("register returns a UUID and stores the entry", () => {
    const id = registerTask({
      tripoTaskId: "tripo_1",
      providerKey: "key_123",
      userAddress: "0xabc",
    });
    expect(typeof id).toBe("string");
    expect(getTask(id, "0xabc")).toMatchObject({
      tripoTaskId: "tripo_1",
      providerKey: "key_123",
      userAddress: "0xabc",
    });
  });

  test("getTask returns undefined for unknown id", () => {
    expect(getTask("nope", "0xabc")).toBeUndefined();
  });

  test("getTask returns undefined for a different wallet", () => {
    const id = registerTask({
      tripoTaskId: "tripo_1",
      providerKey: "k",
      userAddress: "0xabc",
    });
    expect(getTask(id, "0xother")).toBeUndefined();
    expect(getTask(id, "0xabc")).toBeDefined();
  });

  test("entries expire after TTL", () => {
    const id = registerTask({
      tripoTaskId: "tripo_1",
      providerKey: "k",
      userAddress: "0xabc",
    });
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(getTask(id, "0xabc")).toBeUndefined();
  });

  test("evict removes an entry", () => {
    const id = registerTask({ tripoTaskId: "t", providerKey: "k", userAddress: "0xabc" });
    evictTask(id);
    expect(getTask(id, "0xabc")).toBeUndefined();
  });

  test("registry has no persistence imports", async () => {
    const mod = await import("../src/api/generation-tasks.js");
    // Indirect check: the module should not expose a save/load function.
    expect(mod.save).toBeUndefined();
    expect(mod.load).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/generation-tasks.test.js --runInBand --silent
```

Expected: module not found.

- [ ] **Step 3: Implement the registry**

```js
import { randomUUID } from "crypto";

const TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * @typedef {object} TaskEntry
 * @property {string} tripoTaskId
 * @property {string} providerKey
 * @property {string} userAddress
 * @property {number} createdAt
 */

/** @type {Map<string, TaskEntry>} */
const registry = new Map();

// Sweep expired entries every 5 minutes; unref so it does not keep tests alive.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (now - entry.createdAt > TTL_MS) registry.delete(id);
  }
}, 5 * 60 * 1000);
if (sweep.unref) sweep.unref();

/**
 * Register a new in-flight generation task.
 * @param {{ tripoTaskId: string; providerKey: string; userAddress: string }} entry
 * @returns {string} public taskId
 */
export function registerTask({ tripoTaskId, providerKey, userAddress }) {
  const taskId = randomUUID();
  registry.set(taskId, {
    tripoTaskId,
    providerKey,
    userAddress,
    createdAt: Date.now(),
  });
  return taskId;
}

/**
 * Look up a task entry. Returns undefined if expired, missing, or owned by a
 * different wallet address.
 * @param {string} taskId
 * @param {string} userAddress
 * @returns {TaskEntry | undefined}
 */
export function getTask(taskId, userAddress) {
  const entry = registry.get(taskId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    registry.delete(taskId);
    return undefined;
  }
  if (entry.userAddress !== userAddress) return undefined;
  return entry;
}

/**
 * Remove an entry (e.g. after terminal state).
 * @param {string} taskId
 */
export function evictTask(taskId) {
  registry.delete(taskId);
}

/** Test helper: clear registry and stop sweep. */
export function _resetRegistry() {
  registry.clear();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/generation-tasks.test.js --runInBand --silent
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/generation-tasks.js test/api/generation-tasks.test.js
git commit -m "feat(generation): add in-memory wallet-bound task registry with TTL"
```

---

### Task 3: Backend route changes

**Files:**
- Modify: `src/api/assets/generate-node.js`
- Test: update `test/api.test.js`

- [ ] **Step 1: Write/update the failing route tests**

In `test/api.test.js`, add or replace the existing "cloud provider" tests with:

```js
import { jest } from "@jest/globals";
import { registerTask, _resetRegistry } from "../src/api/generation-tasks.js";

// (inside the describe block, with session helpers already present)

beforeEach(() => {
  _resetRegistry();
  jest.restoreAllMocks();
});

test("POST /generations with tripo3d returns 202 taskId", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ code: 0, data: { task_id: "tripo_task_123" } }),
  });
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", `Session ${sessionToken}`)
    .send({ prompt: "a red cube", nodeId: "node_1", provider: "tripo3d", providerKey: "tsk_real" });
  expect(res.status).toBe(202);
  expect(res.body).toMatchObject({
    taskId: expect.any(String),
    provider: "tripo3d",
    status: "running",
  });
  expect(res.body.taskId).toMatch(/^[0-9a-f-]{36}$/);
  // Key must not leak
  expect(JSON.stringify(res.body)).not.toContain("tsk_real");
});

test("GET /generations/:taskId returns progress while running", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ code: 0, data: { task_id: "tripo_task_123", status: "running", progress: 55 } }),
  });
  const create = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", `Session ${sessionToken}`)
    .send({ prompt: "x", nodeId: "n", provider: "tripo3d", providerKey: "k" });
  const taskId = create.body.taskId;

  const poll = await request(app)
    .get(`/api/v1/generations/${taskId}`)
    .set("Authorization", `Session ${sessionToken}`);
  expect(poll.status).toBe(200);
  expect(poll.body).toEqual({ status: "running", progress: 55 });
});

test("GET /generations/:taskId returns GLB base64 on success and evicts entry", async () => {
  const glb = Buffer.from("glbdata");
  global.fetch = jest.fn().mockImplementation((url) => {
    if (url.includes("/task/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          code: 0,
          data: { task_id: "tripo_task_123", status: "success", output: { pbr_model: "https://cdn/m.glb" } },
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      arrayBuffer: async () => glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
    });
  });
  const create = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", `Session ${sessionToken}`)
    .send({ prompt: "x", nodeId: "n", provider: "tripo3d", providerKey: "k" });
  const taskId = create.body.taskId;

  const poll = await request(app)
    .get(`/api/v1/generations/${taskId}`)
    .set("Authorization", `Session ${sessionToken}`);
  expect(poll.status).toBe(200);
  expect(poll.body.status).toBe("success");
  expect(poll.body.format).toBe("glb");
  expect(poll.body.assetData).toBe(glb.toString("base64"));
  // After success, the entry should be gone.
  const again = await request(app)
    .get(`/api/v1/generations/${taskId}`)
    .set("Authorization", `Session ${sessionToken}`);
  expect(again.status).toBe(404);
});

test("GET /generations/:taskId returns 404 for wallet mismatch", async () => {
  // Register a task owned by a different wallet directly in the registry;
  // polling it with our session must return 404 (no existence leak).
  const foreignTaskId = registerTask({
    tripoTaskId: "tripo_foreign",
    providerKey: "k",
    userAddress: "0xotherwallet",
  });

  const poll = await request(app)
    .get(`/api/v1/generations/${foreignTaskId}`)
    .set("Authorization", `Session ${sessionToken}`);
  expect(poll.status).toBe(404);
});

test("unknown provider still returns 501", async () => {
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", `Session ${sessionToken}`)
    .send({ prompt: "x", nodeId: "n", provider: "meshy", providerKey: "k" });
  expect(res.status).toBe(501);
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "tripo3d" --runInBand
```

Expected: failures because the route does not implement Tripo dispatch or GET endpoint.

- [ ] **Step 3: Modify `generate-node.js`**

Replace the top imports with:

```js
import express from "express";
import { mockGenerate } from "../adapters/mock-adapter.js";
import {
  createTask,
  pollTask,
  downloadModel,
  TripoApiError,
} from "../adapters/tripo3d-adapter.js";
import { registerTask, getTask, evictTask } from "../generation-tasks.js";
import authenticate from "../authentication.js";
import { generationRateLimit } from "../rate-limiter.js";
import { validateBody } from "../validation.js";
import { generateAssetSchema } from "../schemas.js";
```

Inside the route factory, add the GET handler after the POST handler. Replace lines 69–88 (the adapter dispatch block) with:

```js
        /** @type {{ data?: string; buffer?: Buffer; format?: string; provider?: string; path?: string }} */
        let result;
        let taskId = null;
        if (useMockAdapter) {
          console.log(`[GEN] using MOCK adapter for "${prompt}"`);
          result = await mockGenerate(prompt, {
            provider: effectiveProvider,
            providerKey,
          });
          console.log(
            `[GEN] mock returned provider=${result.provider || "mock"} size=${result.data?.length || result.buffer?.length || "?"} bytes`,
          );
        } else if (effectiveProvider === "tripo3d") {
          console.log(`[GEN] using Tripo3D adapter for "${prompt}"`);
          const tripoTaskId = await createTask(prompt, providerKey);
          taskId = registerTask({
            tripoTaskId,
            providerKey,
            userAddress: res.locals.userAddress,
          });
          console.log(`[GEN] tripo task registered taskId=${taskId} tripoTaskId=***`);
          return res.status(202).json({
            taskId,
            provider: "tripo3d",
            status: "running",
          });
        } else {
          console.log("[GEN] cloud adapter not implemented - rejecting");
          return res.status(501).json({
            error: {
              code: "NOT_IMPLEMENTED",
              message: "Cloud adapters not yet implemented",
            },
          });
        }
```

Add after the POST handler (before `return router;`):

```js
  /**
   * GET /api/v1/generations/:taskId
   *
   * Poll endpoint for async generation tasks. Wallet-bound: only the
   * SIWE-authenticated wallet that created the task may read it.
   */
  router.get("/:taskId", authenticate, async (req, res) => {
    try {
      const { taskId } = req.params;
      const entry = getTask(taskId, res.locals.userAddress);
      if (!entry) {
        return res.status(404).json({
          error: {
            code: "GENERATION_TASK_NOT_FOUND",
            message: "Generation task not found",
          },
        });
      }

      const poll = await pollTask(entry.tripoTaskId, entry.providerKey);

      if (poll.status === "queued" || poll.status === "running") {
        return res.json({ status: poll.status, progress: poll.progress ?? 0 });
      }

      if (poll.status === "success" && poll.glbUrl) {
        const buffer = await downloadModel(poll.glbUrl);
        evictTask(taskId);
        return res.json({
          status: "success",
          assetData: buffer.toString("base64"),
          format: "glb",
          path: "asset.glb",
          provider: "tripo3d",
        });
      }

      // failed or cancelled
      evictTask(taskId);
      return res.json({
        status: "failed",
        error: {
          code: "PROVIDER_TASK_FAILED",
          message: poll.error || "Tripo generation task failed",
        },
      });
    } catch (error) {
      const err = /** @type {Error} */ (error);
      if (err instanceof TripoApiError) {
        return res.status(err.status).json({
          error: { code: String(err.code), message: err.message },
        });
      }
      console.error("[GEN] poll error:", err.message);
      return res.status(500).json({
        error: { code: "GENERATION_POLL_FAILED", message: err.message },
      });
    }
  });
```

- [ ] **Step 4: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js -t "tripo3d" --runInBand
```

Expected: route tests pass (other unrelated tests may still pass; full suite runs later).

- [ ] **Step 5: Commit**

```bash
git add src/api/assets/generate-node.js test/api.test.js
git commit -m "feat(generation): wire tripo3d provider into POST and add task-poll endpoint"
```

---

### Task 4: Rate-limit BYOK skip

**Files:**
- Modify: `src/api/rate-limiter.js`
- Test: `test/api/rate-limiter.test.js` (new) or extend `test/api.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { jest } from "@jest/globals";
import request from "supertest";
import { _resetRateLimiters, generationRateLimit } from "../src/api/rate-limiter.js";
import express from "express";

describe("generationRateLimit BYOK skip", () => {
  beforeEach(() => {
    _resetRateLimiters();
  });

  function buildApp(max, mockFlag = "false") {
    process.env.GENERATION_RATE_LIMIT_MAX = String(max);
    process.env.MOCK_3D_GENERATION = mockFlag;
    const app = express();
    app.use(express.json());
    app.post("/gen", generationRateLimit, (req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  test("mock requests count toward the limit", async () => {
    const app = buildApp(2);
    await request(app).post("/gen").send({ provider: "mock" }).expect(200);
    await request(app).post("/gen").send({ provider: "mock" }).expect(200);
    await request(app).post("/gen").send({ provider: "mock" }).expect(429);
  });

  test("BYOK tripo3d requests skip the limit", async () => {
    const app = buildApp(2);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/gen")
        .send({ provider: "tripo3d", providerKey: "k" })
        .expect(200);
    }
  });

  test("tripo3d without providerKey still counts toward limit", async () => {
    const app = buildApp(2);
    await request(app).post("/gen").send({ provider: "tripo3d" }).expect(200);
    await request(app).post("/gen").send({ provider: "tripo3d" }).expect(200);
    await request(app).post("/gen").send({ provider: "tripo3d" }).expect(429);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/rate-limiter.test.js --runInBand
```

Expected: BYOK skip test fails.

- [ ] **Step 3: Modify `rate-limiter.js`**

Replace `generationLimiter` creation and the `generationRateLimit` export with a wrapper that bypasses the limiter for BYOK:

```js
const generationLimiter = createLimiter({
  max: () =>
    Number(
      process.env.GENERATION_RATE_LIMIT_MAX ||
        (process.env.MOCK_3D_GENERATION === "true" ? 1000 : 10),
    ),
  windowMs: 60 * 60 * 1000,
  message: "Generation rate limit exceeded.",
});

/**
 * BYOK providers skip the server-side generation rate limit because the user
 * pays the provider directly with their own API key.
 */
function isByok(req) {
  return (
    req.body &&
    typeof req.body.provider === "string" &&
    req.body.provider !== "mock" &&
    typeof req.body.providerKey === "string" &&
    req.body.providerKey.trim().length > 0
  );
}

export const generationRateLimit = (req, res, next) => {
  if (isByok(req)) return next();
  return generationLimiter.middleware(req, res, next);
};
```

Ensure `_resetRateLimiters` still resets `generationLimiter.store.resetAll()`.

- [ ] **Step 4: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api/rate-limiter.test.js --runInBand
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/rate-limiter.js test/api/rate-limiter.test.js
git commit -m "feat(generation): skip generation rate limit for BYOK providers"
```

---

### Task 5: Frontend polling in `api.js`

**Files:**
- Modify: `frontend/src/js/services/api.js`
- Test: `test/frontend/api.test.js` (new or extend existing)

- [ ] **Step 1: Write/update failing frontend tests**

```js
import { jest } from "@jest/globals";
import { generateAsset } from "../../frontend/src/js/services/api.js";

jest.setTimeout(10000);

// Mock wallet state and IPFS helpers (adjust to existing frontend test patterns)
jest.unstable_mockModule("../../frontend/src/js/state/wallet.js", () => ({
  walletState: { get: () => ({ chainId: 84532, walletAddress: "0xabc" }) },
}));

global.fetch = jest.fn();

describe("generateAsset tripo3d polling", () => {
  const base64 = (s) => btoa(s);

  beforeEach(() => {
    fetch.mockReset();
  });

  test("follows 202 taskId to success and uploads GLB", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ taskId: "task-1", provider: "tripo3d", status: "running" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "running", progress: 50 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "success",
          assetData: base64("glb"),
          format: "glb",
          path: "asset.glb",
        }),
      });

    const result = await generateAsset({
      prompt: "cube",
      nodeId: "n",
      provider: "tripo3d",
      providerKey: "k",
    });
    expect(result.format).toBe("glb");
    expect(fetch).toHaveBeenCalledTimes(3);
    const pollCall = fetch.mock.calls[1];
    expect(pollCall[0]).toBe("/api/v1/generations/task-1");
  });

  test("throws on task failure", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ taskId: "task-2", provider: "tripo3d", status: "running" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: "failed",
          error: { code: "PROVIDER_TASK_FAILED", message: "bad prompt" },
        }),
      });

    await expect(
      generateAsset({ prompt: "x", nodeId: "n", provider: "tripo3d", providerKey: "k" })
    ).rejects.toThrow("bad prompt");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/api.test.js --runInBand
```

Expected: failures because `generateAsset` does not poll.

- [ ] **Step 3: Modify `frontend/src/js/services/api.js`**

Insert a helper above `generateAsset`:

```js
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function pollGeneration(taskId, onProgress) {
  const started = Date.now();
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetchWithSession(`/generations/${taskId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(data?.error?.message || "Generation poll failed", res.status, data?.error?.code);
    }
    if (data.status === "success") return data;
    if (data.status === "failed") {
      throw new ApiError(
        data.error?.message || "Generation task failed",
        500,
        data.error?.code || "PROVIDER_TASK_FAILED"
      );
    }
    if (typeof onProgress === "function" && typeof data.progress === "number") {
      onProgress(data.progress);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new ApiError("Generation timed out", 504, "GENERATION_TIMEOUT");
}
```

Modify `generateAsset` after the initial POST response check to handle the 202 case. Replace the single block after `if (!response.ok)` with:

```js
  if (!response.ok) {
    const { message, code } = parseErrorBody(data);
    announceStatus("Generation failed: " + (message || `HTTP ${response.status}`));
    throw new ApiError(
      message || `Generation failed (HTTP ${response.status})`,
      response.status,
      code
    );
  }

  // Async provider path: poll until the task completes.
  if (data.taskId) {
    announceStatus("Generating 3D asset on Tripo3D…");
    const final = await pollGeneration(data.taskId, (progress) => {
      announceStatus(`Generating 3D asset on Tripo3D… ${progress}%`);
    });
    Object.assign(data, final);
  }
```

Then proceed with the existing `base64ToBytes(data.assetData)` flow.

- [ ] **Step 4: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/api.test.js --runInBand
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/api.js test/frontend/api.test.js
git commit -m "feat(generation): frontend polls tripo3d task endpoint until completion"
```

---

### Task 6: Update frontend error messaging

**Files:**
- Modify: `frontend/src/js/ui/create-panel.js`

- [ ] **Step 1: Replace the 501 special-case**

In the `catch (err)` block inside `onGenerate` (around lines 445–454), replace:

```js
      } else if (err.status === 501) {
        userMsg = "Cloud generation is not yet enabled. Switch to mock mode.";
      } else if (err.message) {
```

with:

```js
      } else if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.status === 504 || err.code === "GENERATION_TIMEOUT") {
        userMsg = "Generation timed out. Try again later.";
      } else if (err.message) {
```

- [ ] **Step 2: Build frontend and run a quick smoke check**

```bash
npm run build:frontend
```

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/ui/create-panel.js
git commit -m "feat(generation): surface tripo3d auth/credit/timeout errors in UI"
```

---

### Task 7: Update docs and OpenAPI

**Files:**
- Modify: `docs/API_SPEC.md`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `src/api/openapi.json`
- Modify: `.env.example`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update `docs/API_SPEC.md`**

Find the `POST /api/v1/generations` section. Change the description and response:
- If `provider === "mock"` (or `MOCK_3D_GENERATION=true`), returns `200 { assetData, format, path, provider }` immediately.
- If `provider === "tripo3d"`, returns `202 { taskId, provider, status: "running" }`.
- Add `GET /api/v1/generations/:taskId` with response schemas for queued/running/success/failed.
- Document 401 `PROVIDER_AUTH_FAILED`, 402 `PROVIDER_CREDITS_EXHAUSTED`, 404 `GENERATION_TASK_NOT_FOUND`, 502 `PROVIDER_ERROR`.

- [ ] **Step 2: Update `docs/CURRENT_STATUS.md`**

Remove or mark resolved the lines that list "Cloud 3D adapters — 501 NOT_IMPLEMENTED" / "Real 3D generation ❌ 501" and note Tripo3D BYOK is implemented.

- [ ] **Step 3: Update `src/api/openapi.json`**

Under `/generations`:
- Add `202` response object with `taskId`, `provider`, `status`.
- Add `401`, `402`, `502` error responses.
- Add new path `/generations/{taskId}` with `GET` operation, session auth, and `200` schemas for running/success/failed plus `404`.

- [ ] **Step 4: Update `.env.example`**

Add near the generation section:

```bash
# Tripo3D model version used by the backend adapter. Default: v2.5-20250123
TRIPO_3D_MODEL=v2.5-20250123

# Tripo3D API key for local manual/integration testing only.
# The production UI uses BYOK (providerKey) per request; the backend never reads this key.
TRIPO_3D_KEY=
```

- [ ] **Step 5: Update `AGENTS.md`**

Add to the adapter/route table in §3:
- `src/api/adapters/tripo3d-adapter.js` — Tripo v2 REST adapter
- `src/api/generation-tasks.js` — in-memory wallet-bound task registry
- Update `generate-node.js` row to include the `GET /generations/:taskId` polling endpoint

- [ ] **Step 6: Commit**

```bash
git add docs/API_SPEC.md docs/CURRENT_STATUS.md src/api/openapi.json .env.example AGENTS.md
git commit -m "docs(generation): document tripo3d task-based generation contract"
```

---

### Task 8: Verification

- [ ] **Step 1: Backend tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/api.test.js test/api/tripo3d-adapter.test.js test/api/generation-tasks.test.js test/api/rate-limiter.test.js --runInBand
```

Expected: all pass.

- [ ] **Step 2: Frontend unit tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/api.test.js --runInBand
```

Expected: all pass.

- [ ] **Step 3: Full frontend build**

```bash
npm run build:frontend
```

Expected: no errors.

- [ ] **Step 4: Lint and typecheck**

```bash
npm run lint
npm run typecheck
```

Expected: no new lint/type errors.

- [ ] **Step 5: Live smoke test (requires API credits)**

Start the backend:

```bash
npm start
```

In another terminal, create a session and generate:

```bash
curl -X POST http://127.0.0.1:9090/api/v1/generations \
  -H "Authorization: Session <session>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a simple red cube","nodeId":"n1","provider":"tripo3d","providerKey":"<your-key>"}'
# expect 202 { taskId, status:"running" }

curl http://127.0.0.1:9090/api/v1/generations/<taskId> \
  -H "Authorization: Session <session>"
# expect final { status:"success", assetData:"...", format:"glb" }
```

Expected: a real GLB returns.

- [ ] **Step 6: E2E critical path**

```bash
npx playwright test --config=e2e/playwright.config.js --project=chromium
```

Expected: mock-mode specs still pass. (If running against real Tripo, the E2E suite is not set up for BYOK; keep E2E in mock mode.)

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(generation): complete Tripo3D BYOK task-based adapter"
```

---

## Self-review coverage

| Spec requirement | Task implementing it |
|---|---|
| BYOK-only, no server fallback | Task 1 (no env fallback), Task 3 (route reads `providerKey` only from body) |
| Wallet-bound polling (only creator can poll) | Task 2 (`userAddress` in registry), Task 3 (GET 404 mismatch) |
| Key never logged/persisted | Task 1 (no key logs), Task 2 (RAM-only registry), tests spy console output |
| Tripo v2 API, `text_to_model`, v2.5 default | Task 1 |
| Async task-based flow with progress | Task 1, Task 3, Task 5 |
| Download GLB and return base64 same shape as today | Task 1, Task 3 |
| BYOK rate-limit skip | Task 4 |
| Frontend error copy update | Task 6 |
| Docs/OpenAPI update | Task 7 |

No placeholders. Type consistency: `taskId`, `tripoTaskId`, `providerKey`, `userAddress` used consistently across adapter, registry, and route.

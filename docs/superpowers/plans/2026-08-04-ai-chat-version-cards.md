# AI Chat Version Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI-chat generation bubble a durable version card — GLB-referenced follow-ups (retexture/retopo/auto-rig/animate), a compact action row, typed prompts that refine the active version, and auto-save on "Show in Studio" with click-to-restore version history.

**Architecture:** Tripo follow-ups stop referencing the ephemeral backend task registry and instead upload the bubble's GLB (fetched from IPFS by CID) to Tripo `POST /files` → `file_token`, which the texture/decimate/rig-check/rig endpoints accept as `input`. The frontend replaces the 7-chip choice row with a 4-button action row, tracks an explicit "active version" for typed-prompt retexture, and auto-saves a draft when a generation is sent to the Studio so older bubbles can restore their version.

**Spec:** `docs/superpowers/specs/2026-08-04-ai-chat-version-cards-design.md`

**Tech Stack:** Node/Express backend (ESM), Zod schemas, Jest + Supertest (`global.fetch` spy seam — never `jest.mock` the adapter), vanilla JS frontend (ESM, jsdom Jest tests), Pug/SCSS (custom build via `npm run build:frontend`), Playwright E2E.

## Global Constraints

- ESM everywhere in root + frontend (`import`/`export`); camelCase functions, UPPER_SNAKE module constants. JSDoc on new exported functions.
- Backend log prefixes: `[GEN]` for generation flow; log start + outcome of async ops; `console.error` for exceptions only.
- The Tripo adapter is mocked in tests ONLY via `jest.spyOn(global, "fetch")` — never `jest.mock`/`unstable_mockModule` on the adapter module.
- `quad` must stay `false` on decimate — `quad: true` forces FBX output which the glTF pipeline cannot load.
- Retarget input is always the **rig task ID** (Tripo-internal); only rig-check/rig/texture/decimate take `file_token`.
- No SRI hashes in Pug CDN tags; pin exact versions, keep `crossorigin="anonymous"`.
- Run `npm run build:frontend` after any Pug/SCSS/frontend-JS change before `npm run test:frontend` (deployment-integrity tests compare dist).
- After backend changes: `npm test -- test/api.test.js test/api/tripo3d-adapter.test.js`. After frontend changes: `npm run typecheck:frontend` and the relevant `test/frontend/*.test.js` files.
- Git commits happen only as part of user-approved plan execution — one commit per task, messages as given in the steps.

---

### Task 1: Tripo adapter — uploadModel, file_token inputs, textureQuality

**Files:**
- Modify: `src/api/adapters/tripo3d-adapter.js`
- Test: `test/api/tripo3d-adapter.test.js`

**Interfaces:**
- Produces (used by Task 3 routes):
  - `uploadModel(glbBuffer: Buffer, apiKey: string): Promise<string>` — file_token
  - `createTask(prompt: string, apiKey: string, options?: { textureQuality?: "standard"|"detailed"|"extreme" }): Promise<string>`
  - `createImageTask(fileToken: string, apiKey: string, options?: { textureQuality?: ... }): Promise<string>`
  - `createRefineTask(prompt: string, fileToken: string, apiKey: string, options?: { textureQuality?: ... }): Promise<string>`
  - `decimateTask(fileToken: string, apiKey: string, options?: { faceLimit?: number, quad?: boolean }): Promise<string>`
  - `rigCheckTask(fileToken: string, apiKey: string): Promise<string>`
  - `rigModelTask(fileToken: string, rigType: string, apiKey: string): Promise<string>`
  - `retargetTask(rigTaskId: string, animations: string[], apiKey: string): Promise<string>` — UNCHANGED
  - `TEXTURE_QUALITIES: readonly ["standard","detailed","extreme"]` (exported const)

- [ ] **Step 1: Write the failing tests**

Add to `test/api/tripo3d-adapter.test.js` (follow the file's existing `global.fetch` spy pattern):

```js
import { uploadModel, createRefineTask, decimateTask, rigCheckTask, rigModelTask } from "../../src/api/adapters/tripo3d-adapter.js";

describe("uploadModel", () => {
  it("POSTs the GLB to /files as multipart and returns file_token", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { file_token: "file_glb_1" } }),
    });
    const token = await uploadModel(Buffer.from("glb-bytes"), "key");
    expect(token).toBe("file_glb_1");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/files");
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.headers["Content-Type"]).toBeUndefined();
  });

  it("rejects an empty buffer", async () => {
    await expect(uploadModel(Buffer.alloc(0), "key")).rejects.toMatchObject({ status: 400 });
  });
});

describe("file_token inputs", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_1" } }),
    });
  });

  it("createRefineTask sends the file token as input", async () => {
    await createRefineTask("rusty bronze", "file_glb_1", "key");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(global.fetch.mock.calls[0][0]).toBe("https://openapi.tripo3d.ai/v3/models/texture");
    expect(body).toMatchObject({ input: "file_glb_1", text_prompt: "rusty bronze", texture: true, pbr: true });
  });

  it("decimateTask sends the file token and keeps quad=false", async () => {
    await decimateTask("file_glb_1", "key", { faceLimit: 20000 });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ input: "file_glb_1", model: "v2.0", quad: false, bake: true, face_limit: 20000 });
  });

  it("rigCheckTask and rigModelTask send the file token", async () => {
    await rigCheckTask("file_glb_1", "key");
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ input: "file_glb_1" });
    await rigModelTask("file_glb_1", "biped", "key");
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ input: "file_glb_1", rig_type: "biped", spec: "mixamo" });
  });
});

describe("textureQuality", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_1" } }),
    });
  });

  it("omits texture_quality for standard", async () => {
    await createTask("a knight", "key", { textureQuality: "standard" });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.texture_quality).toBeUndefined();
  });

  it("passes extreme through", async () => {
    await createTask("a knight", "key", { textureQuality: "extreme" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).texture_quality).toBe("extreme");
  });

  it("createRefineTask passes texture_quality through", async () => {
    await createRefineTask("rusty", "file_glb_1", "key", { textureQuality: "detailed" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).texture_quality).toBe("detailed");
  });
});
```

Also update existing tests in that file that assert `highQuality` behavior: replace with `textureQuality: "detailed"` equivalents, and update any `createRefineTask/decimateTask/rigCheckTask/rigModelTask` tests that pass task IDs to pass file tokens instead (assertion bodies stay the same shape — `input` is a plain string either way).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/api/tripo3d-adapter.test.js`
Expected: FAIL — `uploadModel is not a function`, and existing highQuality tests fail after edits.

- [ ] **Step 3: Implement the adapter changes**

In `src/api/adapters/tripo3d-adapter.js`:

Add near the top:

```js
/** Valid Tripo texture_quality levels (generation ≥ v3.0 and models/texture). */
export const TEXTURE_QUALITIES = ["standard", "detailed", "extreme"];
```

Add `uploadModel` directly after `uploadImage` (mirrors it; GLB payload):

```js
/**
 * Upload a source 3D model (GLB) to Tripo (POST /files) and return its
 * file_token. Follow-up endpoints (models/texture, mesh/decimate,
 * animations/rig-check, animations/rig) accept the token as `input`.
 * @param {Buffer} glbBuffer - raw GLB bytes
 * @param {string} apiKey
 * @returns {Promise<string>} file_token
 */
export async function uploadModel(glbBuffer, apiKey) {
  if (!Buffer.isBuffer(glbBuffer) || glbBuffer.length === 0) {
    throw new TripoApiError("glbBuffer is required", 0, 400);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new TripoApiError("apiKey is required", 0, 400);
  }
  console.log(`[GEN] Tripo uploadModel size=${glbBuffer.length}`);
  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed view — Buffer's ArrayBufferLike
  // (possibly shared) backing store is not a valid BlobPart.
  const bytes = new Uint8Array(glbBuffer);
  form.append("file", new Blob([bytes], { type: "model/gltf-binary" }), "model.glb");
  const data = await tripoFetch("files", apiKey, "POST", form);
  if (typeof data?.file_token !== "string") {
    throw new TripoApiError("Tripo did not return a file token", 0, 502);
  }
  console.log(`[GEN] Tripo model uploaded file_token=${data.file_token}`);
  return data.file_token;
}
```

Add a shared option mapper above `createTask`:

```js
/**
 * Map the textureQuality option to Tripo's texture_quality field.
 * "standard" is Tripo's default — omitting the field keeps payloads minimal.
 * @param {object} options
 * @returns {object}
 */
function textureQualityField(options) {
  const q = options.textureQuality;
  return q && q !== "standard" && TEXTURE_QUALITIES.includes(q)
    ? { texture_quality: q }
    : {};
}
```

In `createTask` and `createImageTask`: replace the `options.highQuality && { texture_quality: "detailed" }` spread with `...textureQualityField(options)`, drop `highQuality` from the JSDoc (add `textureQuality`), and update the log line (`hq=${...}` → `tq=${options.textureQuality || "standard"}`).

In `createRefineTask`: rename the second parameter from `originalTripoTaskId` to `fileToken`, pass `input: fileToken`, add `options = {}` fourth parameter, spread `...textureQualityField(options)` into the body. Update JSDoc: `@param {string} fileToken - file_token from uploadModel()`.

In `decimateTask` / `rigCheckTask` / `rigModelTask`: rename `inputTaskId` → `fileToken` (parameter, validation message, log lines, JSDoc: "file_token from uploadModel()"). Bodies unchanged (`input` is a plain string either way). Do NOT touch `retargetTask` — its input is a rig task ID.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/api/tripo3d-adapter.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add src/api/adapters/tripo3d-adapter.js test/api/tripo3d-adapter.test.js
git commit -m "feat(tripo): GLB file_token inputs for follow-ups + textureQuality option"
```

---

### Task 2: Request schema + task registry entry shape

**Files:**
- Modify: `src/api/schemas.js:54-95`
- Modify: `src/api/generation-tasks.js`
- Test: `test/api.test.js` (validation cases live with the route tests in Task 3; this task adds pure schema tests)

**Interfaces:**
- Consumes: `TEXTURE_QUALITIES` concept from Task 1 (duplicated as a Zod enum — schemas.js does not import the adapter).
- Produces: `generateAssetSchema` accepting `{ prompt?, nodeId, provider?, providerKey?, sourceAssetCid?, retexture?, retopo?, animate?, rigOnly?, animations?, faceLimit?, textureQuality?, imageData?, imageMime? }`. Registry `registerTask` accepts `sourceFileToken` (replaces `sourceTripoTaskId`); `TaskEntry.sourceFileToken` read by Task 3's poll handler.

- [ ] **Step 1: Write the failing tests**

Add to `test/api.test.js` inside `describe("POST /api/v1/generations", ...)` (or a new `describe("generateAssetSchema", ...)` block next to it — validation failures return 400 `VALIDATION_ERROR` before any adapter call, so no fetch spy is needed; a valid session header IS needed — reuse the file's `makeSessionHeader()` helper):

```js
it("rejects sourceAssetCid without an action flag", async () => {
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource" });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("VALIDATION_ERROR");
});

it("rejects sourceAssetCid with two action flags", async () => {
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", retopo: true, animate: true, animations: ["preset:idle"] });
  expect(res.status).toBe(400);
});

it("rejects retexture without a prompt", async () => {
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", retexture: true });
  expect(res.status).toBe(400);
});

it("rejects animate without animations unless rigOnly", async () => {
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", animate: true });
  expect(res.status).toBe(400);
});

it("rejects an invalid textureQuality", async () => {
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "x", textureQuality: "ultra" });
  expect(res.status).toBe(400);
});

it("accepts auto-rig (animate + rigOnly, no animations)", async () => {
  const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ code: 0, data: { task_id: "task_rc" }, }),
  });
  // GLB fetch from storage + Tripo upload are mocked in Task 3; this test
  // only asserts validation passes (any non-400 status).
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", animate: true, rigOnly: true });
  expect(res.status).not.toBe(400);
  fetchSpy.mockRestore();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/api.test.js -t "sourceAssetCid"`
Expected: FAIL — the unknown fields are stripped/ignored by the old schema, so the 400 assertions fail (the last two fail differently: old schema has no `textureQuality`/`animate` fields). Note: the "accepts auto-rig" test will error 500 until Task 3 implements the route — that is expected at this stage; the four 400 assertions are this task's gate.

- [ ] **Step 3: Replace the schema and registry field**

In `src/api/schemas.js`, replace the whole `generateAssetSchema` (lines 54–95) with:

```js
export const generateAssetSchema = z
  .object({
    prompt: z.string().min(1, "prompt is required").optional(),
    nodeId: z.string().min(1, "nodeId is required"),
    provider: z.string().optional(),
    providerKey: z.string().max(200).optional(),
    // Follow-up actions (tripo3d only): the source model is referenced by
    // its IPFS GLB CID — the backend fetches the bytes and uploads them to
    // Tripo (POST /files → file_token). Exactly one action flag per request.
    sourceAssetCid: z.string().min(1).max(128).optional(),
    retexture: z.boolean().optional(),
    retopo: z.boolean().optional(),
    animate: z.boolean().optional(),
    // Retarget-only shortcut: backend registry id of a completed rig-only
    // task. Optional — the GLB chain is the canonical path.
    sourceTaskId: z.string().max(64).optional(),
    rigOnly: z.boolean().optional(),
    animations: z.array(z.enum(ANIMATION_PRESETS)).min(1).max(5).optional(),
    // Texture quality (tripo3d only): generation + retexture.
    textureQuality: z.enum(["standard", "detailed", "extreme"]).optional(),
    // Smart retopology polygon budget (tripo3d only): adaptive when omitted.
    faceLimit: z.number().int().min(500).max(20000).optional(),
    // Image-to-3D (tripo3d only): base64 image bytes + MIME type.
    imageData: z
      .string()
      .max(MAX_IMAGE_BASE64_LENGTH, "imageData exceeds the 10 MB image limit")
      .regex(/^[A-Za-z0-9+/=\r\n]+$/, "imageData must be base64")
      .optional(),
    imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  })
  .refine((v) => v.prompt || v.imageData || v.sourceAssetCid, {
    message: "prompt, imageData, or sourceAssetCid is required",
    path: ["prompt"],
  })
  .refine((v) => !v.imageData || v.imageMime, {
    message: "imageMime is required when imageData is present",
    path: ["imageMime"],
  })
  .refine(
    (v) =>
      !v.sourceAssetCid ||
      [v.retexture, v.retopo, v.animate].filter(Boolean).length === 1,
    {
      message:
        "sourceAssetCid requires exactly one of retexture, retopo, or animate",
      path: ["sourceAssetCid"],
    },
  )
  .refine((v) => !v.retexture || v.prompt, {
    message: "prompt (texture description) is required when retexture is set",
    path: ["prompt"],
  })
  .refine(
    (v) => !v.animate || v.rigOnly || (v.animations?.length ?? 0) > 0,
    {
      message: "animations is required when animate is set (unless rigOnly)",
      path: ["animations"],
    },
  )
  .refine((v) => !v.rigOnly || v.animate, {
    message: "rigOnly is only valid with animate",
    path: ["rigOnly"],
  });
```

In `src/api/generation-tasks.js`: rename the `sourceTripoTaskId` field to `sourceFileToken` everywhere (typedef line 16, `registerTask` destructure + JSDoc line 33, spread line 57). Update the JSDoc description to `sourceFileToken - Tripo file_token of the source GLB (animate chain)`. Leave `getCompletedTask`/`markTaskComplete` in place — Task 3 still uses them for the retarget-only shortcut.

- [ ] **Step 4: Run tests to verify the validation gate passes**

Run: `npm test -- test/api.test.js -t "sourceAssetCid"`
Expected: the four 400-validation tests PASS; "accepts auto-rig" may still fail non-400 (Task 3 wires the route). Existing refine/animate/retopo route tests WILL fail — they use the old fields and get fixed in Task 3; do not fix them here.

- [ ] **Step 5: Commit**

```bash
git add src/api/schemas.js src/api/generation-tasks.js test/api.test.js
git commit -m "feat(api): sourceAssetCid action schema + registry sourceFileToken"
```

---

### Task 3: Generation route — GLB upload + follow-up dispatch

**Files:**
- Modify: `src/api/assets/generate-node.js`
- Test: `test/api.test.js` (rewrite the tripo3d refine/retopo/animate sub-blocks)

**Interfaces:**
- Consumes: Task 1 adapter functions; `getStorage().catBytes(cid): Promise<Buffer>` from `src/api/storage/index.js`; Task 2 schema fields and `sourceFileToken` registry field.
- Produces: `POST /api/v1/generations` follow-up contract — request `{sourceAssetCid, retexture|retopo|animate, …}` → 202 `{taskId, provider:"tripo3d", status:"running", refined?|retopo?|animating?}`. Errors: 400 `SOURCE_ASSET_UNAVAILABLE` (IPFS fetch failed). The GET poll handler is unchanged in shape (status/progress/stage/success+assetData).

- [ ] **Step 1: Rewrite the failing route tests**

In `test/api.test.js`, replace the tripo3d refine / retopo / animate tests (the blocks at roughly :676-758, :1053, :1104-1148) with `sourceAssetCid`-based versions. The fetch spy now sees **three** upstream calls in order: (1) IPFS cat — this goes through `ipfs-http-client`, already mocked at :118, so only Tripo `fetch` calls need spying; the Kubo mock must answer `cat`. Check how the existing ipfs mock handles `cat` — if it lacks one, add `cat: jest.fn(async function* () { yield Buffer.from("glb"); })` to the mocked client factory. Then:

```js
it("POST retexture uploads the source GLB and starts a texture task", async () => {
  const calls = [];
  const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_tex" } }) };
  });
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "rusty bronze", sourceAssetCid: "bafySource", retexture: true, textureQuality: "detailed" });
  expect(res.status).toBe(202);
  expect(res.body).toMatchObject({ provider: "tripo3d", status: "running", refined: true });
  expect(calls[0]).toBe("https://openapi.tripo3d.ai/v3/files");
  expect(calls[1]).toBe("https://openapi.tripo3d.ai/v3/models/texture");
  fetchSpy.mockRestore();
});

it("POST animate uploads the GLB and starts rig-check with the file token", async () => {
  const calls = [];
  const bodies = [];
  const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (url, opts) => {
    calls.push(url);
    if (opts?.body && !(opts.body instanceof FormData)) bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ code: 0, data: { file_token: "file_1", task_id: "task_rc" } }) };
  });
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", animate: true, animations: ["preset:idle"] });
  expect(res.status).toBe(202);
  expect(res.body.animating).toBe(true);
  expect(calls[1]).toBe("https://openapi.tripo3d.ai/v3/animations/rig-check");
  expect(bodies[0]).toMatchObject({ input: "file_1" });
  fetchSpy.mockRestore();
});
```

Keep/adapt the existing chain-advance tests (GET poll: rig-check → rig → retarget): the rig step must now call `animations/rig` with `input: "file_1"` (the entry's `sourceFileToken`) instead of the old generation task ID. Keep the retarget-only test but seed the registry entry with `phase: "rig"` + `sourceTaskId` in the POST body.

Add:

```js
it("returns 400 SOURCE_ASSET_UNAVAILABLE when the GLB cannot be fetched", async () => {
  // make the mocked ipfs client's cat throw for this test
  const res = await request(app)
    .post("/api/v1/generations")
    .set("Authorization", await makeSessionHeader())
    .send({ nodeId: "n1", provider: "tripo3d", providerKey: "k", prompt: "x", sourceAssetCid: "bafyMissing", retexture: true });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("SOURCE_ASSET_UNAVAILABLE");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/api.test.js -t "tripo3d"`
Expected: FAIL — route still expects the old task-ID fields (404 `*_SOURCE_NOT_FOUND` or validation errors).

- [ ] **Step 3: Rewrite the route**

In `src/api/assets/generate-node.js`:

1. Update imports: add `uploadModel` to the adapter import; add `import { getStorage } from "../storage/index.js";`; remove `getCompletedTask` usage for refine/retopo sources (keep the import — the retarget-only shortcut still uses it).
2. Replace the destructure at line 67:

```js
const { prompt, nodeId, provider, providerKey, sourceAssetCid, sourceTaskId, retexture, retopo, animate, rigOnly, animations, faceLimit, textureQuality, imageData, imageMime } = req.body;
```

3. Add a helper above the route:

```js
/**
 * Fetch a source GLB from IPFS and upload it to Tripo, returning the
 * file_token. Throws TripoApiError(400, SOURCE_ASSET_UNAVAILABLE-shaped)
 * when the CID cannot be read.
 * @param {string} cid
 * @param {string} apiKey
 * @returns {Promise<string>} file_token
 */
async function uploadSourceGlb(cid, apiKey) {
  let glb;
  try {
    glb = await getStorage().catBytes(cid);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    console.log(`[GEN] source GLB fetch failed cid=${cid}: ${err.message}`);
    throw new TripoApiError("Source asset unavailable in IPFS", 0, 400);
  }
  return uploadModel(glb, apiKey);
}
```

Map the 400 in the catch block: in the route's `catch`, before the generic `TripoApiError` handling, special-case `err instanceof TripoApiError && err.status === 400 && err.message === "Source asset unavailable in IPFS"` → `res.status(400).json({ error: { code: "SOURCE_ASSET_UNAVAILABLE", message: err.message } })`. (Simpler alternative: give `TripoApiError` the message and match on it — do not add a new error class.)

4. Replace the `animateTaskId` / `refineTaskId` / `retopoTaskId` blocks (lines 151–286) with:

```js
if (sourceAssetCid) {
  // Retarget-only shortcut: the caller references a completed rig-only
  // registry entry whose skeleton still lives Tripo-side (registry TTL).
  // Everything else goes through the GLB — the canonical, expiry-free path.
  if (animate && sourceTaskId) {
    const rigSource = getCompletedTask(sourceTaskId, res.locals.userAddress);
    if (rigSource && rigSource.kind === "animate" && rigSource.phase === "rig" && !rigOnly) {
      console.log(`[GEN] retarget-only: source rig=${rigSource.tripoTaskId} animations=${(animations || []).join(",")}`);
      const retargetId = await retargetTask(rigSource.tripoTaskId, animations, key);
      const taskId = registerTask({ tripoTaskId: retargetId, providerKey: key, userAddress: res.locals.userAddress, kind: "animate", phase: "retarget", animations });
      return res.status(202).json({ taskId, provider: "tripo3d", status: "running", animating: true });
    }
  }

  const fileToken = await uploadSourceGlb(sourceAssetCid, key);

  if (animate) {
    console.log(`[GEN] starting animate chain source=${sourceAssetCid} animations=${(animations || []).join(",")} rigOnly=${Boolean(rigOnly)}`);
    const rigCheckId = await rigCheckTask(fileToken, key);
    const taskId = registerTask({
      tripoTaskId: rigCheckId, providerKey: key, userAddress: res.locals.userAddress,
      kind: "animate", phase: "rig-check", animations, rigOnly: Boolean(rigOnly), sourceFileToken: fileToken,
    });
    return res.status(202).json({ taskId, provider: "tripo3d", status: "running", animating: true });
  }

  if (retopo) {
    console.log(`[GEN] starting retopo source=${sourceAssetCid} faceLimit=${faceLimit ?? "adaptive"}`);
    const decimateId = await decimateTask(fileToken, key, { faceLimit });
    const taskId = registerTask({ tripoTaskId: decimateId, providerKey: key, userAddress: res.locals.userAddress });
    return res.status(202).json({ taskId, provider: "tripo3d", status: "running", retopo: true });
  }

  // retexture
  console.log(`[GEN] starting retexture source=${sourceAssetCid}`);
  const refineId = await createRefineTask(prompt, fileToken, key, { textureQuality });
  const taskId = registerTask({ tripoTaskId: refineId, providerKey: key, userAddress: res.locals.userAddress });
  return res.status(202).json({ taskId, provider: "tripo3d", status: "running", refined: true });
}
```

5. Fresh generation (bottom of the tripo3d block): replace `highQuality: Boolean(highQuality)` with `textureQuality` pass-through for both `createImageTask` and `createTask`; delete the `refineSource` variable and its lookup; the `refined: true` response flag moves to the retexture branch above.
6. GET poll handler: in the rig-check → rig advance, change `rigModelTask(entry.sourceTripoTaskId || "", …)` to `rigModelTask(entry.sourceFileToken || "", …)`. Everything else in the poll handler stays.

- [ ] **Step 4: Run tests**

Run: `npm test -- test/api.test.js`
Expected: PASS (whole file, including the Task 2 validation tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/assets/generate-node.js test/api.test.js
git commit -m "feat(api): GLB-canonical follow-up dispatch (retexture/retopo/animate)"
```

---

### Task 4: Frontend service — generateAsset new contract

**Files:**
- Modify: `frontend/src/js/services/api.js:469-685`
- Test: `test/frontend/api.test.js` (update generateAsset cases)

**Interfaces:**
- Consumes: Task 3 route contract.
- Produces: `generateAsset({ prompt, nodeId, txHash, provider, assetId, prevAssetManifestCid, transformMatrix, tier, providerKey, sourceAssetCid, sourceTaskId, retexture, retopo, animate, rigOnly, animations, faceLimit, textureQuality, imageData, imageMime, imageName })` — returns the same result object as today (`{assetManifestCid, sourceAssetCid, format, path, tier?, taskId?, providerTaskId?}`).

- [ ] **Step 1: Update the failing tests**

In `test/frontend/api.test.js`, find the generateAsset request-body tests. Replace assertions that send `refineTaskId` / `animateTaskId` / `retopoTaskId` / `highQuality` with the new fields:

```js
await generateAsset({ prompt: "rusty", nodeId: "n1", provider: "tripo3d", providerKey: "k", sourceAssetCid: "bafySource", retexture: true, textureQuality: "detailed" });
// assert fetch body:
expect(body).toMatchObject({ sourceAssetCid: "bafySource", retexture: true, textureQuality: "detailed" });
expect(body.refineTaskId).toBeUndefined();
expect(body.highQuality).toBeUndefined();
```

Delete the test covering the `REFINE_SOURCE_NOT_FOUND` fallback retry (the fallback is removed) and replace it with one asserting the error propagates:

```js
it("propagates provider errors without retrying", async () => {
  // fetch mock returns 401 PROVIDER_AUTH_FAILED
  await expect(generateAsset({ prompt: "x", nodeId: "n1", provider: "tripo3d", providerKey: "bad", sourceAssetCid: "bafyS", retexture: true }))
    .rejects.toMatchObject({ status: 401 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/frontend/api.test.js`
Expected: FAIL — service still sends the old fields / retries on REFINE_SOURCE_NOT_FOUND.

- [ ] **Step 3: Rewrite the service**

In `frontend/src/js/services/api.js`:

1. Replace the parameter list (lines 497–517) and JSDoc (469–495): drop `refineTaskId`, `animateTaskId`, `retopoTaskId`, `highQuality`; add `sourceAssetCid`, `sourceTaskId`, `retexture`, `retopo`, `animate`, `textureQuality`. Fix the stale "clean quad topology" JSDoc → "clean triangulated topology (quad output forces FBX, unusable in-app)".
2. Replace the body builder (lines 523–534):

```js
const body = {
  prompt,
  nodeId,
  provider,
  ...(chainId && { chainId }),
  ...(providerKey && { providerKey }),
  ...(sourceAssetCid && {
    sourceAssetCid,
    ...(sourceTaskId && { sourceTaskId }),
    ...(retexture && { retexture: true }),
    ...(retopo && { retopo: true, ...(faceLimit && { faceLimit }) }),
    ...(animate && { animate: true, ...(rigOnly ? { rigOnly: true } : { animations }) }),
  }),
  ...(textureQuality && { textureQuality }),
  ...(imageData && { imageData, imageMime }),
};
```

3. Delete the `REFINE_SOURCE_NOT_FOUND` fallback block (lines 545–559) — errors throw straight through.
4. The rest (polling, IPFS upload, manifest build) is unchanged.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- test/frontend/api.test.js && npm run typecheck:frontend`
Expected: PASS. Typecheck will flag the create-panel callers still passing old fields — those are fixed in Tasks 6–8; if the noise is blocking, this task's gate is the api.test.js pass only.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/api.js test/frontend/api.test.js
git commit -m "feat(frontend): generateAsset sourceAssetCid contract, drop task-id fields"
```

---

### Task 5: Create panel — texture quality selector

**Files:**
- Modify: `frontend/src/pug/app.pug:199-201`
- Modify: `frontend/src/js/ui/create-panel.js` (DOM refs, `syncProviderUI`, `onGenerate`)
- Modify: `frontend/src/scss/components/_chat.scss` (only if the select needs layout tweaks — reuse `.form-select` styles first)

**Interfaces:**
- Consumes: Task 4 `textureQuality` param.
- Produces: `#textureQualityRow` / `#textureQualitySelect` DOM ids; `getTextureQuality(): "standard"|"detailed"|"extreme"` in create-panel (module-private); localStorage key `arbesk-texture-quality`.

- [ ] **Step 1: Update the Pug template**

In `frontend/src/pug/app.pug`, replace lines 199–201 (the `highQualityRow` label) with:

```pug
#textureQualityRow.form-group(hidden)
  label.form-label(for="textureQualitySelect") Texture quality
  select#textureQualitySelect.form-select
    option(value="standard") Standard
    option(value="detailed") Detailed (slower, more credits)
    option(value="extreme") Extreme 8K (most credits)
```

- [ ] **Step 2: Update create-panel.js**

1. DOM refs: replace `highQualityRow` / `highQualityInput` (lines 98–99) with:

```js
const textureQualityRow = document.getElementById("textureQualityRow");
const textureQualitySelect = /** @type {HTMLSelectElement|null} */ (
  document.getElementById("textureQualitySelect")
);
const TEXTURE_QUALITY_STORAGE = "arbesk-texture-quality";

/**
 * Current panel texture quality for Tripo3D calls.
 * @returns {"standard"|"detailed"|"extreme"}
 */
function getTextureQuality() {
  const v = textureQualitySelect?.value;
  return v === "detailed" || v === "extreme" ? v : "standard";
}
```

2. In `syncProviderUI` (line 266): replace the `highQualityRow` line with `if (textureQualityRow) textureQualityRow.hidden = getProvider() !== "tripo3d";`
3. Hydrate + persist like the provider select (near line 283):

```js
if (textureQualitySelect) {
  const stored = localStorage.getItem(TEXTURE_QUALITY_STORAGE);
  if (stored && ["standard", "detailed", "extreme"].includes(stored)) {
    textureQualitySelect.value = stored;
  }
  textureQualitySelect.addEventListener("change", () => {
    localStorage.setItem(TEXTURE_QUALITY_STORAGE, textureQualitySelect.value);
  });
}
```

4. In `onGenerate` (line 987–988): replace the `highQuality` spread with `...(provider === "tripo3d" && { textureQuality: getTextureQuality() })`.

- [ ] **Step 3: Build + verify**

Run: `npm run build:frontend && npm test -- test/frontend/deployment-integrity.test.js && npm run typecheck:frontend`
Expected: PASS. (Typecheck errors about old generateAsset fields in create-panel are Tasks 6–8; resolve any `highQuality*` leftovers here.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pug/app.pug frontend/src/js/ui/create-panel.js frontend/dist
git commit -m "feat(panel): texture quality selector replaces HD checkbox"
```

---

### Task 6: Bubble action row + availability helper

**Files:**
- Create: `frontend/src/js/state/generation-actions.js`
- Modify: `frontend/src/js/ui/chat-messages.js` (`addAssetMessage` + new `addAssetActionRow` + `markSaved`)
- Modify: `frontend/src/scss/components/_chat.scss` (action-row styles after `.chat-asset-actions` :173)
- Test: `test/frontend/generation-actions.test.js` (new), `test/frontend/chat-messages.test.js` (extend)

**Interfaces:**
- Produces:
  - `followupActionsFor({ provider: string, task?: string }): Array<"retexture"|"retopo"|"auto-rig"|"animate">`
  - `addAssetActionRow(handle: AssetMessageHandle, actions: Array<{id: string, label: string, onPick: () => void}>): void` — renders `.chat-asset-followups` buttons with `data-action="<id>"`, appended to the bubble's `.chat-asset-actions`.
  - `AssetMessageHandle.markSaved(): void` — adds `.chat-bubble-asset-saved` and a "Saved" pill.

- [ ] **Step 1: Write the failing tests**

`test/frontend/generation-actions.test.js`:

```js
import { followupActionsFor } from "../../frontend/src/js/state/generation-actions.js";

describe("followupActionsFor", () => {
  it("returns all four actions for a plain tripo3d generation", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "model" }))
      .toEqual(["retexture", "retopo", "auto-rig", "animate"]);
  });
  it("returns all four for retopo/texture results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "retopo" })).toHaveLength(4);
    expect(followupActionsFor({ provider: "tripo3d", task: "texture" })).toHaveLength(4);
  });
  it("keeps only animate on rig-only results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "rig" })).toEqual(["animate"]);
  });
  it("returns nothing for animated results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "animate" })).toEqual([]);
  });
  it("returns nothing for the mock provider", () => {
    expect(followupActionsFor({ provider: "mock", task: "model" })).toEqual([]);
  });
});
```

Extend `test/frontend/chat-messages.test.js`:

```js
it("addAssetActionRow renders one button per action with data-action", () => {
  const handle = addAssetMessage({ prompt: "a knight", format: "glb" });
  const picks = [];
  addAssetActionRow(handle, [
    { id: "retexture", label: "Retexture", onPick: () => picks.push("retexture") },
    { id: "animate", label: "Animate…", onPick: () => picks.push("animate") },
  ]);
  const btns = handle.bubble.querySelectorAll(".chat-asset-followups [data-action]");
  expect([...btns].map((b) => b.dataset.action)).toEqual(["retexture", "animate"]);
  btns[0].click();
  expect(picks).toEqual(["retexture"]);
});

it("markSaved annotates the bubble", () => {
  const handle = addAssetMessage({ prompt: "a knight", format: "glb" });
  handle.markSaved();
  expect(handle.bubble.classList.contains("chat-bubble-asset-saved")).toBe(true);
  expect(handle.bubble.querySelector(".chat-asset-saved-pill")?.textContent).toBe("Saved");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/frontend/generation-actions.test.js test/frontend/chat-messages.test.js`
Expected: FAIL — module/functions don't exist.

- [ ] **Step 3: Implement**

`frontend/src/js/state/generation-actions.js`:

```js
/**
 * Follow-up action availability for a generation bubble.
 * Animated results are terminal (re-rigging an animated GLB is pointless);
 * rig-only results keep only Animate (retarget finishes them — retopo would
 * strip the skeleton, re-rigging duplicates it).
 * @param {{provider: string, task?: string}} record
 * @returns {Array<"retexture"|"retopo"|"auto-rig"|"animate">}
 */
export function followupActionsFor({ provider, task }) {
  if (provider !== "tripo3d") return [];
  if (task === "animate") return [];
  if (task === "rig") return ["animate"];
  return ["retexture", "retopo", "auto-rig", "animate"];
}
```

In `chat-messages.js`, after `addAssetMessage`:

```js
/**
 * Append a compact follow-up action row (Retexture · Retopo · Auto-rig ·
 * Animate…) to an asset bubble's action area.
 * @param {AssetMessageHandle} handle
 * @param {Array<{id: string, label: string, onPick: () => void}>} actions
 */
export function addAssetActionRow(handle, actions) {
  const actionsEl = handle.bubble.querySelector(".chat-asset-actions");
  if (!actionsEl || actions.length === 0) return;
  const row = document.createElement("div");
  row.className = "chat-asset-followups";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary chat-asset-followup-btn";
    btn.dataset.action = action.id;
    btn.textContent = action.label;
    btn.addEventListener("click", action.onPick);
    row.appendChild(btn);
  }
  actionsEl.appendChild(row);
}
```

Add `markSaved` to the returned handle in `addAssetMessage` (next to `markSent`):

```js
markSaved() {
  if (bubble.classList.contains("chat-bubble-asset-saved")) return;
  bubble.classList.add("chat-bubble-asset-saved");
  const pill = document.createElement("span");
  pill.className = "chat-asset-saved-pill";
  pill.textContent = "Saved";
  caption.appendChild(pill);
},
```

Update the `AssetMessageHandle` typedef with `markSaved`. In `_chat.scss` after `.chat-asset-actions` (:173):

```scss
.chat-asset-followups {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-1);
  margin-top: var(--size-1);
}

.chat-asset-saved-pill {
  margin-left: var(--size-2);
  padding: 0 var(--size-1);
  border-radius: var(--radius-pill, 999px);
  background: var(--success-bg, #2e7d32);
  color: #fff;
  font-size: 0.75em;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- test/frontend/generation-actions.test.js test/frontend/chat-messages.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/state/generation-actions.js frontend/src/js/ui/chat-messages.js frontend/src/scss/components/_chat.scss test/frontend/generation-actions.test.js test/frontend/chat-messages.test.js
git commit -m "feat(chat): version-card action row + saved pill + availability helper"
```

---

### Task 7: Create panel — follow-up handlers replace choice chips

**Files:**
- Modify: `frontend/src/js/ui/create-panel.js` (replace `ANIMATE_CHOICES`, `addAnimateChoices`, `onRetopo`, `onAnimate`; add `onRetexture`, `onAutoRig`)

**Interfaces:**
- Consumes: Task 6 `followupActionsFor` + `addAssetActionRow`; Task 4 generateAsset contract; existing `showCheckboxDialog` / `showCustomDialog` (`frontend/src/js/ui/dialog.js:293,366`).
- Produces: module-private `onRetexture(generationId)`, `onRetopo(generationId)`, `onAutoRig(generationId)`, `onAnimate(generationId)` — all read `getPendingGeneration(generationId)` for `sourceAssetCid` + `backendTaskId` (the latter passed as `sourceTaskId` for the retarget-only shortcut).

- [ ] **Step 1: Replace the choices block**

Delete `ANIMATE_CHOICES` (lines 575–583). Keep `ANIMATE_PRESETS` (585–591). Replace `addAnimateChoices` (639–661) with:

```js
/**
 * Attach the version-card action row to a generation bubble. Availability
 * comes from followupActionsFor; each action runs against the bubble's own
 * GLB (sourceAssetCid), so any bubble stays actionable indefinitely.
 * @param {string} generationId
 */
function addFollowupActions(generationId) {
  const record = getPendingGeneration(generationId);
  const assetMessage = assetMessages.get(generationId);
  if (!record || !assetMessage) return;
  const ACTION_DEFS = {
    retexture: { label: "Retexture", run: () => void onRetexture(generationId) },
    retopo: { label: "Retopo", run: () => void onRetopo(generationId) },
    "auto-rig": { label: "Auto-rig", run: () => void onAutoRig(generationId) },
    animate: { label: "Animate…", run: () => void onAnimate(generationId) },
  };
  const actions = followupActionsFor(record).map((id) => ({
    id,
    label: ACTION_DEFS[id].label,
    onPick: ACTION_DEFS[id].run,
  }));
  addAssetActionRow(assetMessage, actions);
}
```

Import `followupActionsFor` from `../state/generation-actions.js` and `addAssetActionRow` from `./chat-messages.js`. In `presentGenerationResult` (line 628): replace the `if (provider === "tripo3d" && task !== "animate") addAnimateChoices(generationId);` call with `addFollowupActions(generationId);` (the helper itself gates by provider/task).

- [ ] **Step 2: Rewrite the handlers**

`onRetopo` (670–748): change the `generateAsset` call to:

```js
const result = await generateAsset({
  prompt,
  nodeId,
  provider: "tripo3d",
  providerKey: getByokKey(),
  sourceAssetCid: record.sourceAssetCid,
  retopo: true,
  ...(faceLimit && { faceLimit }),
  prevAssetManifestCid,
  transformMatrix,
  tier: getTier(),
});
```

and drop the `RETOPO_SOURCE_NOT_FOUND` branch from its error mapping. Add a face-limit picker at the top of `onRetopo`:

```js
const faceLimit = await showFaceLimitDialog();
if (faceLimit === null) return; // cancelled
```

Implement `showFaceLimitDialog()` next to it, using `showCustomDialog`:

```js
/**
 * Polygon-budget dialog for retopo. Returns the face limit, undefined for
 * adaptive, or null when cancelled.
 * @returns {Promise<number|undefined|null>}
 */
function showFaceLimitDialog() {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p style="margin:0 0 var(--size-2)">Target polygon count (500–20,000 triangles). Leave empty for adaptive — adaptive is aggressive and can melt faces.</p>
      <div class="form-group">
        <label class="form-label" for="faceLimitInput">Polygon budget</label>
        <input id="faceLimitInput" class="form-control" type="number" min="500" max="20000" step="100" value="20000">
      </div>
      <button id="faceLimitGo" class="btn btn-primary" type="button" style="margin-top:var(--size-2)">Retopo</button>`;
    const input = /** @type {HTMLInputElement} */ (wrap.querySelector("#faceLimitInput"));
    wrap.querySelector("#faceLimitGo").addEventListener("click", () => {
      const raw = input.value.trim();
      if (raw === "") { resolve(undefined); return; }
      const n = Number(raw);
      resolve(Number.isInteger(n) && n >= 500 && n <= 20000 ? n : 20000);
    });
    showCustomDialog("Retopo — polygon budget", wrap).then(() => resolve(null));
  });
}
```

(If `showCustomDialog`'s promise only resolves on close, resolve(null) there and resolve earlier on the button — matches the pattern used by `buildProviderKeyBody`.)

Add `onRetexture`:

```js
/**
 * Retexture a generation bubble: texture prompt dialog → texture-only
 * refine of the bubble's GLB → new chat bubble.
 * @param {string} generationId
 */
async function onRetexture(generationId) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  const texturePrompt = await showTexturePromptDialog();
  if (!texturePrompt) return;
  if (!walletState.get().walletAddress) { alert("Please log in or sign up first."); return; }
  try { await getOrCreateSession(); } catch {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to retexture assets." });
    return;
  }
  addChatMessage("user", `Retexture: ${texturePrompt}`);
  const working = addWorkingMessage("Retexturing — this takes a minute or two…");
  const assetName = getAssetName();
  const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_retex_${Date.now()}`;
  const prevAssetManifestCid = assetState.get().activeAssetManifestCid || undefined;
  const transformMatrix = buildTransformMatrix();
  try {
    const result = await generateAsset({
      prompt: texturePrompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      retexture: true,
      textureQuality: getTextureQuality(),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
    });
    presentGenerationResult(result, { prompt: `Retexture: ${texturePrompt}`, provider: "tripo3d", task: "texture", prevAssetManifestCid, transformMatrix });
    dismissCreatePulse();
    refreshProviderBalance({ force: true });
  } catch (err) {
    console.error("Retexture failed:", err);
    addChatMessage("system", err instanceof ApiError && err.message ? err.message : "Retexture failed. Please try again.");
  } finally {
    working?.remove();
  }
}
```

With `showTexturePromptDialog()` — same `showCustomDialog` pattern: a textarea + "Retexture" button, resolve the trimmed text (or null on close/empty).

Add `onAutoRig` — identical tail to `onAnimate` but no dialog and `rigOnly: true`:

```js
async function onAutoRig(generationId) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }
  try {
    await getOrCreateSession();
  } catch {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to rig assets." });
    return;
  }
  const prompt = "Auto-rig";
  addChatMessage("user", prompt);
  const working = addWorkingMessage("Rigging — checking compatibility, then building the skeleton…");
  const assetName = getAssetName();
  const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_rig_${Date.now()}`;
  const prevAssetManifestCid = assetState.get().activeAssetManifestCid || undefined;
  const transformMatrix = buildTransformMatrix();
  try {
    const result = await generateAsset({
      prompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      animate: true,
      rigOnly: true,
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
    });
    presentGenerationResult(result, { prompt, provider: "tripo3d", task: "rig", prevAssetManifestCid, transformMatrix });
    dismissCreatePulse();
    refreshProviderBalance({ force: true });
  } catch (err) {
    console.error("Auto-rig failed:", err);
    let userMsg = "Rigging failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "MODEL_NOT_RIGGABLE") {
        userMsg = "This model isn't riggable. Generate a full-body humanoid or creature (T-pose works best) and try again.";
      } else if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.message) {
        userMsg = err.message;
      }
    }
    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
  }
}
```

`onAnimate(generationId)` (drop the `presets` parameter and the rig-only branch — auto-rig is separate now): open `showCheckboxDialog` with `ANIMATE_PRESETS`, then call `generateAsset` with `sourceAssetCid: record.sourceAssetCid, sourceTaskId: record.backendTaskId, animate: true, animations: presets`. Tag rigged-source results as today. **Delete** the post-animation recovery `addChoiceMessage` block (lines 833–839) — bubble-click restore (Task 8) replaces it. Delete `MODEL_NOT_RIGGABLE` stays; delete the `ANIMATE_SOURCE_NOT_FOUND` error branch.

- [ ] **Step 3: Verify**

Run: `npm run build:frontend && npm run typecheck:frontend && npm run lint`
Expected: clean (create-panel is `@ts-nocheck`, so lint + build are the gate). Also `npm test -- test/frontend/chat-messages.test.js test/frontend/generation-actions.test.js` still PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/ui/create-panel.js frontend/dist
git commit -m "feat(panel): version-card follow-up handlers replace choice chips"
```

---

### Task 8: Active version, typed retexture, click-to-restore

**Files:**
- Modify: `frontend/src/pug/app.pug` (refine indicator above `.messagebar-row` :206)
- Modify: `frontend/src/js/ui/create-panel.js` (active-version state, `onGenerate`, `sendGenerationToStudio`, `restoreGeneration`, event wiring)
- Modify: `frontend/src/js/ui/chat-history.js` (clickable history versions)
- Modify: `frontend/src/js/events/bus.js:20-59` (one new event constant)
- Test: `test/frontend/chat-history.test.js` (extend)

**Interfaces:**
- Consumes: `walkManifestChain` entries `{cid, version, chat, sourceCid, …}` (`frontend/src/js/engine/time-travel.js:122`); Task 6 pieces.
- Produces: `EVENTS.HISTORY_VERSION_SELECTED = "asset:historyVersionSelected"`; history bubbles carry `data-manifest-cid`; create-panel module-private `setActiveVersion({sourceAssetCid, manifestCid, name} | null)`.

- [ ] **Step 1: Refine indicator in Pug**

In `app.pug`, directly above `.messagebar-row` (:206):

```pug
#refineIndicator.refine-indicator(hidden)
  span#refineIndicatorText.refine-indicator-text
  button#refineIndicatorDetach.refine-indicator-detach(type="button" aria-label="Detach — next prompt starts a new model") &times;
```

Add styles in `_chat.scss`:

```scss
.refine-indicator {
  display: flex;
  align-items: center;
  gap: var(--size-1);
  margin-bottom: var(--size-1);
  font-size: 0.85em;
  color: var(--text-secondary);
}
.refine-indicator-detach {
  border: 0;
  background: none;
  cursor: pointer;
  color: inherit;
}
```

- [ ] **Step 2: Active-version state in create-panel**

Replace `lastTripoTaskId` (lines 416–423) with:

```js
/**
 * Active version for typed-prompt retexture. Set on generation result,
 * Show-in-Studio, and bubble/history restore; cleared by detach, Clear
 * Chat, and asset switch. The GLB CID is the durable reference — no expiry.
 * @type {{sourceAssetCid: string, manifestCid: string|null, name: string} | null}
 */
let activeVersion = null;

const refineIndicator = document.getElementById("refineIndicator");
const refineIndicatorText = document.getElementById("refineIndicatorText");
const refineIndicatorDetach = document.getElementById("refineIndicatorDetach");

/**
 * @param {{sourceAssetCid: string, manifestCid: string|null, name: string} | null} version
 */
function setActiveVersion(version) {
  activeVersion = version;
  if (!refineIndicator || !refineIndicatorText) return;
  refineIndicator.hidden = !version;
  if (version) refineIndicatorText.textContent = `Refining: ${version.name}`;
}

refineIndicatorDetach?.addEventListener("click", () => setActiveVersion(null));
```

Update `clearChat` (line 430): `setActiveVersion(null)` instead of `lastTripoTaskId = null`.

In `onGenerate`: replace the `refineTaskId` block (lines 961–974) with:

```js
// Typed follow-ups retexture the active version (texture/material only —
// geometry unchanged). Detach, Clear Chat, or an attached image starts fresh.
const retextureSource =
  provider === "tripo3d" && activeVersion && !imagePayload
    ? activeVersion
    : null;
if (retextureSource) {
  addChatMessage("system", `Refining "${retextureSource.name}" (texture/material only — geometry unchanged)…`);
}
```

and in the `generateAsset` call replace the refine spread with:

```js
...(retextureSource && { sourceAssetCid: retextureSource.sourceAssetCid, retexture: true }),
...(provider === "tripo3d" && { textureQuality: getTextureQuality() }),
```

Replace the `lastTripoTaskId = result.taskId` update (lines 991–993) with: in `presentGenerationResult`, after registering, call `setActiveVersion({ sourceAssetCid: result.sourceAssetCid, manifestCid: result.assetManifestCid, name: prompt })` when `provider === "tripo3d"`.

- [ ] **Step 3: Click-to-restore**

In `presentGenerationResult`, make the preview clickable:

```js
assetMessage.bubble.querySelector(".chat-asset-preview")?.addEventListener("click", () => {
  void restoreGeneration(generationId);
});
```

`restoreGeneration` (874–886): after `sendGenerationToStudio` succeeds, call `setActiveVersion({ sourceAssetCid: record.sourceAssetCid, manifestCid: record.assetManifestCid, name: record.prompt })` when `record.provider === "tripo3d"`. In `sendGenerationToStudio`, after the successful `loadAssetManifest`, also set the active version the same way.

History bubbles — in `chat-history.js`, extend the provenance loop (lines 61–74): `walkManifestChain` already returns `{cid, chat, sourceCid}` per version, so render one clickable bubble per version that has a chat prompt. `addChatMessage` returns void, so grab the just-appended element via `lastElementChild`:

```js
for (const entry of chain) {
  const chats = Array.isArray(entry.chat) ? entry.chat : entry.chat ? [entry.chat] : [];
  const latest = chats[chats.length - 1];
  if (!latest?.prompt) continue;
  const label = latest.task && latest.task !== "model" ? ` (${latest.task})` : "";
  addChatMessage("user", `${latest.prompt}${label}`, {
    timestamp: new Date((latest.timestamp || 0) * 1000),
    extraClass: "chat-bubble-history chat-bubble-version",
  });
  const target = /** @type {HTMLElement|null} */ (
    document.getElementById("chatHistoryList")?.lastElementChild
  );
  if (target) {
    target.dataset.manifestCid = entry.cid;
    if (entry.sourceCid) target.dataset.sourceCid = entry.sourceCid;
    target.addEventListener("click", () => {
      emit(EVENTS.HISTORY_VERSION_SELECTED, { cid: entry.cid, sourceCid: entry.sourceCid, name: latest.prompt });
    });
  }
}
```

Import `emit, EVENTS` from `../events/bus.js` in chat-history.js. Add `HISTORY_VERSION_SELECTED: "asset:historyVersionSelected"` to `EVENTS` in `bus.js`. In create-panel:

```js
on(EVENTS.HISTORY_VERSION_SELECTED, async ({ cid, sourceCid, name }) => {
  try {
    assetState.set({ activeAssetManifestCid: cid, latestAssetManifestCid: cid });
    await loadAssetManifest(cid);
    if (sourceCid) setActiveVersion({ sourceAssetCid: sourceCid, manifestCid: cid, name });
  } catch (err) {
    console.error("Version restore failed:", err);
    addChatMessage("system", "Could not load that version.");
  }
});
```

- [ ] **Step 4: Tests**

Extend `test/frontend/chat-history.test.js`: assert history bubbles get `data-manifest-cid` and clicking one emits `HISTORY_VERSION_SELECTED` with the entry's cid/sourceCid (the file already mocks `walkManifestChain` — extend the mock entries with `sourceCid`).

Run: `npm test -- test/frontend/chat-history.test.js && npm run build:frontend && npm run typecheck:frontend && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/create-panel.js frontend/src/js/ui/chat-history.js frontend/src/js/events/bus.js frontend/src/pug/app.pug frontend/src/scss/components/_chat.scss test/frontend/chat-history.test.js frontend/dist
git commit -m "feat(chat): active-version retexture + click-to-restore versions"
```

---

### Task 9: Auto-save on Show in Studio + E2E sync + full verification

**Files:**
- Modify: `frontend/src/js/ui/create-panel.js` (`sendGenerationToStudio`)
- Modify: `e2e/helpers/studio-selectors.mjs:19-26`
- Create: `e2e/specs/chat-version-restore.spec.js`
- Modify: `AGENTS.md` (§1 generation bullet: action row, GLB follow-ups, auto-save)

**Interfaces:**
- Consumes: `onSaveAssetDraft` from `frontend/src/js/ui/asset-save.js:403` (no import cycle: asset-save imports services/api, not create-panel); Task 6 `markSaved`.

- [ ] **Step 1: Auto-save**

In `sendGenerationToStudio` (create-panel.js:473), after `assetMessage.markSent(snapshot)`:

```js
// Show in Studio is an explicit "keep this version" — save a draft so the
// bubble stays restorable. Publish remains a separate, manual action.
try {
  await onSaveAssetDraft();
  assetMessage.markSaved();
} catch (err) {
  console.error("Auto-save after Show in Studio failed:", err);
  addChatMessage("system", "Auto-save failed — use the Save button to retry.");
}
```

Import: `import { onSaveAssetDraft } from "./asset-save.js";`

- [ ] **Step 2: E2E selectors**

In `e2e/helpers/studio-selectors.mjs`, after `assetBubbleSend`:

```js
assetBubbleFollowups: ".chat-bubble-asset .chat-asset-followups",
assetBubbleAction: (action) => `.chat-bubble-asset [data-action="${action}"]`,
assetBubbleSaved: ".chat-bubble-asset.chat-bubble-asset-saved",
refineIndicator: "#refineIndicator",
versionBubble: ".chat-bubble-version",
```

- [ ] **Step 3: E2E spec (mock provider — no BYOK needed)**

`e2e/specs/chat-version-restore.spec.js` — flow: connect wallet → generate "box" (mock) → click Show in Studio → expect `assetBubbleSaved` (auto-save) → generate a second model → Show in Studio → click the first bubble's preview → expect the scene outliner / chat system message to reflect the first version restored. Reuse `e2e/helpers/flows.mjs` generation helpers; assert `refineIndicator` is hidden for the mock provider.

- [ ] **Step 4: Docs sync**

Update `AGENTS.md` §1 "3D generation" bullet: replace the retopo/rig-chain description with the version-card model (action row: Retexture · Retopo · Auto-rig · Animate…; follow-ups reference the GLB via `sourceAssetCid` → Tripo `file_token`, no registry expiry; panel texture-quality selector; Show in Studio auto-saves a draft).

- [ ] **Step 5: Full verification**

```bash
npm run build:frontend
npm run test:all            # lint → typecheck → frontend → api → contracts
npm run test:e2e -- --project=chromium
```

Expected: all green. If E2E infrastructure is unavailable in the execution environment, run at minimum `npm test` + `npm run test:frontend` + the new spec against `./scripts/start-dev.sh --setup-only`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/create-panel.js e2e/ AGENTS.md frontend/dist
git commit -m "feat(chat): auto-save on Show in Studio + E2E version-restore coverage"
```

---

## Self-Review Notes

- **Spec coverage:** bubble action row (T6/T7) · GLB/file_token backend (T1–T3) · frontend contract (T4) · panel quality (T5) · active version + typed retexture (T8) · auto-save + click-restore (T8/T9) · error handling `SOURCE_ASSET_UNAVAILABLE` (T3) · stale comment fixes (T4) · AGENTS.md sync (T9). Retarget-only shortcut preserved via optional `sourceTaskId` (T3) — the one place the registry is still consulted, since Tripo retarget requires a rig task ID and cannot take a GLB.
- **Known limitation (accepted in spec):** animating an auto-rig result more than 1 hour later re-runs the full rig chain on the GLB instead of retarget-only — Tripo retarget cannot take a mesh input.

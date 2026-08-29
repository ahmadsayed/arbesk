/**
 * besk generation commands: all AI generation ops go through one backend route
 * (POST /api/v1/generations, op selected by body fields) with async tasks polled
 * via GET /api/v1/generations/:taskId. These tests pin the request bodies the
 * CLI sends for each op, the poll/timeout/error behavior, and the source-CID
 * resolution for follow-up ops (retexture/retopo/rig/animate).
 */
import { jest } from "@jest/globals";

const manifests = {};
jest.unstable_mockModule("../packages/besk/src/catalog.ts", () => ({
  getManifest: jest.fn(async (cid) => {
    if (!(cid in manifests)) throw new Error("unknown cid " + cid);
    return structuredClone(manifests[cid]);
  }),
}));

const {
  runGeneration,
  cancelGeneration,
  getProviderBalance,
  resolveSourceCid,
} = await import("../packages/besk/src/generate.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };
const GLB_B64 = Buffer.from("glb-binary-bytes").toString("base64");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Stub global fetch with a handler(url, opts) → Response. Returns recorded calls. */
function stubFetch(handler) {
  const calls = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method ?? "GET", headers: opts?.headers, body: opts?.body ? JSON.parse(opts.body) : undefined });
    return handler(String(url), opts);
  });
  return calls;
}

afterEach(() => {
  jest.restoreAllMocks();
  for (const k of Object.keys(manifests)) delete manifests[k];
});

describe("runGeneration", () => {
  test("mock text-to-3d: sync 200, decodes assetData, sends session header", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ assetData: GLB_B64, format: "gltf", path: "asset.gltf", provider: "mock" }));

    const out = await runGeneration(SESSION, { prompt: "a red cube", nodeId: "n1", provider: "mock" });

    expect(Buffer.from(out.bytes).toString()).toBe("glb-binary-bytes");
    expect(out.format).toBe("gltf");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/api/v1/generations");
    expect(calls[0].headers.Authorization).toBe("Session t");
    expect(calls[0].body).toMatchObject({ prompt: "a red cube", nodeId: "n1", provider: "mock" });
  });

  test("tripo3d async: 202 taskId → polls until success, returns GLB bytes", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/api/v1/generations")) {
        return jsonResponse({ taskId: "task-1", provider: "tripo3d", status: "running" }, 202);
      }
      if (url.endsWith("/api/v1/generations/task-1")) {
        const polls = calls.filter((c) => c.method === "GET").length;
        if (polls === 1) return jsonResponse({ status: "running", progress: 40, stage: "Rigging skeleton" });
        return jsonResponse({ status: "success", assetData: GLB_B64, format: "glb", path: "asset.glb", provider: "tripo3d" });
      }
      throw new Error("unexpected url " + url);
    });

    const progress = [];
    const out = await runGeneration(SESSION, { prompt: "a red cube", nodeId: "n1", provider: "tripo3d", providerKey: "tsk_x" },
      { intervalMs: 1, onProgress: (p) => progress.push(p) });

    expect(out.format).toBe("glb");
    expect(Buffer.from(out.bytes).toString()).toBe("glb-binary-bytes");
    const gets = calls.filter((c) => c.method === "GET");
    expect(gets).toHaveLength(2);
    expect(gets[0].headers.Authorization).toBe("Session t");
    expect(progress).toContainEqual({ status: "running", progress: 40, stage: "Rigging skeleton" });
  });

  test("throws the provider message when the task fails", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/generations")
        ? jsonResponse({ taskId: "task-2" }, 202)
        : jsonResponse({ status: "failed", error: { code: "MODEL_NOT_RIGGABLE", message: "model is not riggable" } }));

    await expect(
      runGeneration(SESSION, { prompt: "x", nodeId: "n1" }, { intervalMs: 1 }),
    ).rejects.toThrow("model is not riggable");
  });

  test("throws when the task disappears mid-poll (404)", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/generations")
        ? jsonResponse({ taskId: "task-3" }, 202)
        : jsonResponse({ error: { code: "GENERATION_TASK_NOT_FOUND", message: "gone" } }, 404));

    await expect(
      runGeneration(SESSION, { prompt: "x", nodeId: "n1" }, { intervalMs: 1 }),
    ).rejects.toThrow("gone");
  });

  test("times out when the task never finishes", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/generations")
        ? jsonResponse({ taskId: "task-4" }, 202)
        : jsonResponse({ status: "running", progress: 10 }));

    await expect(
      runGeneration(SESSION, { prompt: "x", nodeId: "n1" }, { intervalMs: 1, timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);
  });

  test("surfaces backend error messages on non-OK POST", async () => {
    stubFetch(() => jsonResponse({ error: { code: "MISSING_PROVIDER_KEY", message: "providerKey is required" } }, 400));
    await expect(
      runGeneration(SESSION, { prompt: "x", nodeId: "n1", provider: "tripo3d" }),
    ).rejects.toThrow("providerKey is required");
  });

  test("image-to-3d body carries base64 imageData + imageMime", async () => {
    const calls = stubFetch(() => jsonResponse({ assetData: GLB_B64, format: "glb", provider: "tripo3d" }));
    await runGeneration(SESSION, {
      nodeId: "n1", provider: "tripo3d", providerKey: "k",
      imageData: "aW1hZ2U=", imageMime: "image/png", textureQuality: "detailed",
    });
    expect(calls[0].body).toMatchObject({
      imageData: "aW1hZ2U=", imageMime: "image/png", textureQuality: "detailed",
    });
  });

  test("multiview body carries images[] with orientations", async () => {
    const calls = stubFetch(() => jsonResponse({ assetData: GLB_B64, format: "glb", provider: "tripo3d" }));
    await runGeneration(SESSION, {
      nodeId: "n1", provider: "tripo3d", providerKey: "k",
      images: [
        { imageData: "ZnJvbnQ=", imageMime: "image/png", view: "front" },
        { imageData: "bGVmdA==", imageMime: "image/jpeg", view: "left" },
      ],
    });
    expect(calls[0].body.images).toEqual([
      { imageData: "ZnJvbnQ=", imageMime: "image/png", view: "front" },
      { imageData: "bGVmdA==", imageMime: "image/jpeg", view: "left" },
    ]);
  });

  test("retexture body: sourceAssetCid + retexture + prompt", async () => {
    const calls = stubFetch(() => jsonResponse({ assetData: GLB_B64, format: "glb", provider: "tripo3d" }));
    await runGeneration(SESSION, {
      nodeId: "n1", provider: "tripo3d", providerKey: "k",
      sourceAssetCid: "bafySrc", retexture: true, prompt: "rusted metal", textureQuality: "extreme",
    });
    expect(calls[0].body).toMatchObject({
      sourceAssetCid: "bafySrc", retexture: true, prompt: "rusted metal", textureQuality: "extreme",
    });
  });

  test("retopo body: sourceAssetCid + retopo + faceLimit", async () => {
    const calls = stubFetch(() => jsonResponse({ assetData: GLB_B64, format: "glb", provider: "tripo3d" }));
    await runGeneration(SESSION, {
      nodeId: "n1", provider: "tripo3d", providerKey: "k",
      sourceAssetCid: "bafySrc", retopo: true, faceLimit: 5000,
    });
    expect(calls[0].body).toMatchObject({ sourceAssetCid: "bafySrc", retopo: true, faceLimit: 5000 });
  });

  test("rig body: animate + rigOnly", async () => {
    const calls = stubFetch(() => jsonResponse({ assetData: GLB_B64, format: "glb", provider: "tripo3d" }));
    await runGeneration(SESSION, {
      nodeId: "n1", provider: "tripo3d", providerKey: "k",
      sourceAssetCid: "bafySrc", animate: true, rigOnly: true,
    });
    expect(calls[0].body).toMatchObject({ sourceAssetCid: "bafySrc", animate: true, rigOnly: true });
  });

  test("animate body: animations list + animateInPlace", async () => {
    const calls = stubFetch(() => jsonResponse({ assetData: GLB_B64, format: "glb", provider: "tripo3d" }));
    await runGeneration(SESSION, {
      nodeId: "n1", provider: "tripo3d", providerKey: "k",
      sourceAssetCid: "bafySrc", animate: true,
      animations: ["preset:idle", "preset:biped:dance_01"], animateInPlace: false,
    });
    expect(calls[0].body).toMatchObject({
      sourceAssetCid: "bafySrc", animate: true,
      animations: ["preset:idle", "preset:biped:dance_01"], animateInPlace: false,
    });
  });
});

describe("cancelGeneration", () => {
  test("DELETEs the task and reports upstream cancellation", async () => {
    const calls = stubFetch(() => jsonResponse({ status: "cancelled", upstreamCancelled: true }));
    const out = await cancelGeneration(SESSION, "task-9");
    expect(out).toEqual({ status: "cancelled", upstreamCancelled: true });
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toContain("/api/v1/generations/task-9");
    expect(calls[0].headers.Authorization).toBe("Session t");
  });
});

describe("getProviderBalance", () => {
  test("POSTs the provider key and returns the balance", async () => {
    const calls = stubFetch(() => jsonResponse({ balance: 12.5, frozen: 1 }));
    const out = await getProviderBalance(SESSION, "tsk_x");
    expect(out).toEqual({ balance: 12.5, frozen: 1 });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/api/v1/generations/balance");
    expect(calls[0].body).toEqual({ providerKey: "tsk_x" });
  });

  test("surfaces auth failures", async () => {
    stubFetch(() => jsonResponse({ error: { code: "PROVIDER_AUTH_FAILED", message: "bad key" } }, 401));
    await expect(getProviderBalance(SESSION, "tsk_bad")).rejects.toThrow("bad key");
  });
});

describe("resolveSourceCid", () => {
  test("unwraps a Studio asset manifest to its composite source CID", async () => {
    manifests.bafyWrapper = {
      type: "asset", name: "robot", scene: { nodes: [{ node_id: "n1", source: { cid: "bafyComposite" } }] },
    };
    await expect(resolveSourceCid("bafyWrapper")).resolves.toBe("bafyComposite");
  });

  test("returns the CID itself for a raw composite glTF (CLI upload)", async () => {
    manifests.bafyRaw = { asset: { version: "2.0" }, meshes: [], buffers: [] };
    await expect(resolveSourceCid("bafyRaw")).resolves.toBe("bafyRaw");
  });
});

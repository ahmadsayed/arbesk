import { jest } from "@jest/globals";
import {
  createTask,
  createImageTask,
  createMultiviewTask,
  createRefineTask,
  uploadImage,
  uploadModel,
  getBalance,
  decimateTask,
  rigCheckTask,
  rigModelTask,
  retargetTask,
  pollTask,
  downloadModel,
  cancelTask,
  TripoApiError,
} from "../../src/api/adapters/tripo3d-adapter.js";

const key = "tsk_test_secret_key_xyz";

describe("tripo3d adapter", () => {
  beforeEach(() => {
    jest.spyOn(global, "fetch").mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("createTask submits text-to-model with v3 defaults", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_abc" } }),
    });
    const id = await createTask("a red cube", key);
    expect(id).toBe("task_abc");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/generation/text-to-model");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      prompt: "a red cube",
      model: "v3.1-20260211",
      texture: true,
      pbr: true,
    });
  });

  test("createTask throws TripoApiError with code on auth failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 1002, message: "Authentication failed" }),
    });
    await expect(createTask("x", key)).rejects.toMatchObject({
      code: 1002,
      status: 401,
    });
  });

  test("createTask throws TripoApiError 402 on insufficient credits", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 2010,
        message: "You don't have enough credit",
      }),
    });
    await expect(createTask("x", key)).rejects.toMatchObject({
      code: 2010,
      status: 402,
    });
  });

  test("unknown Tripo error code maps to HTTP 502 in TripoApiError", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 1234, message: "Unknown provider error" }),
    });
    await expect(createTask("x", key)).rejects.toMatchObject({
      code: 1234,
      status: 502,
    });
  });

  test("createTask maps HTTP 401 to TripoApiError status 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    await expect(createTask("x", key)).rejects.toMatchObject({
      code: 0,
      status: 401,
    });
  });

  test("createTask maps HTTP 500 to TripoApiError status 502", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    await expect(createTask("x", key)).rejects.toMatchObject({
      code: 0,
      status: 502,
    });
  });

  test("createTask collapses unexpected HTTP statuses (e.g. 429) to 502", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
    });
    await expect(createTask("x", key)).rejects.toMatchObject({
      code: 0,
      status: 502,
    });
  });

  test("createTask rejects empty prompt with status 400", async () => {
    await expect(createTask("", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("uploadImage posts multipart form to /files and returns file_token", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { file_token: "ftok_123" } }),
    });
    const token = await uploadImage(Buffer.from("png-bytes"), "image/png", key);
    expect(token).toBe("ftok_123");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/files");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
    // Multipart: no manual Content-Type (fetch sets the boundary).
    expect(opts.headers["Content-Type"]).toBeUndefined();
    expect(opts.body).toBeInstanceOf(FormData);
  });

  test("uploadImage rejects empty buffer with status 400", async () => {
    await expect(uploadImage(Buffer.alloc(0), "image/png", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("createImageTask submits generation/image-to-model with the file token", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_img" } }),
    });
    const id = await createImageTask("ftok_123", key);
    expect(id).toBe("task_img");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/generation/image-to-model");
    expect(JSON.parse(opts.body)).toEqual({
      file: { file_token: "ftok_123" },
      model: "v3.1-20260211",
      texture: true,
      pbr: true,
      auto_size: true,
    });
  });

  test("createImageTask rejects empty fileToken with status 400", async () => {
    await expect(createImageTask("", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("createMultiviewTask submits generation/multiview-to-model with canonical view order", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_mv" } }),
    });
    const id = await createMultiviewTask(
      { back: "ftok_b", front: "ftok_f", right: "ftok_r", left: "ftok_l" },
      key,
    );
    expect(id).toBe("task_mv");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/generation/multiview-to-model");
    expect(JSON.parse(opts.body)).toEqual({
      inputs: [
        { front: "ftok_f" },
        { left: "ftok_l" },
        { back: "ftok_b" },
        { right: "ftok_r" },
      ],
      model: "v3.1-20260211",
      texture: true,
      pbr: true,
      auto_size: true,
    });
  });

  test("createMultiviewTask skips absent views and keeps canonical order", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_mv2" } }),
    });
    await createMultiviewTask({ back: "ftok_b", front: "ftok_f" }, key);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).inputs).toEqual([
      { front: "ftok_f" },
      { back: "ftok_b" },
    ]);
  });

  test("createMultiviewTask passes texture_quality through", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_mv3" } }),
    });
    await createMultiviewTask({ front: "ftok_f", left: "ftok_l" }, key, {
      textureQuality: "detailed",
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).texture_quality).toBe("detailed");
  });

  test("createMultiviewTask rejects a missing front view without calling fetch", async () => {
    global.fetch = jest.fn();
    await expect(
      createMultiviewTask({ left: "ftok_l", back: "ftok_b" }, key),
    ).rejects.toMatchObject({ code: 0, status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("createMultiviewTask rejects a single view without calling fetch", async () => {
    global.fetch = jest.fn();
    await expect(
      createMultiviewTask({ front: "ftok_f" }, key),
    ).rejects.toMatchObject({ code: 0, status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("createMultiviewTask rejects an unknown view key without calling fetch", async () => {
    global.fetch = jest.fn();
    await expect(
      createMultiviewTask(
        /** @type {any} */ ({ front: "ftok_f", left: "ftok_l", top: "ftok_t" }),
        key,
      ),
    ).rejects.toMatchObject({ code: 0, status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("createMultiviewTask maps upstream non-zero codes like the other methods", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 2010, message: "insufficient credits" }),
    });
    await expect(
      createMultiviewTask({ front: "ftok_f", left: "ftok_l" }, key),
    ).rejects.toMatchObject({ code: 2010, status: 402 });
  });

  test("pollTask returns output on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "success",
          output: { riggable: true, rig_type: "biped" },
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ riggable: true, rig_type: "biped" });
  });

  test("rigCheckTask submits animations/rig-check", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rc" } }),
    });
    const id = await rigCheckTask("file_glb_1", key);
    expect(id).toBe("task_rc");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/animations/rig-check");
    expect(JSON.parse(opts.body)).toEqual({ input: "file_glb_1" });
  });

  test("rigModelTask prefers the v1.0 biped rig line for bipeds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rig" } }),
    });
    const result = await rigModelTask("file_glb_1", "biped", key);
    expect(result).toEqual({ taskId: "task_rig", model: "v1.0-20240301" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/animations/rig");
    expect(JSON.parse(opts.body)).toEqual({
      input: "file_glb_1",
      rig_type: "biped",
      spec: "tripo",
      model: "v1.0-20240301",
    });
  });

  test("rigModelTask falls back to the generic rig line when biped v1.0 is rejected (1004)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 1004, message: "model retired" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { task_id: "task_rig_fb" } }),
      });
    const result = await rigModelTask("file_glb_1", "biped", key);
    expect(result).toEqual({ taskId: "task_rig_fb", model: "v2.5-20260210" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).model).toBe("v2.5-20260210");
  });

  test("rigModelTask uses the generic rig line for creatures (no v1.0 attempt)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rig_q" } }),
    });
    const result = await rigModelTask("file_glb_1", "quadruped", key);
    expect(result).toEqual({ taskId: "task_rig_q", model: "v2.5-20260210" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("rigModelTask rethrows non-1004 errors without falling back", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 2010, message: "insufficient credits" }),
    });
    await expect(rigModelTask("file_glb_1", "biped", key)).rejects.toMatchObject({
      status: 402,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("rigModelTask uses explicit model override directly, no fallback", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_explicit" } }),
    });
    const result = await rigModelTask("file_glb_1", "biped", key, { model: "v2.5-20260210" });
    expect(result).toEqual({ taskId: "task_explicit", model: "v2.5-20260210" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("v2.5-20260210");
  });

  test("rigModelTask explicit model throws on failure (no fallback)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 1004, message: "model retired" }),
    });
    await expect(
      rigModelTask("file_glb_1", "biped", key, { model: "v1.0-20240301" }),
    ).rejects.toMatchObject({ code: 1004 });
    expect(global.fetch).toHaveBeenCalledTimes(1); // no fallback attempt
  });

  test("retargetTask submits animations/retarget with presets", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rt" } }),
    });
    const id = await retargetTask("task_rig", ["preset:idle", "preset:walk"], key);
    expect(id).toBe("task_rt");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/animations/retarget");
    expect(JSON.parse(opts.body)).toEqual({
      input: "task_rig",
      animations: ["preset:idle", "preset:walk"],
      out_format: "glb",
    });
  });

  test("retargetTask maps presets to preset:biped:* for v1.0 biped rigs", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rt" } }),
    });
    await retargetTask("task_rig", ["preset:idle"], key, { rigModel: "v1.0-20240301" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).animations).toEqual([
      "preset:biped:idle",
    ]);
  });

  test("retargetTask passes animate_in_place when requested", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rt" } }),
    });
    await retargetTask("task_rig", ["preset:idle"], key, { animateInPlace: true });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).animate_in_place).toBe(true);
  });

  test("retargetTask passes preset:biped:* through unchanged for v1.0 biped rigs", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rt" } }),
    });
    await retargetTask("task_rig", ["preset:biped:dance_01"], key, {
      rigModel: "v1.0-20240301",
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).animations).toEqual([
      "preset:biped:dance_01",
    ]);
  });

  test("retargetTask rejects biped-only presets on a known generic (v2.5) rig", async () => {
    global.fetch = jest.fn();
    await expect(
      retargetTask("task_rig", ["preset:biped:dance_01"], key, {
        rigModel: "v2.5-20260210",
      }),
    ).rejects.toMatchObject({ code: 0, status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("retargetTask rejects an empty animations array with status 400", async () => {
    await expect(retargetTask("task_rig", [], key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("rigModelTask rejects empty rigType with status 400", async () => {
    await expect(rigModelTask("file_glb_1", "", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("getBalance returns balance and frozen", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { balance: 630, frozen: 0 } }),
    });
    const result = await getBalance(key);
    expect(result).toEqual({ balance: 630, frozen: 0 });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/account/balance");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
  });

  test("getBalance maps auth failure to 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 1002, message: "Authentication failed" }),
    });
    await expect(getBalance(key)).rejects.toMatchObject({
      code: 1002,
      status: 401,
    });
  });

  test("getBalance rejects empty apiKey with status 400", async () => {
    await expect(getBalance("")).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("createRefineTask submits models/texture with text_prompt", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_refine" } }),
    });
    const id = await createRefineTask("make it blue metallic", "file_glb_1", key);
    expect(id).toBe("task_refine");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/models/texture");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
    expect(JSON.parse(opts.body)).toEqual({
      input: "file_glb_1",
      text_prompt: "make it blue metallic",
      texture: true,
      pbr: true,
    });
  });

  test("createRefineTask rejects empty file token with status 400", async () => {
    await expect(createRefineTask("x", "", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
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

  test("pollTask returns glbUrl on success preferring model_url", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "success",
          progress: 100,
          output: {
            model_url: "https://cdn/result.glb",
            pbr_model: "https://cdn/other.glb",
          },
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result.status).toBe("success");
    expect(result.glbUrl).toBe("https://cdn/result.glb");
  });

  test("pollTask falls back to output.pbr_model then output.model", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "success",
          output: { pbr_model: "https://cdn/pbr.glb" },
        },
      }),
    });
    let result = await pollTask("task_abc", key);
    expect(result.glbUrl).toBe("https://cdn/pbr.glb");

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
    result = await pollTask("task_abc", key);
    expect(result.glbUrl).toBe("https://cdn/model.glb");
  });

  test("pollTask returns failed on Tripo failure using error_msg", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "failed",
          error_msg: "generation failed",
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("generation failed");
  });

  test("pollTask surfaces error_code and error_message from Tripo failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "failed",
          error_code: 2010,
          error_message: "insufficient credits",
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result).toEqual({
      status: "failed",
      error: "insufficient credits (Tripo error 2010)",
    });
  });

  test("pollTask falls back to the bare status when Tripo sends no error fields", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: { task_id: "task_abc", status: "failed" },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result).toEqual({ status: "failed", error: "Task failed" });
  });

  test("pollTask maps cancelled status to failed with error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "cancelled",
          error_msg: "user cancelled",
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result).toEqual({ status: "failed", error: "user cancelled" });
  });

  test.each(["banned", "expired"])(
    "pollTask maps v3 terminal %s status to failed",
    async (status) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: { task_id: "task_abc", status },
        }),
      });
      const result = await pollTask("task_abc", key);
      expect(result.status).toBe("failed");
      expect(result.error).toBe(`Task ${status}`);
    },
  );

  test("pollTask rejects empty taskId with status 400", async () => {
    await expect(pollTask("", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("downloadModel returns Buffer", async () => {
    const buf = Buffer.from("glb binary");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });
    const out = await downloadModel("https://cdn/result.glb");
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe("glb binary");
  });

  test("downloadModel throws when body is empty", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(downloadModel("https://cdn/empty.glb")).rejects.toMatchObject({
      status: 502,
      code: 0,
    });
    await expect(downloadModel("https://cdn/empty.glb")).rejects.toThrow(
      "Downloaded model is empty"
    );
  });

  test("downloadModel rejects empty glbUrl with status 400", async () => {
    await expect(downloadModel("")).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("TRIPO_3D_MODEL env override changes submitted model", async () => {
    const original = process.env.TRIPO_3D_MODEL;
    process.env.TRIPO_3D_MODEL = "v9.9-custom";
    try {
      await jest.isolateModulesAsync(async () => {
        const { createTask, TRIPO_MODEL_VERSION } = await import(
          "../../src/api/adapters/tripo3d-adapter.js"
        );
        expect(TRIPO_MODEL_VERSION).toBe("v9.9-custom");
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ code: 0, data: { task_id: "task_xyz" } }),
        });
        await createTask("override test", key);
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.model).toBe("v9.9-custom");
      });
    } finally {
      if (original === undefined) {
        delete process.env.TRIPO_3D_MODEL;
      } else {
        process.env.TRIPO_3D_MODEL = original;
      }
    }
  });

  test("no function logs the provider key", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const buf = Buffer.from("glb binary");
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, data: { task_id: "task_abc" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            task_id: "task_abc",
            status: "success",
            output: { pbr_model: "https://cdn/result.glb" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 7777, message: "Unknown error" }),
      });

    await createTask("x", key);
    await pollTask("task_abc", key);
    await downloadModel("https://cdn/result.glb");
    await expect(createTask("x", key)).rejects.toThrow(TripoApiError);

    const logs = [
      ...logSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
    ].join(" ");
    expect(logs).not.toContain(key);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

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
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ input: "file_glb_1", rig_type: "biped", spec: "tripo" });
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

describe("cancelTask", () => {
  beforeEach(() => {
    jest.spyOn(global, "fetch").mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POSTs to tasks/{id}/cancel and returns true on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: {} }),
    });
    const ok = await cancelTask("task_1", key);
    expect(ok).toBe(true);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/tasks/task_1/cancel");
    expect(opts.method).toBe("POST");
  });

  it("returns false when the upstream cancel fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
    });
    await expect(cancelTask("task_1", key)).resolves.toBe(false);
  });

  it("validates arguments", async () => {
    await expect(cancelTask("", key)).rejects.toMatchObject({ status: 400 });
  });
});

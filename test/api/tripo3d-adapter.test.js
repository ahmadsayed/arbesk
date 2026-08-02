import { jest } from "@jest/globals";
import {
  createTask,
  createImageTask,
  createRefineTask,
  uploadImage,
  getBalance,
  rigCheckTask,
  rigModelTask,
  retargetTask,
  pollTask,
  downloadModel,
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
    });
  });

  test("createImageTask rejects empty fileToken with status 400", async () => {
    await expect(createImageTask("", key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
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
    const id = await rigCheckTask("tripo_gen_1", key);
    expect(id).toBe("task_rc");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/animations/rig-check");
    expect(JSON.parse(opts.body)).toEqual({ input: "tripo_gen_1" });
  });

  test("rigModelTask submits animations/rig with mixamo spec and rig model", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_rig" } }),
    });
    const id = await rigModelTask("tripo_gen_1", "biped", key);
    expect(id).toBe("task_rig");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/animations/rig");
    expect(JSON.parse(opts.body)).toEqual({
      input: "tripo_gen_1",
      rig_type: "biped",
      spec: "mixamo",
      model: "v2.5-20260210",
    });
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

  test("retargetTask rejects an empty animations array with status 400", async () => {
    await expect(retargetTask("task_rig", [], key)).rejects.toMatchObject({
      code: 0,
      status: 400,
    });
  });

  test("rigModelTask rejects empty rigType with status 400", async () => {
    await expect(rigModelTask("tripo_gen_1", "", key)).rejects.toMatchObject({
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
    const id = await createRefineTask("make it blue metallic", "tripo_orig_1", key);
    expect(id).toBe("task_refine");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://openapi.tripo3d.ai/v3/models/texture");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
    expect(JSON.parse(opts.body)).toEqual({
      input: "tripo_orig_1",
      text_prompt: "make it blue metallic",
      texture: true,
      pbr: true,
    });
  });

  test("createRefineTask rejects empty original task id with status 400", async () => {
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

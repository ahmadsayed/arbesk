import { jest } from "@jest/globals";
import {
  createTask,
  createRefineTask,
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

  test("createRefineTask submits texture_model with text_prompt", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, data: { task_id: "task_refine" } }),
    });
    const id = await createRefineTask("make it blue metallic", "tripo_orig_1", key);
    expect(id).toBe("task_refine");
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.tripo3d.ai/v2/openapi/task");
    expect(opts.headers["Authorization"]).toBe(`Bearer ${key}`);
    expect(JSON.parse(opts.body)).toEqual({
      type: "texture_model",
      original_model_task_id: "tripo_orig_1",
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

  test("pollTask maps cancelled status to failed with error", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          task_id: "task_abc",
          status: "cancelled",
          message: "user cancelled",
        },
      }),
    });
    const result = await pollTask("task_abc", key);
    expect(result).toEqual({ status: "failed", error: "user cancelled" });
  });

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

  test("TRIPO_3D_MODEL env override changes submitted model_version", async () => {
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
        expect(body.model_version).toBe("v9.9-custom");
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

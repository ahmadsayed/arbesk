import { jest } from "@jest/globals";
import {
  createTask,
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

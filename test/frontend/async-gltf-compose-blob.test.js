/**
 * @jest-environment jsdom
 *
 * composeAsync tests
 *
 * The executor path must return UTF-8 bytes stringified/encoded by the
 * executor (a worker transfers them zero-copy, so the main thread pays no
 * JSON.stringify of a huge base64 glTF). When the executor is unavailable or
 * fails, the fallback must produce bytes identical to main-thread compose()
 * serialization.
 *
 * Seam: the ExecutorPort is injected via initRuntime (fake executor below).
 */
import { jest } from "@jest/globals";

async function load({ executorAvailable, execImpl } = {}) {
  jest.resetModules();

  const { initRuntime } = await import(
    "@arbesk/asset-core/runtime.js"
  );
  const { createMemoryIpfs } = await import(
    "@arbesk/asset-core/storage/memory-ipfs.js"
  );

  const exec = jest.fn(
    execImpl || (() => Promise.reject(new Error("no exec")))
  );
  const { read, write } = createMemoryIpfs();
  initRuntime({
    ipfsRead: read,
    ipfsWrite: write,
    executor: { available: async () => !!executorAvailable, exec },
  });

  const mod = await import(
    "@arbesk/asset-core/formats/gltf/async-gltf.js"
  );
  return { mod, exec };
}

function makeMonolithicGltf() {
  return {
    asset: { version: "2.0" },
    buffers: [{ uri: "data:application/octet-stream;base64,SGVsbG8=" }],
    images: [{ uri: "data:image/png;base64,iVBORw==" }],
  };
}

describe("composeAsync", () => {
  it("executor path returns bytes from executor-encoded bytes without re-stringifying", async () => {
    const composed = { asset: { version: "2.0" }, marker: "from-executor" };
    const composedBytes = new TextEncoder().encode(JSON.stringify(composed));
    const { mod, exec } = await load({
      executorAvailable: true,
      execImpl: (method) => {
        if (method === "compose") {
          return Promise.resolve({ composedBytes });
        }
        return Promise.reject(new Error("unexpected method " + method));
      },
    });

    const bytes = await mod.composeAsync(makeMonolithicGltf());

    expect(exec).toHaveBeenCalledWith("compose", expect.anything());
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(composed);
  });

  it("falls back to main-thread compose when the executor is unavailable", async () => {
    const { mod, exec } = await load({ executorAvailable: false });
    const gltf = makeMonolithicGltf();

    const bytes = await mod.composeAsync(gltf);

    expect(exec).not.toHaveBeenCalled();
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(parsed.buffers[0].uri).toBe(gltf.buffers[0].uri);
    expect(parsed.images[0].uri).toBe(gltf.images[0].uri);
  });

  it("falls back to main-thread compose when the executor call fails", async () => {
    const { mod, exec } = await load({
      executorAvailable: true,
      execImpl: () => Promise.reject(new Error("executor exploded")),
    });
    const gltf = makeMonolithicGltf();

    const bytes = await mod.composeAsync(gltf);

    expect(exec).toHaveBeenCalled();
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(parsed.buffers[0].uri).toBe(gltf.buffers[0].uri);
  });

  it("rejects on null input", async () => {
    const { mod } = await load({ executorAvailable: false });
    await expect(mod.composeAsync(null)).rejects.toThrow(
      /gltfJson is null/
    );
  });
});

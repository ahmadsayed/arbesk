/**
 * @jest-environment jsdom
 *
 * composeGlTFToBlobAsync tests
 *
 * The executor path must return a Blob built from bytes stringified/encoded
 * by the executor (a worker transfers them zero-copy, so the main thread pays
 * no JSON.stringify of a huge base64 glTF). When the executor is unavailable
 * or fails, the fallback must produce a Blob identical to main-thread
 * composeGlTF() + JSON.stringify().
 *
 * Seam: the ExecutorPort is injected via initRuntime (fake executor below);
 * the worker pool is no longer imported by async-gltf directly.
 */
import { jest } from "@jest/globals";

async function load({ executorAvailable, execImpl } = {}) {
  jest.resetModules();

  const { initRuntime } = await import(
    "@arbesk/asset-core/runtime.js"
  );
  const { createMemoryIpfs } = await import(
    "@arbesk/asset-core/testing/memory-ipfs.js"
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
    "@arbesk/asset-core/gltf/async-gltf.js"
  );
  return { mod, exec };
}

// jsdom's Blob has no .text()/.arrayBuffer(); read it via FileReader.
function blobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

// A glTF whose URIs are already data URIs, so main-thread composeGlTF()
// resolves it without any IPFS fetch.
function makeMonolithicGltf() {
  return {
    asset: { version: "2.0" },
    buffers: [{ uri: "data:application/octet-stream;base64,SGVsbG8=" }],
    images: [{ uri: "data:image/png;base64,iVBORw==" }],
  };
}

describe("composeGlTFToBlobAsync", () => {
  it("executor path returns a Blob from executor-encoded bytes without re-stringifying", async () => {
    const composed = { asset: { version: "2.0" }, marker: "from-executor" };
    const composedBytes = new TextEncoder().encode(JSON.stringify(composed));
    const { mod, exec } = await load({
      executorAvailable: true,
      execImpl: (method) => {
        if (method === "composeToBytes") {
          return Promise.resolve({ composedBytes });
        }
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    });

    const blob = await mod.composeGlTFToBlobAsync(makeMonolithicGltf());

    expect(exec).toHaveBeenCalledWith("composeToBytes", expect.anything());
    expect(blob).toBeInstanceOf(Blob);
    expect(JSON.parse(await blobText(blob))).toEqual(composed);
  });

  it("falls back to main-thread compose when the executor is unavailable", async () => {
    const { mod, exec } = await load({ executorAvailable: false });
    const gltf = makeMonolithicGltf();

    const blob = await mod.composeGlTFToBlobAsync(gltf);

    expect(exec).not.toHaveBeenCalled();
    expect(blob).toBeInstanceOf(Blob);
    const parsed = JSON.parse(await blobText(blob));
    // Data URIs pass through composeGlTF unchanged.
    expect(parsed.buffers[0].uri).toBe(gltf.buffers[0].uri);
    expect(parsed.images[0].uri).toBe(gltf.images[0].uri);
  });

  it("falls back to main-thread compose when the executor call fails", async () => {
    const { mod, exec } = await load({
      executorAvailable: true,
      execImpl: () => Promise.reject(new Error("executor exploded")),
    });
    const gltf = makeMonolithicGltf();

    const blob = await mod.composeGlTFToBlobAsync(gltf);

    expect(exec).toHaveBeenCalled();
    const parsed = JSON.parse(await blobText(blob));
    expect(parsed.buffers[0].uri).toBe(gltf.buffers[0].uri);
  });

  it("rejects on null input", async () => {
    const { mod } = await load({ executorAvailable: false });
    await expect(mod.composeGlTFToBlobAsync(null)).rejects.toThrow(
      /gltfJson is null/
    );
  });
});

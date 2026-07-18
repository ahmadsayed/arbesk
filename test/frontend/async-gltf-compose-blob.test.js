/**
 * @jest-environment jsdom
 *
 * composeGlTFToBlobAsync tests
 *
 * The worker path must return a Blob built from bytes stringified/encoded in
 * the worker (zero-copy transfer, no main-thread JSON.stringify of a huge
 * base64 glTF). When the worker is unavailable or fails, the fallback must
 * produce a Blob identical to main-thread composeGlTF() + JSON.stringify().
 */
import { jest } from "@jest/globals";

async function load({ workerAvailable, execImpl } = {}) {
  jest.resetModules();

  const exec = jest.fn(execImpl || (() => Promise.reject(new Error("no exec"))));
  jest.unstable_mockModule(
    "../../frontend/src/js/workers/gltf-worker-pool.js",
    () => ({
      getGlTFWorkerPool: () => ({ exec }),
      isWorkerPoolAvailable: jest.fn().mockResolvedValue(!!workerAvailable),
      terminateGlTFWorkerPool: jest.fn(),
    })
  );
  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    gatewayBase: jest.fn().mockResolvedValue("http://127.0.0.1:8080/ipfs/"),
    getFromRemoteIPFS: jest.fn(),
    getBase64FromRemoteIPFS: jest.fn(),
    getBlobFromRemoteIPFS: jest.fn(),
    getArrayBufferFromRemoteIPFS: jest.fn(),
    getRawArrayBufferFromRemoteIPFS: jest.fn(),
    getManifestChain: jest.fn(),
    isIpfsCidReachable: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/gltf/async-gltf.js");
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
  it("worker path returns a Blob from worker-encoded bytes without re-stringifying", async () => {
    const composed = { asset: { version: "2.0" }, marker: "from-worker" };
    const composedBytes = new TextEncoder().encode(JSON.stringify(composed));
    const { mod, exec } = await load({
      workerAvailable: true,
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

  it("falls back to main-thread compose when the worker is unavailable", async () => {
    const { mod, exec } = await load({ workerAvailable: false });
    const gltf = makeMonolithicGltf();

    const blob = await mod.composeGlTFToBlobAsync(gltf);

    expect(exec).not.toHaveBeenCalled();
    expect(blob).toBeInstanceOf(Blob);
    const parsed = JSON.parse(await blobText(blob));
    // Data URIs pass through composeGlTF unchanged.
    expect(parsed.buffers[0].uri).toBe(gltf.buffers[0].uri);
    expect(parsed.images[0].uri).toBe(gltf.images[0].uri);
  });

  it("falls back to main-thread compose when the worker call fails", async () => {
    const { mod, exec } = await load({
      workerAvailable: true,
      execImpl: () => Promise.reject(new Error("worker exploded")),
    });
    const gltf = makeMonolithicGltf();

    const blob = await mod.composeGlTFToBlobAsync(gltf);

    expect(exec).toHaveBeenCalled();
    const parsed = JSON.parse(await blobText(blob));
    expect(parsed.buffers[0].uri).toBe(gltf.buffers[0].uri);
  });

  it("rejects on null input", async () => {
    const { mod } = await load({ workerAvailable: false });
    await expect(mod.composeGlTFToBlobAsync(null)).rejects.toThrow(
      /gltfJson is null/
    );
  });
});

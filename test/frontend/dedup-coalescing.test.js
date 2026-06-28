/** @jest-environment jsdom */
import { jest } from "@jest/globals";

describe("uploadWithDedup - concurrent coalescing", () => {
  async function loadModule() {
    jest.resetModules();
    const writeToIPFS = jest.fn();
    jest.unstable_mockModule(
      "../../frontend/src/js/ipfs/write-to-ipfs.js",
      () => ({
        __esModule: true,
        writeToIPFS,
      })
    );
    const mod = await import("../../frontend/src/js/gltf/dedup.js");
    return { mod, writeToIPFS };
  }

  it("coalesces two concurrent identical payloads into one writeToIPFS call", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { mod, writeToIPFS } = await loadModule();

    writeToIPFS.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight--;
      return "bafyShared";
    });

    const bytes = new Uint8Array([1, 2, 3, 4]);
    const [r1, r2] = await Promise.all([
      mod.uploadWithDedup(bytes, "a.bin", null, { compress: false }),
      mod.uploadWithDedup(bytes, "b.bin", null, { compress: false }),
    ]);

    expect(writeToIPFS).toHaveBeenCalledTimes(1);
    expect(r1.cid).toBe("bafyShared");
    expect(r2.cid).toBe("bafyShared");
    expect(maxInFlight).toBe(1);
  });

  it("does not coalesce different payloads", async () => {
    const { mod, writeToIPFS } = await loadModule();
    writeToIPFS.mockResolvedValue("bafy");

    const r1 = await mod.uploadWithDedup(
      new Uint8Array([1, 2]),
      "a.bin",
      null,
      { compress: false }
    );
    const r2 = await mod.uploadWithDedup(
      new Uint8Array([3, 4]),
      "b.bin",
      null,
      { compress: false }
    );

    expect(writeToIPFS).toHaveBeenCalledTimes(2);
    expect(r1.cid).toBe("bafy");
    expect(r2.cid).toBe("bafy");
  });

  it("still skips via the dedup map without calling writeToIPFS", async () => {
    const { mod, writeToIPFS } = await loadModule();
    writeToIPFS.mockResolvedValue("bafyFirst");

    const bytes = new Uint8Array([9, 9]);
    const first = await mod.uploadWithDedup(bytes, "c.bin", null, {
      compress: false,
    });
    expect(first.skipped).toBe(false);

    writeToIPFS.mockClear();
    const dedupMap = new Map([[first.meta.hash, "bafyCached"]]);

    const result = await mod.uploadWithDedup(
      bytes,
      "d.bin",
      null,
      { compress: false },
      dedupMap
    );

    expect(result.cid).toBe("bafyCached");
    expect(result.skipped).toBe(true);
    expect(writeToIPFS).not.toHaveBeenCalled();
  });
});

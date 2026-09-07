/**
 * Contract tests for the IpfsReadPort/IpfsWritePort adapters.
 *
 * Deliberately run in the default node environment (no @jest-environment
 * jsdom docblock): jsdom's realm-mismatched Uint8Array breaks the
 * `instanceof` checks in asset-core/utils/compression.ts.
 */
import { createMemoryIpfs } from "@arbesk/asset-core/storage/memory-ipfs.js";
import { isGzipped, isBrotliFramed } from "@arbesk/asset-core/utils/compression.js";

/** Contract shared by every IpfsReadPort/IpfsWritePort pair. */
function ipfsContract(name, makePorts) {
  describe(name, () => {
    test("write → getRawBytes round-trips bytes", async () => {
      const { read, write } = makePorts();
      const cid = await write.write(new Uint8Array([1, 2, 3]), "x.bin", null, { compress: false });
      expect(typeof cid).toBe("string");
      const bytes = await read.getRawBytes(cid);
      expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3]);
    });

    test("writeJSON → getJSON round-trips an object", async () => {
      const { read, write } = makePorts();
      const cid = await write.writeJSON({ hello: "world" }, null, { compress: false });
      expect(await read.getJSON(cid)).toEqual({ hello: "world" });
    });

    test("default write options compress (brotli); getBytes/getJSON decompress transparently", async () => {
      const { read, write } = makePorts();
      // Default options (compress on): stored bytes must carry the brotli
      // frame, and the read side must decompress transparently.
      const json = { brotli: "round-trip", n: 42 };
      const jsonCid = await write.writeJSON(json);
      expect(isBrotliFramed(new Uint8Array(await read.getRawBytes(jsonCid)))).toBe(true);
      expect(await read.getJSON(jsonCid)).toEqual(json);

      const bytesCid = await write.write(new TextEncoder().encode("bytes"));
      expect(isBrotliFramed(new Uint8Array(await read.getRawBytes(bytesCid)))).toBe(true);
      const roundTrip = new TextDecoder().decode(await read.getBytes(bytesCid));
      expect(roundTrip).toBe("bytes");
    });

    test("compress: 'gzip' forces the legacy codec; reads still decompress", async () => {
      const { read, write } = makePorts();
      const json = { gzip: "explicit", n: 7 };
      const jsonCid = await write.writeJSON(json, null, { compress: "gzip" });
      expect(isGzipped(new Uint8Array(await read.getRawBytes(jsonCid)))).toBe(true);
      expect(await read.getJSON(jsonCid)).toEqual(json);

      const bytesCid = await write.write(new TextEncoder().encode("gz bytes"), "x.bin", null, {
        compress: "gzip",
      });
      expect(isGzipped(new Uint8Array(await read.getRawBytes(bytesCid)))).toBe(true);
      expect(new TextDecoder().decode(await read.getBytes(bytesCid))).toBe("gz bytes");
    });

    test("reads unknown CID reject", async () => {
      const { read } = makePorts();
      await expect(read.getJSON("bafyunknown")).rejects.toThrow();
    });
  });
}

ipfsContract("memory adapter", () => createMemoryIpfs());

describe("browser adapter (smoke)", () => {
  test("createBrowserIpfsPorts exposes the port surface without network calls", async () => {
    const { createBrowserIpfsPorts } = await import(
      "../../frontend/src/js/ipfs/asset-core-adapter.ts"
    );
    const { read, write } = createBrowserIpfsPorts();
    for (const method of ["getJSON", "getBytes", "getRawBytes"]) {
      expect(typeof read[method]).toBe("function");
    }
    for (const method of ["write", "writeJSON"]) {
      expect(typeof write[method]).toBe("function");
    }
  });
});

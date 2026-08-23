/**
 * Contract tests for the IpfsReadPort/IpfsWritePort adapters.
 *
 * Deliberately run in the default node environment (no @jest-environment
 * jsdom docblock): jsdom's realm-mismatched Uint8Array breaks the
 * `instanceof` checks in asset-core/utils/compression.ts.
 */
import { createMemoryIpfs } from "../../frontend/src/js/asset-core/testing/memory-ipfs.ts";
import { isGzipped } from "../../frontend/src/js/asset-core/utils/compression.js";

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

    test("default write options compress; getBytes/getJSON gunzip transparently", async () => {
      const { read, write } = makePorts();
      // Default options (compress on): stored bytes must be gzipped, and the
      // read side must gunzip transparently.
      const json = { gzip: "round-trip", n: 42 };
      const jsonCid = await write.writeJSON(json);
      expect(isGzipped(new Uint8Array(await read.getRawBytes(jsonCid)))).toBe(true);
      expect(await read.getJSON(jsonCid)).toEqual(json);

      const bytesCid = await write.write(new TextEncoder().encode("bytes"));
      expect(isGzipped(new Uint8Array(await read.getRawBytes(bytesCid)))).toBe(true);
      const roundTrip = new TextDecoder().decode(await read.getBytes(bytesCid));
      expect(roundTrip).toBe("bytes");
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

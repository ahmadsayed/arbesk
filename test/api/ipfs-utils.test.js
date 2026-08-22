import zlib from "zlib";
import { jest } from "@jest/globals";
import { maybeDecompress, catManifest, catBytes } from "../../src/api/ipfs-utils.ts";

describe("maybeDecompress", () => {
  it("returns plain UTF-8 strings unchanged", async () => {
    const data = '{"hello":"world"}';
    expect(await maybeDecompress(data)).toBe(data);
  });

  it("decompresses a gzip-compressed Buffer", async () => {
    const original = '{"compressed":true,"version":1}';
    const gzipped = zlib.gzipSync(Buffer.from(original, "utf-8"));
    expect(await maybeDecompress(gzipped)).toBe(original);
  });

  it("decompresses a gzip-compressed Uint8Array", async () => {
    const original = '{"compressed":true,"version":2}';
    const gzipped = zlib.gzipSync(Buffer.from(original, "utf-8"));
    const bytes = new Uint8Array(gzipped.buffer, gzipped.byteOffset, gzipped.byteLength);
    expect(await maybeDecompress(bytes)).toBe(original);
  });

  it("decodes an uncompressed Buffer as UTF-8", async () => {
    const data = Buffer.from('{"plain":true}', "utf-8");
    expect(await maybeDecompress(data)).toBe('{"plain":true}');
  });
});

describe("catManifest / catBytes", () => {
  function mockIpfs(chunks) {
    return {
      cat: jest.fn((_cid, _opts) =>
        (async function* () {
          for (const c of chunks) yield c;
        })(),
      ),
    };
  }

  it("catManifest decodes chunks and forwards the timeout to ipfs.cat", async () => {
    const ipfs = mockIpfs([Buffer.from('{"a":'), Buffer.from("1}")]);
    const out = await catManifest(ipfs, "bafyabc", 5000);
    expect(out).toBe('{"a":1}');
    expect(ipfs.cat).toHaveBeenCalledWith("bafyabc", { timeout: 5000 });
  });

  it("catManifest defaults to a 15000ms timeout", async () => {
    const ipfs = mockIpfs([Buffer.from("{}")]);
    await catManifest(ipfs, "bafyabc");
    expect(ipfs.cat).toHaveBeenCalledWith("bafyabc", { timeout: 15000 });
  });

  it("catManifest decodes Uint16Array test-mock chunks", async () => {
    const ipfs = mockIpfs([new Uint16Array([104, 105])]); // "hi"
    expect(await catManifest(ipfs, "bafyabc")).toBe("hi");
  });

  it("catBytes returns a Buffer and forwards the timeout to ipfs.cat", async () => {
    const ipfs = mockIpfs([new Uint8Array([1, 2]), Buffer.from([3])]);
    const out = await catBytes(ipfs, "bafyabc", 1234);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect([...out]).toEqual([1, 2, 3]);
    expect(ipfs.cat).toHaveBeenCalledWith("bafyabc", { timeout: 1234 });
  });
});

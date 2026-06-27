import zlib from "zlib";
import { maybeDecompress } from "../../src/api/ipfs-utils.js";

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

/**
 * Codec tests for asset-core compression: brotli (new default, ARB\x01-framed)
 * alongside legacy gzip, with magic-byte auto-detection on read.
 *
 * Runs in the default node environment: jsdom's realm-mismatched Uint8Array
 * breaks the instanceof checks in utils/compression.ts.
 */
import {
  compress,
  decompress,
  isGzipped,
  compressAuto,
  decompressAuto,
  isBrotliFramed,
  BROTLI_MAGIC,
} from "@arbesk/asset-core/utils/compression.js";

const text = (s) => new TextEncoder().encode(s);
const str = (bytes) => new TextDecoder().decode(bytes);

describe("brotli codec (default)", () => {
  test("compressAuto defaults to brotli with the ARB\\x01 frame", async () => {
    const out = await compressAuto(text("hello hello hello hello"));
    expect(isBrotliFramed(out)).toBe(true);
    expect(Array.from(out.slice(0, 4))).toEqual(Array.from(BROTLI_MAGIC));
    expect(isGzipped(out)).toBe(false);
  });

  test("brotli round-trips binary data", async () => {
    const binary = new Uint8Array(4096).map((_, i) => i % 251);
    const packed = await compressAuto(binary, { hint: "binary" });
    expect(isBrotliFramed(packed)).toBe(true);
    const back = await decompressAuto(packed);
    expect(Array.from(new Uint8Array(back))).toEqual(Array.from(binary));
  });

  test("brotli round-trips JSON-ish text at the text hint", async () => {
    const json = JSON.stringify({ manifest: "x".repeat(500), nodes: [1, 2, 3] });
    const packed = await compressAuto(text(json), { hint: "json" });
    expect(str(await decompressAuto(packed))).toBe(json);
  });

  test("explicit codec 'brotli' matches the default framing", async () => {
    const out = await compressAuto(text("explicit"), { codec: "brotli" });
    expect(isBrotliFramed(out)).toBe(true);
    expect(str(await decompressAuto(out))).toBe("explicit");
  });
});

describe("gzip codec (legacy, opt-in)", () => {
  test("compressAuto with codec 'gzip' produces an unframed gzip stream", async () => {
    const out = await compressAuto(text("legacy"), { codec: "gzip" });
    expect(isGzipped(out)).toBe(true);
    expect(isBrotliFramed(out)).toBe(false);
    expect(str(await decompressAuto(out))).toBe("legacy");
  });

  test("existing sync gzip helpers are unchanged", () => {
    const packed = compress(text("still gzip"));
    expect(isGzipped(packed)).toBe(true);
    expect(str(decompress(packed))).toBe("still gzip");
  });
});

describe("decompressAuto dispatch", () => {
  test("gunzips legacy gzip payloads", async () => {
    const legacy = compress(text("old cid content"));
    expect(str(await decompressAuto(legacy))).toBe("old cid content");
  });

  test("passes through raw bytes untouched", async () => {
    const raw = text('{"uncompressed": true}');
    const out = await decompressAuto(raw);
    expect(Array.from(new Uint8Array(out))).toEqual(Array.from(raw));
  });

  test("rejects a corrupt brotli frame", async () => {
    const corrupt = new Uint8Array([...BROTLI_MAGIC, 0xff, 0xff, 0xff, 0xff]);
    await expect(decompressAuto(corrupt)).rejects.toThrow();
  });
});

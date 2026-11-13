import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import zlib from "zlib";
import { frameBrotliPayload } from "@arbesk/asset-core/utils/brotli-frame.js";
import { sniffSourceKind } from "../../src/api/source-sniff.ts";

const HEAD = 1024;
const head = (bytes) => Buffer.from(bytes).subarray(0, HEAD);

// A composite glTF large enough that 1 KB of its compressed form is a
// truncated stream, as a Range request returns it.
const bigGltf = JSON.stringify({
  asset: { version: "2.0" },
  buffers: Array.from({ length: 400 }, (_, i) => ({ uri: `ipfs://bafy${crypto.randomBytes(20).toString("hex")}${i}` })),
});
const glb = Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0]), crypto.randomBytes(4096)]);
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(4096)]);

describe("sniffSourceKind", () => {
  it("reads JSON, with or without leading whitespace", () => {
    expect(sniffSourceKind(head(Buffer.from(bigGltf)))).toBe("json");
    expect(sniffSourceKind(head(Buffer.from(`\n  ${bigGltf}`)))).toBe("json");
  });

  it("knows a GLB and a zip (3MF) as binary", () => {
    expect(sniffSourceKind(head(glb))).toBe("binary");
    expect(sniffSourceKind(head(zip))).toBe("binary");
  });

  it("looks inside a truncated gzip stream", () => {
    expect(sniffSourceKind(head(zlib.gzipSync(bigGltf)))).toBe("json");
    expect(sniffSourceKind(head(zlib.gzipSync(glb)))).toBe("binary");
  });

  it("looks inside a truncated brotli-framed stream", () => {
    const brotli = (data) => Buffer.from(frameBrotliPayload(zlib.brotliCompressSync(data)));
    expect(sniffSourceKind(head(brotli(bigGltf)))).toBe("json");
    expect(sniffSourceKind(head(brotli(glb)))).toBe("binary");
  });

  it("calls anything else unknown, so the caller reads it in full", () => {
    expect(sniffSourceKind(head(crypto.randomBytes(2048)))).toBe("unknown");
    expect(sniffSourceKind(Buffer.alloc(0))).toBe("unknown");
    expect(sniffSourceKind(Buffer.from([0x1f, 0x8b, 0xff, 0xff]))).toBe("unknown");
  });
});

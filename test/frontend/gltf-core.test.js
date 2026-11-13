/**
 * Tests for the shared pure glTF transforms in gltf-core.js — the single
 * implementation used by both the main thread (composer.js/decomposer.js)
 * and the glTF Web Worker (workers/gltf-worker.js).
 */
import { describe, expect, it, jest } from "bun:test";
import {
  IPFS_URI_PREFIX,
  isComposite,
  ipfsUriFromCid,
  cidFromIpfsUri,
  attachDedupMeta,
  stripDedupMeta,
  composeGltfJson,
  decomposeGltfJson,
} from "@arbesk/asset-core/formats/gltf/gltf-core.js";

const DATA_BIN = "data:application/octet-stream;base64,SGVsbG8="; // "Hello"
const DATA_PNG = "data:image/png;base64,iVBORw0KGgo=";

function makeComposite() {
  return {
    asset: { version: "2.0" },
    buffers: [
      {
        uri: "ipfs://bafyBuffer",
        byteLength: 5,
        _arbesk: { hash: "hh", hashAlgo: "murmur3-32" },
      },
    ],
    images: [
      {
        uri: "ipfs://bafyImage",
        mimeType: "image/jpeg",
        bufferView: 0, // storage form carries both; compose must drop this
        _arbesk: { hash: "ii", hashAlgo: "murmur3-32" },
      },
    ],
  };
}

describe("gltf-core helpers", () => {
  it("isComposite detects ipfs:// refs on buffers or images", () => {
    expect(isComposite(null)).toBe(false);
    expect(isComposite({})).toBe(false);
    expect(isComposite({ buffers: [{ uri: DATA_BIN }] })).toBe(false);
    expect(isComposite({ buffers: [{ uri: "ipfs://bafy1" }] })).toBe(true);
    expect(isComposite({ images: [{ uri: "ipfs://bafy2" }] })).toBe(true);
  });

  it("ipfsUriFromCid / cidFromIpfsUri round-trip", () => {
    expect(ipfsUriFromCid("bafyX")).toBe(`${IPFS_URI_PREFIX}bafyX`);
    expect(cidFromIpfsUri("ipfs://bafyX")).toBe("bafyX");
    expect(cidFromIpfsUri(DATA_BIN)).toBeNull();
    expect(cidFromIpfsUri(null)).toBeNull();
  });

  it("attachDedupMeta adds _arbesk; stripDedupMeta deep-clones without it", () => {
    const withMeta = attachDedupMeta({ uri: "ipfs://bafy" }, { hash: "h" });
    expect(withMeta._arbesk).toEqual({ hash: "h" });

    const composite = makeComposite();
    const stripped = stripDedupMeta(composite);
    expect(stripped.buffers[0]._arbesk).toBeUndefined();
    expect(stripped.images[0]._arbesk).toBeUndefined();
    // Input untouched, output is a clone.
    expect(composite.buffers[0]._arbesk).toBeDefined();
    expect(stripped).not.toBe(composite);
  });
});

describe("composeGltfJson", () => {
  it("resolves ipfs:// buffers/images via the injected fetcher and strips meta", async () => {
    const fetchBase64 = jest.fn(async (cid) => `b64-of-${cid}`);
    const composite = makeComposite();

    const composed = await composeGltfJson(composite, fetchBase64);

    expect(fetchBase64).toHaveBeenCalledWith("bafyBuffer", composite.buffers[0]._arbesk);
    expect(fetchBase64).toHaveBeenCalledWith("bafyImage", composite.images[0]._arbesk);
    expect(composed.buffers[0].uri).toBe(
      "data:application/octet-stream;base64,b64-of-bafyBuffer"
    );
    expect(composed.images[0].uri).toBe(
      "data:image/jpeg;base64,b64-of-bafyImage"
    );
    expect(composed.buffers[0]._arbesk).toBeUndefined();
    expect(composed.images[0]._arbesk).toBeUndefined();
    // Input not mutated.
    expect(composite.buffers[0].uri).toBe("ipfs://bafyBuffer");
  });

  it("drops bufferView on any image that has a uri (glTF XOR rule)", async () => {
    const composed = await composeGltfJson(
      {
        asset: { version: "2.0" },
        images: [
          { uri: DATA_PNG, bufferView: 0, mimeType: "image/png" },
          { bufferView: 0, mimeType: "image/png" }, // bufferView-only: untouched
        ],
      },
      jest.fn()
    );
    expect(composed.images[0].uri).toBe(DATA_PNG);
    expect(composed.images[0].bufferView).toBeUndefined();
    expect(composed.images[1].bufferView).toBe(0);
  });

  it("rejects on null input", async () => {
    await expect(composeGltfJson(null, jest.fn())).rejects.toThrow(
      "composeGltfJson: gltfJson is null"
    );
  });
});

describe("decomposeGltfJson per-mesh buffers", () => {
  /** Two meshes, each large enough for a buffer of its own, in one data-URI buffer. */
  function twoMeshGltf() {
    const vertices = 3000; // 36 kB of positions per mesh
    const bytes = new Uint8Array(vertices * 12 * 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;
    const meshBytes = vertices * 12;
    return {
      bytes,
      gltf: {
        asset: { version: "2.0" },
        buffers: [{
          uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
          byteLength: bytes.length,
        }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: meshBytes },
          { buffer: 0, byteOffset: meshBytes, byteLength: meshBytes },
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: vertices, type: "VEC3" },
          { bufferView: 1, componentType: 5126, count: vertices, type: "VEC3" },
        ],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0 } }] },
          { primitives: [{ attributes: { POSITION: 1 } }] },
        ],
      },
    };
  }

  it("hands each mesh's bytes to onBuffer as its own buffer", async () => {
    const { gltf, bytes } = twoMeshGltf();
    const seen = [];

    const composite = await decomposeGltfJson(gltf, {
      onBuffer: (i, buf, extracted) => {
        seen[i] = extracted.bytes;
        return { ...buf, uri: `ipfs://cid-${i}` };
      },
    });

    expect(seen).toHaveLength(2);
    expect(Buffer.from(seen[0]).equals(Buffer.from(bytes.subarray(0, 36000)))).toBe(true);
    expect(Buffer.from(seen[1]).equals(Buffer.from(bytes.subarray(36000)))).toBe(true);
    expect(composite.buffers).toEqual([
      { byteLength: 36000, uri: "ipfs://cid-0" },
      { byteLength: 36000, uri: "ipfs://cid-1" },
    ]);
    expect(composite.bufferViews.map((v) => v.buffer)).toEqual([0, 1]);
    // The input still has its single inline buffer.
    expect(gltf.buffers).toHaveLength(1);
  });
});

describe("decomposeGltfJson", () => {
  it("extracts data URIs and applies the callback replacements", async () => {
    const onBuffer = jest.fn((i, buf, _extracted) => ({
      ...buf,
      uri: `placeholder-buffer-${i}`,
    }));
    const onImage = jest.fn((i, img, _extracted) => ({
      ...img,
      uri: `placeholder-image-${i}`,
    }));

    const gltf = {
      asset: { version: "2.0" },
      buffers: [
        { uri: DATA_BIN, byteLength: 5 },
        { uri: "ipfs://bafyExisting", byteLength: 9 }, // already decomposed
      ],
      images: [
        { uri: DATA_PNG, mimeType: "image/png" },
        { uri: "https://example.com/tex.png" }, // external: kept as-is
      ],
    };

    const composite = await decomposeGltfJson(gltf, { onBuffer, onImage });

    expect(onBuffer).toHaveBeenCalledTimes(1);
    expect(onBuffer.mock.calls[0][2].mimeType).toBe("application/octet-stream");
    expect(Array.from(onBuffer.mock.calls[0][2].bytes)).toEqual(
      Array.from(new TextEncoder().encode("Hello"))
    );
    expect(onImage).toHaveBeenCalledTimes(1);
    expect(composite.buffers[0].uri).toBe("placeholder-buffer-0");
    expect(composite.buffers[1].uri).toBe("ipfs://bafyExisting");
    expect(composite.images[0].uri).toBe("placeholder-image-0");
    expect(composite.images[1].uri).toBe("https://example.com/tex.png");
    // Input not mutated.
    expect(gltf.buffers[0].uri).toBe(DATA_BIN);
  });

  it("warns and keeps the item when a data URI cannot be extracted", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const composite = await decomposeGltfJson(
        { buffers: [{ uri: "not-a-data-uri" }] },
        { onBuffer: jest.fn(), onImage: jest.fn() }
      );
      expect(composite.buffers[0].uri).toBe("not-a-data-uri");
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects on null input", async () => {
    await expect(decomposeGltfJson(null, {})).rejects.toThrow(
      "decomposeGltfJson: gltfJson is null"
    );
  });
});

/**
 * gltf-worker characterization tests.
 *
 * The worker module self-registers with workerpool at import time, so the
 * vendored workerpool module is mocked to capture the registered methods;
 * each op is then invoked directly with the same payload shape the pool
 * sends. GLB fixtures are hand-assembled (header + JSON/BIN chunks) so every
 * decomposeGlb branch is exercised: data-URI and BIN-chunk buffers, bufferView
 * images with magic-byte sniffing, ipfs:// skip entries, external URIs, and
 * the warn-and-skip edge cases.
 */
import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";

let registered = null;

jest.unstable_mockModule(
  "../../frontend/src/js/vendor/workerpool-10.0.2.mjs",
  () => ({
    __esModule: true,
    default: {
      worker: jest.fn((methods) => {
        registered = methods;
      }),
    },
    Transfer: class Transfer {
      constructor(payload, transferables) {
        this.payload = payload;
        this.transferables = transferables;
      }
    },
  }),
);

await import("../../frontend/src/js/workers/gltf-worker.js");

/** wrapWithTransfer returns a Transfer mock for results with binary entries. */
function unwrap(result) {
  return result && result.payload ? result.payload : result;
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

/** Assemble a GLB v2 container from a glTF JSON object and optional BIN bytes. */
function buildGlb(json, binBytes = null) {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }

  const chunks = [
    { type: 0x4e4f534a, bytes: jsonBytes }, // "JSON"
  ];
  if (binBytes) {
    let bin = binBytes;
    const binPad = (4 - (bin.length % 4)) % 4;
    if (binPad) {
      const padded = new Uint8Array(bin.length + binPad);
      padded.set(bin);
      bin = padded;
    }
    chunks.push({ type: 0x004e4942, bytes: bin }); // "BIN\0"
  }

  const total =
    12 + chunks.reduce((sum, c) => sum + 8 + c.bytes.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let pos = 12;
  for (const c of chunks) {
    view.setUint32(pos, c.bytes.length, true);
    view.setUint32(pos + 4, c.type, true);
    out.set(c.bytes, pos + 8);
    pos += 8 + c.bytes.length;
  }
  return out.buffer;
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

describe("gltf-worker decomposeGlb", () => {
  test("extracts the BIN chunk of a real GLB into a placeholder buffer entry", async () => {
    const buf = readFileSync("mock-gltf-assets/triangle.glb");
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const { composite, buffers, images } = unwrap(
      await registered.decomposeGlb({ arrayBuffer }),
    );

    expect(composite.buffers[0].uri).toBe("__worker_buffer_0__");
    expect(buffers).toHaveLength(1);
    expect(buffers[0].name).toBe("buffer_0.bin");
    expect(buffers[0].mime).toBe("application/octet-stream");
    expect(buffers[0].bytes.length).toBeGreaterThan(0);
    expect(images).toHaveLength(0);
  });

  test("data-URI buffers/images are rewritten to pseudo-external URIs by the parse and kept as-is", async () => {
    // QUIRK (pinned): gltf-transform's binaryToJSON rewrites data: URIs into
    // random-named pseudo URIs (__XXXX.bin/.png) backed by the resources map,
    // so the worker's data: extraction branches never fire on this path —
    // the entries read as "external URI" and pass through untouched. Real
    // GLBs carry a BIN chunk + bufferView images instead (covered above).
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [{ uri: `data:application/octet-stream;base64,${b64([9, 9])}`, byteLength: 2 }],
      images: [{ uri: `data:image/png;base64,${b64(PNG_BYTES)}`, mimeType: "image/png" }],
    });

    const { composite, buffers, images } = unwrap(
      await registered.decomposeGlb({ arrayBuffer: glb }),
    );

    expect(buffers).toEqual([]);
    expect(images).toEqual([]);
    expect(composite.buffers[0].uri).toMatch(/^__.+\.bin$/);
    expect(composite.images[0].uri).toMatch(/^__.+\.png$/);
  });

  test("sniffs the MIME type of a bufferView image without one (PNG)", async () => {
    const glb = buildGlb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: PNG_BYTES.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: PNG_BYTES.length }],
        images: [{ bufferView: 0 }],
      },
      new Uint8Array(PNG_BYTES),
    );

    const { composite, images } = unwrap(
      await registered.decomposeGlb({ arrayBuffer: glb }),
    );

    expect(images).toHaveLength(1);
    expect(images[0].name).toBe("texture_0.png");
    expect(images[0].mime).toBe("image/png");
    expect(composite.images[0].uri).toBe("__worker_image_0__");
    expect(composite.images[0].mimeType).toBe("image/png");
  });

  test.each([
    ["jpeg", [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4], "image/jpeg", "jpg"],
    ["webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], "image/webp", "webp"],
    ["ktx2", [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], "image/ktx2", "ktx2"],
    ["gif", [0x47, 0x49, 0x46, 0x38, 1, 2, 3, 4], "image/gif", "gif"],
  ])("detects %s magic bytes in a bufferView image", async (_label, magic, mime, ext) => {
    const glb = buildGlb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: magic.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: magic.length }],
        images: [{ bufferView: 0 }],
      },
      new Uint8Array(magic),
    );

    const { images } = unwrap(await registered.decomposeGlb({ arrayBuffer: glb }));
    expect(images[0].mime).toBe(mime);
    expect(images[0].name).toBe(`texture_0.${ext}`);
  });

  test("bufferView image with unrecognized bytes falls back to the .bin extension", async () => {
    const raw = [0x00, 0x01, 0x02, 0x03, 0x04];
    const glb = buildGlb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: raw.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: raw.length }],
        images: [{ bufferView: 0 }],
      },
      new Uint8Array(raw),
    );

    const { composite, images } = unwrap(
      await registered.decomposeGlb({ arrayBuffer: glb }),
    );
    expect(images[0].name).toBe("texture_0.bin");
    expect(images[0].mime).toBeNull();
    // No sniffed MIME → the composite entry does not gain a mimeType.
    expect(composite.images[0].mimeType).toBeUndefined();
  });

  test("rejects GLBs declaring ipfs:// buffer URIs (gltf-transform parse gate)", async () => {
    // binaryToJSON only handles embedded buffers — a GLB with external
    // buffer refs never reaches the worker's ipfs://-skip branch. Pinned as
    // characterization: that branch is defensive, not live.
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [{ uri: "ipfs://bafyBuf", byteLength: 4 }],
    });

    await expect(
      registered.decomposeGlb({ arrayBuffer: glb }),
    ).rejects.toThrow(/external buffers/);
  });

  test("rejects GLBs declaring external (non-data) buffer URIs", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://cdn.example.com/buf.bin", byteLength: 4 }],
    });

    await expect(
      registered.decomposeGlb({ arrayBuffer: glb }),
    ).rejects.toThrow(/external buffers/);
  });

  const EMBEDDED_BUFFER = {
    uri: `data:application/octet-stream;base64,${b64([9, 9, 9, 9])}`,
    byteLength: 4,
  };

  test("rejects GLBs declaring ipfs:// image URIs (gltf-transform parse gate)", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      images: [{ uri: "ipfs://bafyImg", mimeType: "image/png" }],
    });

    await expect(
      registered.decomposeGlb({ arrayBuffer: glb }),
    ).rejects.toThrow(/external images/);
  });

  test("rejects GLBs declaring external (non-data) image URIs", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      images: [{ uri: "textures/albedo.png" }],
    });

    await expect(
      registered.decomposeGlb({ arrayBuffer: glb }),
    ).rejects.toThrow(/external images/);
  });

  test("rejects GLBs with an image that has neither uri nor bufferView", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      images: [{ name: "orphan" }],
    });

    await expect(
      registered.decomposeGlb({ arrayBuffer: glb }),
    ).rejects.toThrow(/Missing resource URI or buffer view/);
  });

  test("skips an image whose bufferView index does not exist", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      bufferViews: [],
      images: [{ bufferView: 7 }],
    });

    const { images } = unwrap(await registered.decomposeGlb({ arrayBuffer: glb }));
    expect(images).toEqual([]);
  });

  test("skips an image whose bufferView points at a nonexistent buffer", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      bufferViews: [{ buffer: 1, byteOffset: 0, byteLength: 4 }],
      images: [{ bufferView: 0 }],
    });

    const { images } = unwrap(await registered.decomposeGlb({ arrayBuffer: glb }));
    expect(images).toEqual([]);
  });

  test("a data-URI image with an empty payload is likewise kept as-is after the parse rewrite", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      images: [{ uri: "data:image/png;base64," }],
    });

    const { images } = unwrap(await registered.decomposeGlb({ arrayBuffer: glb }));
    expect(images).toEqual([]);
  });

  test("data-URI images with unknown MIME types are also rewritten to pseudo-external URIs", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [EMBEDDED_BUFFER],
      images: [{ uri: `data:application/x-foo;base64,${b64([1, 2, 3, 4])}` }],
    });

    const { composite, images } = unwrap(
      await registered.decomposeGlb({ arrayBuffer: glb }),
    );
    expect(images).toEqual([]);
    expect(composite.images[0].uri).toMatch(/^__.+/);
  });

  test("throws when a buffer has no uri and the GLB carries no BIN chunk", async () => {
    const glb = buildGlb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4 }],
    });

    await expect(
      registered.decomposeGlb({ arrayBuffer: glb }),
    ).rejects.toThrow();
  });

  test("throws on a missing payload", async () => {
    await expect(registered.decomposeGlb({})).rejects.toThrow(
      /arrayBuffer is required/,
    );
  });
});

/**
 * Characterization tests for packages/asset-core glb-parser.ts — the REAL
 * module (parseGLB / decompose / pruneBufferImageData / detectImageMimeType),
 * driven through the public decompose() with an injected writer.
 *
 * Background: test/decomposer-composer.test.js's "GLB Parser" block tests an
 * inlined clone of a long-deleted frontend file — the real decomposer's
 * image-pruning path (CC 60, the repo's highest) had no direct coverage.
 * These tests pin current behavior so pruneBufferImageData can be split and
 * detectImageMimeType can become a signature table.
 *
 * Writer seam: decompose(arrayBuffer, writer) calls writer(bytes, filename)
 * for every component (images first, then buffers, then the composite glTF)
 * and expects a CID back. No IPFS involved.
 */
import { jest } from "@jest/globals";

const { decompose, parseGLB, isGLB } = await import(
  "../packages/asset-core/src/formats/gltf/glb-parser.ts"
);

// ─── Fixtures ───

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const KTX2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const UNKNOWN = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
const MESH = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0x11, 0x22, 0x33, 0x44]);

/** Build a GLB v2 container from a glTF JSON object and binary payload. */
function buildGLB(gltfJson, binaryBytes) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltfJson));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBytes.length + jsonPadding);
  jsonChunk.set(jsonBytes);
  jsonChunk.fill(0x20, jsonBytes.length);

  const binPadding = (4 - (binaryBytes.length % 4)) % 4;
  const binChunk = new Uint8Array(binaryBytes.length + binPadding);
  binChunk.set(binaryBytes);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let offset = 12;
  view.setUint32(offset, jsonChunk.length, true);
  view.setUint32(offset + 4, 0x4e4f534a, true); // "JSON"
  offset += 8;
  bytes.set(jsonChunk, offset);
  offset += jsonChunk.length;
  view.setUint32(offset, binChunk.length, true);
  view.setUint32(offset + 4, 0x004e4942, true); // "BIN\0"
  offset += 8;
  bytes.set(binChunk, offset);
  return buffer;
}

/** Recording writer: returns sequential CIDs, keeps every call. */
function makeWriter() {
  const calls = [];
  const writer = async (bytes, filename) => {
    calls.push({ bytes, filename });
    return `cid-${calls.length}`;
  };
  return { writer, calls };
}

function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

let warnSpy;

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── isGLB / parseGLB ───

test("isGLB rejects short or non-GLB buffers", () => {
  expect(isGLB(new ArrayBuffer(0))).toBe(false);
  expect(isGLB(new ArrayBuffer(20))).toBe(false);
  expect(isGLB(buildGLB({ asset: { version: "2.0" } }, new Uint8Array(0)))).toBe(true);
});

test("parseGLB rejects wrong magic and parses a minimal GLB", async () => {
  const bad = new ArrayBuffer(12);
  new DataView(bad).setUint32(4, 2, true);
  await expect(parseGLB(bad)).rejects.toThrow("invalid magic");

  const gltf = { asset: { version: "2.0" }, buffers: [{ byteLength: MESH.length }] };
  const { json, binaryChunk } = await parseGLB(buildGLB(gltf, MESH));
  expect(json.asset.version).toBe("2.0");
  expect(new Uint8Array(binaryChunk)).toEqual(MESH);
});

// ─── decompose: buffers & composite ───

test("decompose uploads the buffer and writes the composite via the writer", async () => {
  const gltf = { asset: { version: "2.0" }, buffers: [{ byteLength: MESH.length }] };
  const { writer, calls } = makeWriter();
  const { composite, compositeCid } = await decompose(
    buildGLB(gltf, MESH),
    writer,
    { assetName: "hero" }
  );

  expect(calls.map((c) => c.filename)).toEqual(["hero_buffer_0.bin", "hero_composite.gltf"]);
  expect(new Uint8Array(calls[0].bytes)).toEqual(MESH);
  expect(composite.buffers[0].uri).toBe("ipfs://cid-1");
  expect(compositeCid).toBe("cid-2");
});

test("decompose rejects GLBs whose images use external/ipfs URIs (gltf-transform limitation)", async () => {
  // binaryToJSON() must resolve every image resource; http and ipfs URIs are
  // unresolvable inside a GLB container, so parseGLB rejects before decompose
  // sees anything. (Composite glTFs with ipfs:// images never go through
  // decompose as GLB — this only pins the container-level behavior.)
  for (const uri of ["https://example.com/t.png", "ipfs://bafyExisting"]) {
    const gltf = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: MESH.length }],
      images: [{ uri }],
    };
    await expect(
      decompose(buildGLB(gltf, MESH), makeWriter().writer, { assetName: "hero" })
    ).rejects.toThrow("Cannot resolve external images");
  }
});

test("decompose with storeComposite:false skips the composite write", async () => {
  const gltf = { asset: { version: "2.0" }, buffers: [{ byteLength: MESH.length }] };
  const { writer, calls } = makeWriter();
  const { compositeCid } = await decompose(buildGLB(gltf, MESH), writer, {
    assetName: "hero",
    storeComposite: false,
  });
  expect(compositeCid).toBeUndefined();
  expect(calls.map((c) => c.filename)).toEqual(["hero_buffer_0.bin"]);
});

// ─── detectImageMimeType (via decompose filename extensions) ───

const MIME_CASES = [
  ["png", PNG, "image/png"],
  ["jpg", JPEG, "image/jpeg"],
  ["webp", WEBP, "image/webp"],
  ["ktx2", KTX2, "image/ktx2"],
  ["gif", GIF, "image/gif"],
  ["bin", UNKNOWN, undefined],
];

function gltfWithBufferViewImage(imageBytes, withMime) {
  const binary = concat(MESH, imageBytes);
  return {
    gltf: {
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: MESH.length },
        { buffer: 0, byteOffset: MESH.length, byteLength: imageBytes.length },
      ],
      accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC4" }],
      images: [withMime ? { bufferView: 1, mimeType: withMime } : { bufferView: 1 }],
    },
    binary,
  };
}

for (const [ext, magic, expectedMime] of MIME_CASES) {
  test(`magic-byte detection: .${ext}`, async () => {
    const { gltf, binary } = gltfWithBufferViewImage(magic);
    const { writer, calls } = makeWriter();
    const { composite } = await decompose(buildGLB(gltf, binary), writer, { assetName: "hero" });

    expect(calls[0].filename).toBe(`hero_texture_0.${ext}`);
    expect(new Uint8Array(calls[0].bytes)).toEqual(magic);
    if (expectedMime) expect(composite.images[0].mimeType).toBe(expectedMime);
    else expect(composite.images[0].mimeType).toBeUndefined();
    expect(composite.images[0].uri).toBe("ipfs://cid-1");
    expect(composite.images[0].bufferView).toBeUndefined();
  });
}

test("an explicit image mimeType wins over magic-byte detection", async () => {
  const { gltf, binary } = gltfWithBufferViewImage(PNG, "image/jpeg");
  const { writer, calls } = makeWriter();
  await decompose(buildGLB(gltf, binary), writer, { assetName: "hero" });
  expect(calls[0].filename).toBe("hero_texture_0.jpg");
});

// ─── pruneBufferImageData (via decompose buffer output) ───

test("image bytes are pruned from the buffer after extraction", async () => {
  const { gltf, binary } = gltfWithBufferViewImage(PNG);
  const { writer, calls } = makeWriter();
  const { composite } = await decompose(buildGLB(gltf, binary), writer, { assetName: "hero" });

  // The image bufferView is gone, the accessor's reference is renumbered,
  // and the stored buffer holds only the mesh bytes.
  expect(composite.bufferViews).toHaveLength(1);
  expect(composite.accessors[0].bufferView).toBe(0);
  expect(composite.buffers[0].byteLength).toBe(MESH.length);
  const bufferCall = calls.find((c) => c.filename === "hero_buffer_0.bin");
  expect(new Uint8Array(bufferCall.bytes)).toEqual(MESH);
});

test("bufferViews after a pruned image get their offsets shifted down", async () => {
  // Image FIRST in the buffer, mesh second — pruning shifts the mesh to 0.
  const binary = concat(PNG, MESH);
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: PNG.length },
      { buffer: 0, byteOffset: PNG.length, byteLength: MESH.length },
    ],
    accessors: [{ bufferView: 1, componentType: 5126, count: 2, type: "VEC4" }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
  };
  const { writer, calls } = makeWriter();
  const { composite } = await decompose(buildGLB(gltf, binary), writer, { assetName: "hero" });

  expect(composite.bufferViews).toHaveLength(1);
  expect(composite.bufferViews[0].byteOffset).toBe(0);
  expect(composite.accessors[0].bufferView).toBe(0);
  const bufferCall = calls.find((c) => c.filename === "hero_buffer_0.bin");
  expect(new Uint8Array(bufferCall.bytes)).toEqual(MESH);
});

test("two images in one buffer are both extracted and both ranges pruned", async () => {
  const binary = concat(MESH.slice(0, 4), PNG, JPEG);
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 4 },
      { buffer: 0, byteOffset: 4, byteLength: PNG.length },
      { buffer: 0, byteOffset: 4 + PNG.length, byteLength: JPEG.length },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: "VEC4" }],
    images: [{ bufferView: 1 }, { bufferView: 2 }],
  };
  const { writer, calls } = makeWriter();
  const { composite } = await decompose(buildGLB(gltf, binary), writer, { assetName: "hero" });

  expect(calls[0].filename).toBe("hero_texture_0.png");
  expect(calls[1].filename).toBe("hero_texture_1.jpg");
  expect(composite.bufferViews).toHaveLength(1);
  expect(composite.buffers[0].byteLength).toBe(4);
  const bufferCall = calls.find((c) => c.filename === "hero_buffer_0.bin");
  expect(new Uint8Array(bufferCall.bytes)).toEqual(MESH.slice(0, 4));
});

test("an image bufferView also referenced by an accessor is NOT pruned", async () => {
  const binary = concat(MESH, PNG);
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: MESH.length },
      { buffer: 0, byteOffset: MESH.length, byteLength: PNG.length },
    ],
    // The accessor points at the SAME bufferView the image uses — pruning it
    // would corrupt the geometry, so the pruner must back off.
    accessors: [{ bufferView: 1, componentType: 5126, count: 2, type: "VEC4" }],
    images: [{ bufferView: 1 }],
  };
  const { writer, calls } = makeWriter();
  const { composite } = await decompose(buildGLB(gltf, binary), writer, { assetName: "hero" });

  // The image is still extracted to IPFS…
  expect(composite.images[0].uri).toBe("ipfs://cid-1");
  // …but the buffer keeps its image bytes, un-renumbered.
  expect(warnSpy.mock.calls.join("\n")).toContain("also referenced by accessors/extensions");
  expect(composite.bufferViews).toHaveLength(2);
  expect(composite.buffers[0].byteLength).toBe(binary.length);
  const bufferCall = calls.find((c) => c.filename === "hero_buffer_0.bin");
  expect(new Uint8Array(bufferCall.bytes)).toEqual(binary);
});

// ─── data-URI images ───

test("a data-URI image survives parsing as a placeholder URI and is kept as-is (KNOWN GAP)", async () => {
  // gltf-transform's binaryToJSON rewrites data-URI images to resource
  // placeholders ("__<id>.png") and drops the bytes from the JSON; decompose
  // only reads resources[GLB_BUFFER], so the image bytes are lost and the
  // composite keeps the mangled placeholder URI. This pins the CURRENT
  // behavior — it is a latent bug, flagged for a separate fix.
  const dataUri = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: MESH.length }],
    images: [{ uri: dataUri }],
  };
  const { writer, calls } = makeWriter();
  const { composite } = await decompose(buildGLB(gltf, MESH), writer, { assetName: "hero" });

  expect(composite.images[0].uri).toMatch(/^__.*\.png$/);
  expect(calls.some((c) => c.filename.includes("texture"))).toBe(false);
  const bufferCall = calls.find((c) => c.filename === "hero_buffer_0.bin");
  expect(new Uint8Array(bufferCall.bytes)).toEqual(MESH);
});

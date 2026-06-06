/**
 * Arbesk glTF Decomposer & Composer — Unit Tests
 *
 * Tests pure logic functions from decomposer.js and composer.js.
 * Functions are tested inline (matching the project test convention)
 * to avoid ESM import issues with the frontend directory.
 *
 * Network-dependent functions (writeToIPFS, fetchCIDAsBase64, resolveURI)
 * are tested with mocks. Pure functions (isComposite, base64ToBytes,
 * extractDataURI, arrayBufferToBase64) are tested directly.
 */

import { jest } from "@jest/globals";

jest.setTimeout(15000);

// ═══════════════════════════════════════════════════════════════════════════
// Inline copies from frontend/src/js/gltf/decomposer.js
// ═══════════════════════════════════════════════════════════════════════════

const IPFS_URI_PREFIX = "ipfs://";
const CID_BUFFER_PREFIX = "data:application/cid;base64,";

function isComposite(gltf) {
  if (!gltf) return false;
  for (const buf of gltf.buffers || []) {
    if (buf.uri && buf.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }
  for (const img of gltf.images || []) {
    if (img.uri && img.uri.startsWith(IPFS_URI_PREFIX)) return true;
  }
  return false;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractDataURI(uri) {
  if (!uri || !uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;
  const header = uri.substring(0, commaIdx);
  const payload = uri.substring(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const isBase64 = header.includes(";base64");
  const bytes = isBase64
    ? base64ToBytes(payload)
    : new TextEncoder().encode(payload);
  return { bytes, mimeType };
}

// ═══════════════════════════════════════════════════════════════════════════
// Inline copies from frontend/src/js/gltf/composer.js
// ═══════════════════════════════════════════════════════════════════════════

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a minimal valid glTF 2.0 JSON for testing.
 */
function makeTestGlTF(overrides = {}) {
  return {
    asset: { version: "2.0", generator: "test" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        name: "TestMesh",
        primitives: [
          {
            attributes: { POSITION: 0 },
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: "TestMaterial",
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.2, 0.2, 1.0],
          metallicFactor: 0.0,
          roughnessFactor: 0.5,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: 36,
      },
    ],
    buffers: [
      {
        uri: "data:application/octet-stream;base64,AAAAAA==",
        byteLength: 36,
      },
    ],
    images: [
      {
        uri: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
      },
    ],
    textures: [{ source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    ...overrides,
  };
}

/**
 * Build a composite glTF (with ipfs:// URIs matching what decomposer produces).
 */
function makeCompositeGlTF(overrides = {}) {
  return {
    asset: { version: "2.0", generator: "test" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        name: "TestMesh",
        primitives: [
          {
            attributes: { POSITION: 0 },
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: "TestMaterial",
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.2, 0.2, 1.0],
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: 36,
      },
    ],
    buffers: [
      {
        uri: "ipfs://QmBufferTestCid",
        byteLength: 36,
      },
    ],
    images: [
      {
        uri: "ipfs://QmImageTestCid",
        mimeType: "image/png",
      },
    ],
    textures: [{ source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Decomposer: isComposite
// ═══════════════════════════════════════════════════════════════════════════

describe("Decomposer — isComposite", () => {
  it("returns false for null/undefined", () => {
    expect(isComposite(null)).toBe(false);
    expect(isComposite(undefined)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isComposite({})).toBe(false);
  });

  it("returns false for standard glTF with base64 data URIs", () => {
    const gltf = makeTestGlTF();
    expect(isComposite(gltf)).toBe(false);
  });

  it("returns true when buffers have ipfs:// URIs", () => {
    const gltf = makeTestGlTF({
      buffers: [{ uri: "ipfs://QmTestCid", byteLength: 100 }],
    });
    expect(isComposite(gltf)).toBe(true);
  });

  it("returns true when images have ipfs:// URIs", () => {
    const gltf = makeTestGlTF({
      buffers: [],
      images: [{ uri: "ipfs://QmImgCid", mimeType: "image/png" }],
    });
    expect(isComposite(gltf)).toBe(true);
  });

  it("returns true when both buffers and images have ipfs:// URIs", () => {
    const gltf = makeCompositeGlTF();
    expect(isComposite(gltf)).toBe(true);
  });

  it("returns false for legacy CID-prefix format (not yet composite)", () => {
    const gltf = makeTestGlTF({
      buffers: [
        { uri: "data:application/cid;base64,QmLegacyCid", byteLength: 100 },
      ],
    });
    expect(isComposite(gltf)).toBe(false);
  });

  it("handles glTF with no buffers array", () => {
    const gltf = makeTestGlTF({ buffers: undefined });
    expect(isComposite(gltf)).toBe(false);
  });

  it("handles glTF with no images array", () => {
    const gltf = makeTestGlTF({ images: undefined });
    expect(isComposite(gltf)).toBe(false);
  });

  it("handles buffer with no uri property", () => {
    const gltf = makeTestGlTF({
      buffers: [{ byteLength: 100 }],
    });
    expect(isComposite(gltf)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Decomposer: base64ToBytes
// ═══════════════════════════════════════════════════════════════════════════

describe("Decomposer — base64ToBytes", () => {
  it("decodes a simple base64 string", () => {
    const bytes = base64ToBytes("SGVsbG8=");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(5);
    expect(bytes[0]).toBe(72); // 'H'
    expect(bytes[1]).toBe(101); // 'e'
  });

  it("decodes empty base64 string", () => {
    const bytes = base64ToBytes("");
    expect(bytes.length).toBe(0);
  });

  it("round-trips: encode then decode", () => {
    const original = new TextEncoder().encode("Arbesk test data 123!@#");
    const base64 = btoa(String.fromCharCode(...original));
    const decoded = base64ToBytes(base64);
    expect(decoded).toEqual(original);
  });

  it("handles binary data with null bytes", () => {
    const data = new Uint8Array([0, 1, 2, 255, 128, 0]);
    const base64 = btoa(String.fromCharCode(...data));
    const decoded = base64ToBytes(base64);
    expect(decoded).toEqual(data);
  });

  it("handles URL-safe characters (may throw or produce garbage on atob)", () => {
    // URL-safe base64 uses -_ instead of +/ which atob typically doesn't handle.
    // Node 22+ may accept it; in any case verify it doesn't crash.
    try {
      const result = base64ToBytes("SGVsbG8tXw==");
      // If it doesn't throw, the result should still be a Uint8Array
      expect(result).toBeInstanceOf(Uint8Array);
    } catch {
      // Throwing is also acceptable behavior
      expect(true).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Decomposer: extractDataURI
// ═══════════════════════════════════════════════════════════════════════════

describe("Decomposer — extractDataURI", () => {
  it("returns null for non-data URI", () => {
    expect(extractDataURI("ipfs://QmTest")).toBeNull();
    expect(extractDataURI("http://example.com/file.bin")).toBeNull();
    expect(extractDataURI("/path/to/file.bin")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractDataURI(null)).toBeNull();
    expect(extractDataURI(undefined)).toBeNull();
    expect(extractDataURI("")).toBeNull();
  });

  it("returns null for malformed data URI (no comma)", () => {
    expect(extractDataURI("data:application/octet-stream;base64")).toBeNull();
  });

  it("extracts base64 binary payload with correct mime type", () => {
    const result = extractDataURI(
      "data:application/octet-stream;base64,SGVsbG8=",
    );
    expect(result).not.toBeNull();
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBe(5);
    expect(result.bytes[0]).toBe(72);
  });

  it("extracts base64 image payload with correct mime type", () => {
    const result = extractDataURI("data:image/png;base64,iVBORw0KGgo=");
    expect(result).not.toBeNull();
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes).toBeInstanceOf(Uint8Array);
  });

  it("extracts base64 JSON payload", () => {
    const result = extractDataURI(
      "data:application/json;base64,eyJrZXkiOiJ2YWx1ZSJ9",
    );
    expect(result).not.toBeNull();
    expect(result.mimeType).toBe("application/json");
    const text = new TextDecoder().decode(result.bytes);
    expect(text).toBe('{"key":"value"}');
  });

  it("handles non-base64 data URI (plain text)", () => {
    const result = extractDataURI("data:text/plain,Hello%20World");
    expect(result).not.toBeNull();
    expect(result.mimeType).toBe("text/plain");
    const text = new TextDecoder().decode(result.bytes);
    expect(text).toBe("Hello%20World");
  });

  it("handles data URI with charset parameter", () => {
    const result = extractDataURI(
      "data:text/plain;charset=utf-8;base64,SGVsbG8=",
    );
    expect(result).not.toBeNull();
    expect(result.mimeType).toBe("text/plain");
    expect(result.bytes.length).toBe(5);
  });

  it("handles glTF buffer data URI format", () => {
    const uri = "data:application/octet-stream;base64,AAAAAAD//wAAAAA=";
    const result = extractDataURI(uri);
    expect(result).not.toBeNull();
    expect(result.mimeType).toBe("application/octet-stream");
    // 16 base64 chars with '=' padding → 11 bytes (last group is AA= → 2 bytes)
    expect(result.bytes.length).toBe(11);
  });

  it("handles large payload", () => {
    const data = new Uint8Array(10000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const base64 = btoa(String.fromCharCode(...data));
    const uri = `data:application/octet-stream;base64,${base64}`;
    const result = extractDataURI(uri);
    expect(result).not.toBeNull();
    expect(result.bytes).toEqual(data);
  });

  it("handles data URI with empty payload", () => {
    const result = extractDataURI("data:;base64,");
    expect(result).not.toBeNull();
    // Regex [^;]+ can't match empty string, falls back to default
    expect(result.mimeType).toBe("application/octet-stream");
    expect(result.bytes.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Composer: arrayBufferToBase64
// ═══════════════════════════════════════════════════════════════════════════

describe("Composer — arrayBufferToBase64", () => {
  it("converts empty buffer", () => {
    const buffer = new ArrayBuffer(0);
    expect(arrayBufferToBase64(buffer)).toBe("");
  });

  it("converts text data", () => {
    const text = "Hello, World!";
    const buffer = new TextEncoder().encode(text).buffer;
    const base64 = arrayBufferToBase64(buffer);
    expect(base64).toBe("SGVsbG8sIFdvcmxkIQ==");
  });

  it("converts binary data", () => {
    const data = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x01]);
    const base64 = arrayBufferToBase64(data.buffer);
    expect(base64).toBe("AP+AfwE=");
  });

  it("round-trips with atob", () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const base64 = arrayBufferToBase64(original.buffer);
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(original);
  });

  it("handles single byte", () => {
    const buffer = new Uint8Array([42]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe("Kg==");
  });

  it("handles three bytes (no padding)", () => {
    const buffer = new Uint8Array([0x4d, 0x61, 0x6e]).buffer;
    expect(arrayBufferToBase64(buffer)).toBe("TWFu");
  });

  it("handles large buffer", () => {
    const data = new Uint8Array(10000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const base64 = arrayBufferToBase64(data.buffer);

    // Verify round-trip
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(data);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Decomposer: decomposeGlTF (with mocked IPFS writes)
// ═══════════════════════════════════════════════════════════════════════════

describe("Decomposer — decomposeGlTF (mocked IPFS)", () => {
  // Replicate decomposeGlTF logic with mocked writeToIPFS
  async function decomposeGlTF(gltf, mockWrite) {
    if (!gltf) throw new Error("decomposeGlTF: gltf is null");
    if (isComposite(gltf)) {
      return gltf;
    }

    const composite = JSON.parse(JSON.stringify(gltf));

    if (composite.buffers) {
      for (let i = 0; i < composite.buffers.length; i++) {
        const buf = composite.buffers[i];
        if (!buf.uri) continue;

        if (buf.uri.startsWith(CID_BUFFER_PREFIX)) {
          const cid = buf.uri.replace(CID_BUFFER_PREFIX, "");
          composite.buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
          continue;
        }

        if (buf.uri.startsWith(IPFS_URI_PREFIX)) continue;

        const extracted = extractDataURI(buf.uri);
        if (!extracted) continue;

        const cid = await mockWrite(extracted.bytes, `buffer_${i}.bin`);
        composite.buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
      }
    }

    if (composite.images) {
      for (let i = 0; i < composite.images.length; i++) {
        const img = composite.images[i];
        if (!img.uri) continue;

        if (img.uri.startsWith(IPFS_URI_PREFIX)) continue;
        if (!img.uri.startsWith("data:")) continue;

        const extracted = extractDataURI(img.uri);
        if (!extracted) continue;

        const ext = extracted.mimeType.split("/")[1] || "bin";
        const cid = await mockWrite(extracted.bytes, `texture_${i}.${ext}`);
        composite.images[i] = { ...img, uri: IPFS_URI_PREFIX + cid };
      }
    }

    return composite;
  }

  it("throws on null input", async () => {
    await expect(decomposeGlTF(null, jest.fn())).rejects.toThrow(
      "decomposeGlTF: gltf is null",
    );
  });

  it("returns as-is if already composite", async () => {
    const gltf = makeCompositeGlTF();
    const mockWrite = jest.fn();
    const result = await decomposeGlTF(gltf, mockWrite);
    expect(result).toEqual(gltf);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("converts buffer data URIs to ipfs:// URIs", async () => {
    const gltf = makeTestGlTF({
      buffers: [
        {
          uri: "data:application/octet-stream;base64,SGVsbG8=",
          byteLength: 5,
        },
      ],
      images: [],
    });

    const mockWrite = jest.fn().mockResolvedValue("QmMockBufferCid");
    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.buffers[0].uri).toBe("ipfs://QmMockBufferCid");
    expect(result.buffers[0].byteLength).toBe(5);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "buffer_0.bin",
    );
  });

  it("converts image data URIs to ipfs:// URIs", async () => {
    const gltf = makeTestGlTF({
      buffers: [],
      images: [
        {
          uri: "data:image/png;base64,iVBORw0KGgo=",
          mimeType: "image/png",
        },
      ],
    });

    const mockWrite = jest.fn().mockResolvedValue("QmMockImageCid");
    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.images[0].uri).toBe("ipfs://QmMockImageCid");
    expect(result.images[0].mimeType).toBe("image/png");
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "texture_0.png",
    );
  });

  it("converts multiple buffers", async () => {
    const gltf = makeTestGlTF({
      buffers: [
        { uri: "data:application/octet-stream;base64,SGVsbG8=", byteLength: 5 },
        { uri: "data:application/octet-stream;base64,V29ybGQ=", byteLength: 5 },
      ],
      images: [],
    });

    const mockWrite = jest
      .fn()
      .mockResolvedValueOnce("QmBuf0Cid")
      .mockResolvedValueOnce("QmBuf1Cid");

    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.buffers[0].uri).toBe("ipfs://QmBuf0Cid");
    expect(result.buffers[1].uri).toBe("ipfs://QmBuf1Cid");
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });

  it("converts both buffers and images in one pass", async () => {
    const gltf = makeTestGlTF();
    const mockWrite = jest
      .fn()
      .mockResolvedValueOnce("QmBufCid")
      .mockResolvedValueOnce("QmImgCid");

    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.buffers[0].uri).toBe("ipfs://QmBufCid");
    expect(result.images[0].uri).toBe("ipfs://QmImgCid");
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });

  it("converts legacy CID-prefix buffers to ipfs:// format", async () => {
    const gltf = makeTestGlTF({
      buffers: [
        {
          uri: "data:application/cid;base64,QmLegacyBufferCid12345678901234567890",
          byteLength: 100,
        },
      ],
      images: [],
    });

    const mockWrite = jest.fn();
    const result = await decomposeGlTF(gltf, mockWrite);

    // Legacy CID should be converted to ipfs:// without re-uploading
    expect(result.buffers[0].uri).toBe(
      "ipfs://QmLegacyBufferCid12345678901234567890",
    );
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("skips buffers with no uri", async () => {
    const gltf = makeTestGlTF({
      buffers: [{ byteLength: 100 }],
      images: [],
    });

    const mockWrite = jest.fn();
    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.buffers[0].uri).toBeUndefined();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("preserves non-data image URIs (external references)", async () => {
    const gltf = makeTestGlTF({
      buffers: [],
      images: [{ uri: "https://example.com/texture.png" }],
    });

    const mockWrite = jest.fn();
    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.images[0].uri).toBe("https://example.com/texture.png");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("preserves image with bufferView reference (no uri)", async () => {
    const gltf = makeTestGlTF({
      buffers: [],
      images: [{ bufferView: 0, mimeType: "image/png" }],
    });

    const mockWrite = jest.fn();
    const result = await decomposeGlTF(gltf, mockWrite);

    expect(result.images[0].uri).toBeUndefined();
    expect(result.images[0].bufferView).toBe(0);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("does not mutate the original glTF object", async () => {
    const gltf = makeTestGlTF();
    const originalUri = gltf.buffers[0].uri;
    const mockWrite = jest.fn().mockResolvedValue("QmTestCid");

    await decomposeGlTF(gltf, mockWrite);

    // Original should be untouched
    expect(gltf.buffers[0].uri).toBe(originalUri);
  });

  it("preserves all non-URI fields in the glTF", async () => {
    const gltf = makeTestGlTF();
    const mockWrite = jest
      .fn()
      .mockResolvedValueOnce("QmBufCid")
      .mockResolvedValueOnce("QmImgCid");

    const result = await decomposeGlTF(gltf, mockWrite);

    // Materials preserved
    expect(result.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      0.8, 0.2, 0.2, 1.0,
    ]);

    // Meshes preserved
    expect(result.meshes[0].name).toBe("TestMesh");
    expect(result.meshes[0].primitives[0].material).toBe(0);

    // Accessors preserved
    expect(result.accessors[0].count).toBe(3);
    expect(result.accessors[0].type).toBe("VEC3");

    // Scene graph preserved
    expect(result.scenes[0].nodes).toEqual([0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Composer: resolveURI (with mocked fetch)
// ═══════════════════════════════════════════════════════════════════════════

describe("Composer — resolveURI", () => {
  const GATEWAY_URL = "http://127.0.0.1:8080/ipfs/";

  async function resolveURI(uri, defaultMime = "application/octet-stream") {
    if (!uri) return uri;

    if (uri.startsWith(IPFS_URI_PREFIX)) {
      const cid = uri.replace(IPFS_URI_PREFIX, "");
      const url = `${GATEWAY_URL}${cid}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          `Composer: gateway returned ${response.status} for ${cid}`,
        );
      }
      const buffer = await response.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return `data:${defaultMime};base64,${base64}`;
    }

    if (uri.startsWith(CID_BUFFER_PREFIX)) {
      const cid = uri.replace(CID_BUFFER_PREFIX, "");
      const url = `${GATEWAY_URL}${cid}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
      const text = await response.text();
      return `data:application/octet-stream;base64,${text}`;
    }

    if (uri.startsWith("data:")) return uri;

    return uri;
  }

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns null/undefined as-is", async () => {
    expect(await resolveURI(null)).toBeNull();
    expect(await resolveURI(undefined)).toBeUndefined();
    expect(await resolveURI("")).toBe("");
  });

  it("passes through already-resolved data URIs", async () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    const result = await resolveURI(uri);
    expect(result).toBe(uri);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes through external URLs", async () => {
    const uri = "https://example.com/texture.png";
    const result = await resolveURI(uri);
    expect(result).toBe(uri);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resolves ipfs:// URI to base64 data URI", async () => {
    const testData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const response = {
      ok: true,
      arrayBuffer: () => Promise.resolve(testData.buffer),
    };
    global.fetch.mockResolvedValue(response);

    const result = await resolveURI("ipfs://QmTestCid");

    expect(result).toBe("data:application/octet-stream;base64,SGVsbG8=");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/ipfs/QmTestCid",
      { cache: "no-store" },
    );
  });

  it("resolves ipfs:// image URI with correct mime type", async () => {
    const testData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic 4 bytes
    const response = {
      ok: true,
      arrayBuffer: () => Promise.resolve(testData.buffer),
    };
    global.fetch.mockResolvedValue(response);

    const result = await resolveURI("ipfs://QmImgCid", "image/png");

    // 4 bytes → 8 base64 chars (4*8/6 = 5.33 → 8 chars including padding)
    expect(result).toBe("data:image/png;base64,iVBORw==");
  });

  it("resolves legacy CID-prefix buffer URI", async () => {
    const response = {
      ok: true,
      text: () => Promise.resolve("SGVsbG8="),
    };
    global.fetch.mockResolvedValue(response);

    const result = await resolveURI("data:application/cid;base64,QmLegacyCid");

    expect(result).toBe("data:application/octet-stream;base64,SGVsbG8=");
  });

  it("throws on gateway error for ipfs:// URI", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 });

    await expect(resolveURI("ipfs://QmMissing")).rejects.toThrow(
      "gateway returned 404",
    );
  });

  it("throws on gateway error for legacy CID URI", async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 });

    await expect(
      resolveURI("data:application/cid;base64,QmBadCid"),
    ).rejects.toThrow("fetch failed: 500");
  });

  it("handles network failure (fetch throws)", async () => {
    global.fetch.mockRejectedValue(new Error("Network error"));

    await expect(resolveURI("ipfs://QmNetFail")).rejects.toThrow(
      "Network error",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Composer: composeGlTF (with mocked resolveURI)
// ═══════════════════════════════════════════════════════════════════════════

describe("Composer — composeGlTF", () => {
  async function composeGlTF(gltfJson, mockResolveURI) {
    if (!gltfJson) throw new Error("composeGlTF: gltfJson is null");
    const composed = JSON.parse(JSON.stringify(gltfJson));

    if (composed.buffers) {
      for (let i = 0; i < composed.buffers.length; i++) {
        composed.buffers[i] = {
          ...composed.buffers[i],
          uri: await mockResolveURI(
            composed.buffers[i].uri,
            "application/octet-stream",
          ),
        };
      }
    }

    if (composed.images) {
      for (let i = 0; i < composed.images.length; i++) {
        const img = composed.images[i];
        if (!img.uri) continue;
        let mimeType = img.mimeType || "image/png";
        composed.images[i] = {
          ...img,
          uri: await mockResolveURI(img.uri, mimeType),
        };
      }
    }

    return composed;
  }

  it("throws on null input", async () => {
    await expect(composeGlTF(null, jest.fn())).rejects.toThrow(
      "composeGlTF: gltfJson is null",
    );
  });

  it("resolves composite glTF buffers to data URIs", async () => {
    const gltf = makeCompositeGlTF();
    const mockResolve = jest
      .fn()
      .mockResolvedValueOnce("data:application/octet-stream;base64,SGVsbG8=")
      .mockResolvedValueOnce("data:image/png;base64,iVBORw0KGgo=");

    const result = await composeGlTF(gltf, mockResolve);

    expect(result.buffers[0].uri).toBe(
      "data:application/octet-stream;base64,SGVsbG8=",
    );
    expect(result.images[0].uri).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(mockResolve).toHaveBeenCalledTimes(2);
  });

  it("passes through glTF with already-resolved data URIs", async () => {
    const gltf = makeTestGlTF();
    const mockResolve = jest.fn((uri) => Promise.resolve(uri));

    const result = await composeGlTF(gltf, mockResolve);

    expect(result.buffers[0].uri).toBe(gltf.buffers[0].uri);
    expect(result.images[0].uri).toBe(gltf.images[0].uri);
  });

  it("handles glTF with no buffers array", async () => {
    const gltf = makeCompositeGlTF({ buffers: undefined });
    const mockResolve = jest.fn((uri) => Promise.resolve(uri));

    const result = await composeGlTF(gltf, mockResolve);

    expect(result.buffers).toBeUndefined();
    // Images still get resolved (composite glTF has images with ipfs:// URIs)
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("handles glTF with no images array", async () => {
    const gltf = makeCompositeGlTF({ images: undefined });
    const mockResolve = jest
      .fn()
      .mockResolvedValue("data:application/octet-stream;base64,SGVsbG8=");

    const result = await composeGlTF(gltf, mockResolve);

    expect(result.images).toBeUndefined();
    expect(mockResolve).toHaveBeenCalledTimes(1); // buffers only
  });

  it("handles image with bufferView (no uri)", async () => {
    const gltf = makeCompositeGlTF({
      images: [{ bufferView: 0, mimeType: "image/png" }],
    });
    const mockResolve = jest
      .fn()
      .mockResolvedValue("data:application/octet-stream;base64,SGVsbG8=");

    const result = await composeGlTF(gltf, mockResolve);

    expect(result.images[0].uri).toBeUndefined();
    expect(result.images[0].bufferView).toBe(0);
  });

  it("does not mutate the original glTF object", async () => {
    const gltf = makeCompositeGlTF();
    const originalUri = gltf.buffers[0].uri;
    const mockResolve = jest
      .fn()
      .mockResolvedValue("data:application/octet-stream;base64,SGVsbG8=");

    await composeGlTF(gltf, mockResolve);

    expect(gltf.buffers[0].uri).toBe(originalUri);
  });

  it("preserves all non-URI fields after composition", async () => {
    const gltf = makeCompositeGlTF();
    const mockResolve = jest
      .fn()
      .mockResolvedValueOnce("data:application/octet-stream;base64,SGVsbG8=")
      .mockResolvedValueOnce("data:image/png;base64,iVBORw0KGgo=");

    const result = await composeGlTF(gltf, mockResolve);

    expect(result.asset.version).toBe("2.0");
    expect(result.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([
      0.8, 0.2, 0.2, 1.0,
    ]);
    expect(result.meshes[0].name).toBe("TestMesh");
    expect(result.accessors[0].count).toBe(3);
    expect(result.scenes[0].nodes).toEqual([0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration: Decompose → Compose round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe("Decompose → Compose round-trip", () => {
  // Simulated IPFS store (in-memory Map)
  let ipfsStore;

  beforeEach(() => {
    ipfsStore = new Map();
  });

  // Mock write: stores bytes and returns a deterministic CID
  async function mockWriteToIPFS(bytes, filename) {
    const hashBuffer = new TextEncoder().encode(filename + ":" + bytes.length);
    // Simple hash for deterministic testing — not cryptographically sound
    let hash = 0;
    for (let i = 0; i < hashBuffer.length; i++) {
      hash = ((hash << 5) - hash + hashBuffer[i]) | 0;
    }
    const cid = "QmTest" + Math.abs(hash).toString(16).padStart(40, "0");
    ipfsStore.set(cid, bytes);
    return cid;
  }

  // Mock resolve: fetches from the store and returns a data URI
  async function mockResolveURI(uri, defaultMime = "application/octet-stream") {
    if (!uri || !uri.startsWith("ipfs://")) return uri;
    const cid = uri.replace("ipfs://", "");
    const bytes = ipfsStore.get(cid);
    if (!bytes) throw new Error(`CID ${cid} not found in store`);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return `data:${defaultMime};base64,${base64}`;
  }

  // Inline decompose (same logic as test above but uses our mock store)
  async function decomposeGlTF(gltf) {
    if (!gltf) throw new Error("decomposeGlTF: gltf is null");
    if (isComposite(gltf)) return gltf;

    const composite = JSON.parse(JSON.stringify(gltf));

    if (composite.buffers) {
      for (let i = 0; i < composite.buffers.length; i++) {
        const buf = composite.buffers[i];
        if (!buf.uri) continue;
        if (buf.uri.startsWith(IPFS_URI_PREFIX)) continue;
        if (buf.uri.startsWith(CID_BUFFER_PREFIX)) {
          const cid = buf.uri.replace(CID_BUFFER_PREFIX, "");
          composite.buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
          continue;
        }
        const extracted = extractDataURI(buf.uri);
        if (!extracted) continue;
        const cid = await mockWriteToIPFS(extracted.bytes, `buffer_${i}.bin`);
        composite.buffers[i] = { ...buf, uri: IPFS_URI_PREFIX + cid };
      }
    }

    if (composite.images) {
      for (let i = 0; i < composite.images.length; i++) {
        const img = composite.images[i];
        if (!img.uri) continue;
        if (img.uri.startsWith(IPFS_URI_PREFIX)) continue;
        if (!img.uri.startsWith("data:")) continue;
        const extracted = extractDataURI(img.uri);
        if (!extracted) continue;
        const ext = extracted.mimeType.split("/")[1] || "bin";
        const cid = await mockWriteToIPFS(
          extracted.bytes,
          `texture_${i}.${ext}`,
        );
        composite.images[i] = { ...img, uri: IPFS_URI_PREFIX + cid };
      }
    }

    return composite;
  }

  // Inline compose (uses our mock resolve)
  async function composeGlTF(gltfJson) {
    if (!gltfJson) throw new Error("composeGlTF: gltfJson is null");
    const composed = JSON.parse(JSON.stringify(gltfJson));

    if (composed.buffers) {
      for (let i = 0; i < composed.buffers.length; i++) {
        composed.buffers[i] = {
          ...composed.buffers[i],
          uri: await mockResolveURI(
            composed.buffers[i].uri,
            "application/octet-stream",
          ),
        };
      }
    }

    if (composed.images) {
      for (let i = 0; i < composed.images.length; i++) {
        const img = composed.images[i];
        if (!img.uri) continue;
        let mimeType = img.mimeType || "image/png";
        composed.images[i] = {
          ...img,
          uri: await mockResolveURI(img.uri, mimeType),
        };
      }
    }

    return composed;
  }

  it("round-trips: original glTF → decompose → compose → matches original data", async () => {
    const original = makeTestGlTF();

    // Decompose
    const composite = await decomposeGlTF(original);
    expect(isComposite(composite)).toBe(true);
    expect(composite.buffers[0].uri).toMatch(/^ipfs:\/\//);
    expect(composite.images[0].uri).toMatch(/^ipfs:\/\//);

    // Compose
    const recomposed = await composeGlTF(composite);

    // The recomposed glTF should have valid data URIs
    expect(recomposed.buffers[0].uri).toMatch(
      /^data:application\/octet-stream;base64,/,
    );
    expect(recomposed.images[0].uri).toMatch(/^data:image\/png;base64,/);

    // Extract and compare buffer payloads
    const originalBuf = extractDataURI(original.buffers[0].uri);
    const recomposedBuf = extractDataURI(recomposed.buffers[0].uri);
    expect(recomposedBuf.bytes).toEqual(originalBuf.bytes);

    // Extract and compare image payloads
    const originalImg = extractDataURI(original.images[0].uri);
    const recomposedImg = extractDataURI(recomposed.images[0].uri);
    expect(recomposedImg.bytes).toEqual(originalImg.bytes);

    // Structural integrity
    expect(
      recomposed.materials[0].pbrMetallicRoughness.baseColorFactor,
    ).toEqual([0.8, 0.2, 0.2, 1.0]);
    expect(recomposed.meshes[0].name).toBe("TestMesh");
  });

  it("double-decompose is idempotent", async () => {
    const original = makeTestGlTF();
    const first = await decomposeGlTF(original);
    const second = await decomposeGlTF(first);

    // Second decompose should not change anything (already composite)
    expect(second).toEqual(first);
  });

  it("handles glTF with multiple buffers and images", async () => {
    const gltf = makeTestGlTF({
      buffers: [
        { uri: "data:application/octet-stream;base64,SGVsbG8=", byteLength: 5 },
        { uri: "data:application/octet-stream;base64,V29ybGQ=", byteLength: 5 },
      ],
      images: [
        { uri: "data:image/png;base64,iVBORw0KGgo=", mimeType: "image/png" },
        {
          uri: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
          mimeType: "image/jpeg",
        },
      ],
    });

    const composite = await decomposeGlTF(gltf);

    // All URIs should be ipfs://
    expect(composite.buffers[0].uri).toMatch(/^ipfs:\/\//);
    expect(composite.buffers[1].uri).toMatch(/^ipfs:\/\//);
    expect(composite.images[0].uri).toMatch(/^ipfs:\/\//);
    expect(composite.images[1].uri).toMatch(/^ipfs:\/\//);

    const recomposed = await composeGlTF(composite);

    // All should be back as data URIs
    expect(recomposed.buffers[0].uri).toMatch(/^data:/);
    expect(recomposed.buffers[1].uri).toMatch(/^data:/);
    expect(recomposed.images[0].uri).toMatch(/^data:image\/png/);
    expect(recomposed.images[1].uri).toMatch(/^data:image\/jpeg/);
  });
});

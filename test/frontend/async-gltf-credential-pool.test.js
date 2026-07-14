/** @jest-environment jsdom */
import {
  estimateUploadCount,
  estimateGlbUploadCount,
  reserveFollowUpCredential,
} from "../../frontend/src/js/gltf/async-gltf.js";

function buildGlb(json) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  // Pad JSON chunk to a 4-byte boundary with spaces, per the glTF spec.
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const paddedLength = jsonBytes.length + padding;

  const totalLength = 12 + 8 + paddedLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  view.setUint32(0, 0x46546c67, true); // magic 'glTF'
  view.setUint32(4, 2, true); // version
  view.setUint32(8, totalLength, true); // total length

  view.setUint32(12, paddedLength, true); // chunk length
  view.setUint32(16, 0x4e4f534a, true); // chunk type 'JSON'

  const bytes = new Uint8Array(buffer);
  bytes.set(jsonBytes, 20);
  for (let i = 0; i < padding; i++) {
    bytes[20 + jsonBytes.length + i] = 0x20; // space padding
  }

  return buffer;
}

describe("estimateUploadCount", () => {
  it("counts buffers + images + 1 for the composite", () => {
    const gltf = {
      buffers: [{ uri: "data:..." }, { uri: "data:..." }],
      images: [{ uri: "data:..." }],
    };
    expect(estimateUploadCount(gltf)).toBe(4);
  });

  it("returns 1 (composite only) when there are no buffers/images", () => {
    expect(estimateUploadCount({})).toBe(1);
    expect(estimateUploadCount(null)).toBe(1);
  });
});

describe("estimateGlbUploadCount", () => {
  it("parses a real GLB header and counts buffers + images + 1", () => {
    const arrayBuffer = buildGlb({
      buffers: [{ byteLength: 10 }],
      images: [{ uri: "data:image/png;base64,AA==" }, { bufferView: 0 }],
    });
    expect(estimateGlbUploadCount(arrayBuffer)).toBe(4);
  });

  it("falls back to a conservative estimate for a non-GLB buffer", () => {
    const arrayBuffer = new ArrayBuffer(16);
    expect(estimateGlbUploadCount(arrayBuffer)).toBe(8);
  });

  it("falls back to a conservative estimate when the header is truncated", () => {
    const arrayBuffer = new ArrayBuffer(4);
    expect(estimateGlbUploadCount(arrayBuffer)).toBe(8);
  });
});

describe("reserveFollowUpCredential", () => {
  it("carves one URL off a Pinata pool without mutating the original", () => {
    const credential = {
      backend: "pinata",
      gateway: "https://gw/ipfs/",
      urls: ["url-1", "url-2", "url-3"],
      reusable: true,
    };

    const { workerCredential, followUpCredential } =
      reserveFollowUpCredential(credential);

    expect(followUpCredential).toEqual({
      backend: "pinata",
      url: "url-3",
      gateway: "https://gw/ipfs/",
      reusable: false,
    });
    expect(workerCredential.urls).toEqual(["url-1", "url-2"]);
    // Original object is untouched, so a caller falling back to it after a
    // worker failure still sees the full pool.
    expect(credential.urls).toEqual(["url-1", "url-2", "url-3"]);
  });

  it("does not reserve when the pool has only one URL (nothing for the worker to spend)", () => {
    const credential = {
      backend: "pinata",
      gateway: "https://gw/ipfs/",
      urls: ["url-1"],
      reusable: true,
    };

    const { workerCredential, followUpCredential } =
      reserveFollowUpCredential(credential);

    expect(workerCredential).toBe(credential);
    expect(followUpCredential).toBe(credential);
  });

  it("passes kubo credentials through unchanged", () => {
    const credential = {
      backend: "kubo",
      apiUrl: "http://127.0.0.1:5001",
      gateway: "http://127.0.0.1:8080/ipfs/",
      reusable: true,
    };

    const { workerCredential, followUpCredential } =
      reserveFollowUpCredential(credential);

    expect(workerCredential).toBe(credential);
    expect(followUpCredential).toBe(credential);
  });
});

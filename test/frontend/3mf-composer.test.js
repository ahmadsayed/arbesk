import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const BOX_PATH = path.resolve(process.cwd(), "mock-gltf-assets/box.3mf");

// In-memory IPFS: cid → Uint8Array
const store = new Map();
let seq = 0;

jest.unstable_mockModule("../../frontend/src/js/ipfs/write-to-ipfs.js", () => ({
  writeToIPFS: jest.fn(async (data) => {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new TextEncoder().encode(String(data));
    const cid = `bafyFake${String(seq++).padStart(4, "0")}`;
    store.set(cid, bytes);
    return cid;
  }),
  writeJSONToIPFS: jest.fn(async (json) => {
    const cid = `bafyFake${String(seq++).padStart(4, "0")}`;
    store.set(cid, new TextEncoder().encode(JSON.stringify(json)));
    return cid;
  }),
}));

jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getRawArrayBufferFromRemoteIPFS: jest.fn(async (cid) => {
    const bytes = store.get(cid);
    if (!bytes) throw new Error(`fake IPFS miss: ${cid}`);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  }),
  getArrayBufferFromRemoteIPFS: jest.fn(async (cid) => {
    let bytes = store.get(cid);
    if (!bytes) throw new Error(`fake IPFS miss: ${cid}`);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = new Uint8Array(zlib.gunzipSync(Buffer.from(bytes)));
    }
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
  }),
}));

const { decompose3mf, isComposite3mf } = await import(
  "../../frontend/src/js/3mf/decomposer.js"
);
const { compose3mf } = await import("../../frontend/src/js/3mf/composer.js");
const { unzipBytes, zipBytes, strFromU8, strToU8 } = await import(
  "../../frontend/src/js/3mf/zip.js"
);

describe("3mf decompose/compose round-trip", () => {
  it("round-trips the box sample without content changes", async () => {
    const box = new Uint8Array(fs.readFileSync(BOX_PATH));
    const { compositeCid, composite } = await decompose3mf(box, {
      assetName: "Box",
      assetId: "asset_box",
    });
    expect(compositeCid).toMatch(/^bafyFake/);
    expect(isComposite3mf(composite)).toBe(true);
    expect(composite.parts).toEqual({});
    expect(composite.model).toContain("<vertices>");

    const rebuilt = await compose3mf(composite);
    const entries = unzipBytes(rebuilt);
    expect(Object.keys(entries).sort()).toEqual([
      "3D/3dmodel.model",
      "[Content_Types].xml",
      "_rels/.rels",
    ]);
    expect(strFromU8(entries["3D/3dmodel.model"])).toBe(composite.model);
    expect(strFromU8(entries["_rels/.rels"])).toBe(composite.rootRels);
    expect(strFromU8(entries["[Content_Types].xml"])).toBe(
      composite.contentTypes
    );
  });

  it("extracts binary parts and restores their bytes", async () => {
    const texBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const original = zipBytes({
      "[Content_Types].xml": strToU8("<Types/>"),
      "_rels/.rels": strToU8("<Relationships/>"),
      "3D/3dmodel.model": strToU8("<model/>"),
      "3D/_rels/3dmodel.model.rels": strToU8("<Relationships/>"),
      "3D/Textures/tex.png": texBytes,
    });

    const { composite } = await decompose3mf(original, {
      assetId: "asset_tex",
    });
    expect(Object.keys(composite.parts)).toEqual(["3D/Textures/tex.png"]);
    const partCid = composite.parts["3D/Textures/tex.png"].cid;
    expect(store.get(partCid)).toEqual(texBytes);

    const rebuilt = await compose3mf(composite);
    const entries = unzipBytes(rebuilt);
    expect(Object.keys(entries).sort()).toEqual([
      "3D/3dmodel.model",
      "3D/Textures/tex.png",
      "3D/_rels/3dmodel.model.rels",
      "[Content_Types].xml",
      "_rels/.rels",
    ]);
    expect(Array.from(entries["3D/Textures/tex.png"])).toEqual([1, 2, 3, 4, 5]);
  });

  it("restores parts whose stored payload is gzipped (cross-format dedup)", async () => {
    const texBytes = new Uint8Array([9, 8, 7, 6]);
    const gzipped = new Uint8Array(zlib.gzipSync(Buffer.from(texBytes)));
    const partCid = `bafyFake${String(seq++).padStart(4, "0")}`;
    store.set(partCid, gzipped);

    const composite = {
      arbesk_format: "composite-3mf",
      modelPath: "3D/3dmodel.model",
      contentTypes: "<Types/>",
      rootRels: "<Relationships/>",
      modelRels: null,
      model: "<model/>",
      parts: { "3D/Textures/tex.png": { cid: partCid } },
    };

    const rebuilt = await compose3mf(composite);
    const entries = unzipBytes(rebuilt);
    expect(Array.from(entries["3D/Textures/tex.png"])).toEqual([9, 8, 7, 6]);
  });

  it("decompose3mf rejects packages without a .model part", async () => {
    const noModel = zipBytes({
      "[Content_Types].xml": strToU8("<Types/>"),
      "_rels/.rels": strToU8("<Relationships/>"),
      "3D/Textures/tex.png": new Uint8Array([1]),
    });
    await expect(decompose3mf(noModel)).rejects.toThrow(/\.model/);
  });

  it("compose3mf rejects non-composite input", async () => {
    await expect(compose3mf({ model: "<model/>" })).rejects.toThrow(
      /not a composite 3MF/
    );
  });
});

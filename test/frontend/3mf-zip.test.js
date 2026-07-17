import fs from "fs";
import path from "path";

const BOX_PATH = path.resolve(process.cwd(), "mock-gltf-assets/box.3mf");

describe("3mf zip helpers", () => {
  it("detects ZIP magic", async () => {
    const { isZipBytes, strToU8 } = await import(
      "../../frontend/src/js/3mf/zip.js"
    );
    const box = new Uint8Array(fs.readFileSync(BOX_PATH));
    expect(isZipBytes(box)).toBe(true);
    expect(isZipBytes(strToU8('{"json":true}'))).toBe(false);
    expect(isZipBytes(new Uint8Array([0x50]))).toBe(false);
  });

  it("unzips the box sample into its three OPC entries", async () => {
    const { unzipBytes } = await import("../../frontend/src/js/3mf/zip.js");
    const box = new Uint8Array(fs.readFileSync(BOX_PATH));
    const entries = unzipBytes(box);
    expect(Object.keys(entries).sort()).toEqual([
      "3D/3dmodel.model",
      "[Content_Types].xml",
      "_rels/.rels",
    ]);
    // ArrayBuffer input takes the same path
    expect(Object.keys(unzipBytes(box.buffer)).sort()).toEqual(
      Object.keys(entries).sort()
    );
  });

  it("round-trips entries through zipBytes", async () => {
    const { unzipBytes, zipBytes, strFromU8, strToU8, isZipBytes } =
      await import("../../frontend/src/js/3mf/zip.js");
    const zipped = zipBytes({ "a/b.txt": strToU8("hello 3mf") });
    expect(isZipBytes(zipped)).toBe(true);
    expect(strFromU8(unzipBytes(zipped)["a/b.txt"])).toBe("hello 3mf");
  });
});

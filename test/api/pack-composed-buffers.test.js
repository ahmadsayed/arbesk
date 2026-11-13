import { describe, expect, it } from "bun:test";
import { packComposedBuffers } from "../../src/api/assets/pack-composed-buffers.ts";

const dataUri = (bytes) =>
  `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`;

describe("packComposedBuffers", () => {
  it("packs several buffers into one BIN chunk and rebases their bufferViews", () => {
    const first = [1, 2, 3, 4, 5];
    const second = [10, 11, 12, 13, 14, 15, 16, 17];
    const composed = {
      buffers: [
        { uri: dataUri(first), byteLength: first.length },
        { uri: dataUri(second), byteLength: second.length },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 1, byteLength: 4 },
        { buffer: 1, byteLength: 8 },
        { buffer: 1, byteOffset: 4, byteLength: 4 },
      ],
    };

    const bin = packComposedBuffers(composed);

    // The 5-byte buffer is padded to 8, so the second one starts aligned.
    expect([...bin]).toEqual([...first, 0, 0, 0, ...second]);
    expect(composed.buffers).toEqual([{ byteLength: 16 }]);
    expect(composed.bufferViews).toEqual([
      { buffer: 0, byteOffset: 1, byteLength: 4 },
      { buffer: 0, byteOffset: 8, byteLength: 8 },
      { buffer: 0, byteOffset: 12, byteLength: 4 },
    ]);
  });

  it("zero-fills a buffer that has no inline data", () => {
    const composed = {
      buffers: [{ byteLength: 4 }, { uri: dataUri([7, 8]), byteLength: 2 }],
      bufferViews: [{ buffer: 1, byteLength: 2 }],
    };

    const bin = packComposedBuffers(composed);

    expect([...bin]).toEqual([0, 0, 0, 0, 7, 8, 0, 0]);
    expect(composed.bufferViews[0]).toEqual({ buffer: 0, byteOffset: 4, byteLength: 2 });
  });

  it("returns an empty chunk for a glTF without buffers", () => {
    const composed = { asset: { version: "2.0" } };

    expect(packComposedBuffers(composed).length).toBe(0);
    expect(composed.buffers).toBeUndefined();
  });
});

import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readStl, writeBinaryStl } from "../../scripts/lib/stl.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bench-stl-"));

describe("stl", () => {
  it("round-trips a mesh through binary STL as a triangle soup", () => {
    const file = path.join(tmp(), "t.stl");
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    writeBinaryStl(file, mesh);
    const back = readStl(file);
    expect(back.indices.length).toBe(6);
    expect(Array.from(back.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("reads ASCII STL", () => {
    const file = path.join(tmp(), "a.stl");
    fs.writeFileSync(file, [
      "solid t", " facet normal 0 0 1", "  outer loop",
      "   vertex 0 0 0", "   vertex 1.5e+00 0 0", "   vertex 0 -2 0",
      "  endloop", " endfacet", "endsolid t",
    ].join("\n"));
    const mesh = readStl(file);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1.5, 0, 0, 0, -2, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });
});

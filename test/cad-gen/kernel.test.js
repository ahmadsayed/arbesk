import { createCadKernel } from "@arbesk/cad-gen/core/kernel.js";
import { CadKernelError } from "@arbesk/cad-gen/errors.js";

/**
 * A stand-in for the injected WASM module. The kernel only ever needs the
 * `Manifold` constructor from it, so the identity check can be exercised
 * without loading manifold-3d into the Jest VM (see the prelude tests, which
 * assert geometry through the spawned child for the same reason).
 */
class FakeManifold {
  status() { return "NoError"; }
  numTri() { return 2; }
  numVert() { return 4; }
  volume() { return 1; }
  boundingBox() { return { min: [0, 0, 0], max: [1, 1, 1] }; }
  getMesh() {
    return {
      vertProperties: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      numProp: 3,
      triVerts: [0, 1, 2, 0, 1, 3],
    };
  }
}

/**
 * A stand-in for an empty solid: no triangles, and the Infinity bounds Manifold
 * really reports for one (verified against manifold-3d 3.5.3).
 */
class EmptyManifold extends FakeManifold {
  numTri() { return 0; }
  numVert() { return 0; }
  volume() { return 0; }
  boundingBox() { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
  getMesh() { return { vertProperties: [], numProp: 3, triVerts: [] }; }
}

const MODULE = { Manifold: FakeManifold, CrossSection: class {} };
const EMPTY_MODULE = { Manifold: EmptyManifold, CrossSection: class {} };

const design = (code) => ({
  code,
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "",
});

/** A plausible fake: every method the stat gates read, but not a Manifold. */
const IMPOSTOR = `return {
  getMesh: () => ({}),
  status: () => "NoError",
  numTri: () => 1,
  volume: () => 1,
  numVert: () => 1,
  boundingBox: () => ({ min: [0, 0, 0], max: [1, 1, 1] }),
};`;

describe("createCadKernel", () => {
  it("rejects a duck-typed impostor that mimics the Manifold API", () => {
    const kernel = createCadKernel(MODULE);
    expect(() => kernel.run(design(IMPOSTOR))).toThrow(CadKernelError);
    expect(() => kernel.run(design(IMPOSTOR))).toThrow(/did not return a Manifold/);
  });

  it("accepts a real instance of the injected Manifold class", () => {
    const kernel = createCadKernel(MODULE);
    const { mesh, stats } = kernel.run(design("return new M();"));
    expect(stats).toEqual({
      triangles: 2,
      vertices: 4,
      volumeMm3: 1,
      bboxMm: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 1, 3]);
  });

  // Regression (Task 7): a hole wider than the part removes the whole solid.
  // Manifold bounds an empty mesh with +/-Infinity, which JSON.stringify turns
  // into null, so the payload failed the parent's shape check and the attempt
  // was reported as "kernel host produced an invalid result" - a host fault -
  // instead of the nonempty gate that says what the model must change.
  it("gives an empty solid a definite, JSON-safe bounding box", () => {
    const kernel = createCadKernel(EMPTY_MODULE);
    const { stats } = kernel.run(design("return new M();"));

    expect(stats.triangles).toBe(0);
    expect(stats.volumeMm3).toBe(0);
    // The point of the fix: the stats survive the wire to the parent process.
    expect(JSON.parse(JSON.stringify(stats)).bboxMm).toEqual({
      min: [0, 0, 0],
      max: [0, 0, 0],
    });
  });
});

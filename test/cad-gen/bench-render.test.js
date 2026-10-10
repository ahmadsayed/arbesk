import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { orthoDepth, renderMesh } from "../../scripts/lib/render.mjs";
import { box } from "./helpers/bench-meshes.js";

// renderMesh moved out of scripts/cad-eval.mjs; the CADPrompt report's images
// depend on it staying byte-identical. Hash captured from the moved code after
// `cmp` showed cad-eval --stl wrote identical PNGs before and after the move.
const BOX_RGB_SHA256 = "a385472bada3fb0649ed8bf254aeecd8e8e813147e88bb701acf6ec22d994ebf";

describe("renderMesh", () => {
  it("renders a box exactly as cad-eval did before the move", () => {
    const { rgb, width, height } = renderMesh(box([20, 10, 5]), { width: 720, height: 560 });
    expect([width, height]).toEqual([720, 560]);
    expect(crypto.createHash("sha256").update(rgb).digest("hex")).toBe(BOX_RGB_SHA256);
  });
});

describe("orthoDepth", () => {
  const cube = box([10, 10, 10], [-5, -5, -5]);
  const top = { forward: [0, 0, -1], up: [0, 1, 0] };
  const frame = { centre: [0, 0, 0], scale: 4, W: 100, H: 100 };

  it("sees the cube's top face from above and nothing around it", () => {
    const { depth } = orthoDepth(cube, top, frame);
    // Camera looks down -Z from the centre, so the top face (z = +5) sits at depth -5.
    expect(depth[50 * 100 + 50]).toBeCloseTo(-5, 6);
    expect(depth[2 * 100 + 2]).toBe(Infinity);
  });

  it("projects the frame centre to the middle of the panel", () => {
    const { project } = orthoDepth(cube, top, frame);
    const [x, y, z] = project([0, 0, 0]);
    expect(x).toBeCloseTo(50, 9);
    expect(y).toBeCloseTo(50, 9);
    expect(z).toBeCloseTo(0, 9);
    // +Y is up on screen in the top view, +X is right.
    expect(project([5, 0, 0])[0]).toBeCloseTo(70, 9);
    expect(project([0, 5, 0])[1]).toBeCloseTo(30, 9);
  });
});

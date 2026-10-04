import { describe, expect, it } from "bun:test";
import {
  KdTree, alignAndScore, applySteps, bestRigid, boundsOf, chamfer, hausdorff, iogt, samplePoints,
} from "../../scripts/lib/mesh-metrics.mjs";
import { box, moved } from "./helpers/bench-meshes.js";

describe("samplePoints", () => {
  it("is reproducible for a seed and lies on the surface", () => {
    const a = samplePoints(box([1, 1, 1]), 500, 7);
    expect(samplePoints(box([1, 1, 1]), 500, 7)).toEqual(a);
    const { min, max } = boundsOf(a);
    expect(min.every((v) => v >= -1e-9)).toBe(true);
    expect(max.every((v) => v <= 1 + 1e-9)).toBe(true);
  });

  it("weights by area: a 4x1x1 box puts ~11% of samples on its end faces", () => {
    const pts = samplePoints(box([4, 1, 1]), 4000, 3);
    let ends = 0;
    for (let i = 0; i < pts.length; i += 3) if (pts[i] < 1e-9 || pts[i] > 4 - 1e-9) ends++;
    expect(ends / 4000).toBeGreaterThan(0.08);
    expect(ends / 4000).toBeLessThan(0.14);
  });
});

describe("KdTree", () => {
  it("agrees with brute force", () => {
    const pts = samplePoints(box([3, 2, 1]), 2000, 11);
    const tree = new KdTree(pts);
    const queries = samplePoints(box([4, 4, 4], [-0.5, -1, -1.5]), 200, 12);
    for (let q = 0; q < queries.length; q += 3) {
      let best = Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const d = (pts[i] - queries[q]) ** 2 + (pts[i + 1] - queries[q + 1]) ** 2 + (pts[i + 2] - queries[q + 2]) ** 2;
        if (d < best) best = d;
      }
      expect(tree.nearest(queries[q], queries[q + 1], queries[q + 2])[1]).toBeCloseTo(best, 12);
    }
  });
});

describe("bestRigid", () => {
  it("recovers a known rotation and translation exactly", () => {
    const P = samplePoints(box([2, 1, 0.5]), 300, 5);
    const r = 0.7, c = Math.cos(r), s = Math.sin(r);
    const truth = { R: [c, 0, s, 0, 1, 0, -s, 0, c], t: [3, -2, 1] };
    const fit = bestRigid(P, applySteps(P, [truth]));
    fit.R.forEach((v, i) => expect(v).toBeCloseTo(truth.R[i], 9));
    fit.t.forEach((v, i) => expect(v).toBeCloseTo(truth.t[i], 9));
  });
});

describe("chamfer / hausdorff / iogt", () => {
  it("are 0, 0 and 1 for identical meshes", () => {
    const { metrics } = alignAndScore(box([2, 1, 0.5]), box([2, 1, 0.5]), { samples: 2048 });
    expect(metrics.chamfer).toBe(0);
    expect(metrics.hausdorff).toBe(0);
    expect(metrics.iogt).toBeCloseTo(1, 12);
  });

  it("match hand-computed values (paper Eq. 8 and 9)", () => {
    const P = new Float64Array([0, 0, 0, 1, 0, 0]);
    const Q = new Float64Array([0, 0, 0, 3, 0, 0]);
    // P->Q nearest: 0, 1 (mean 0.5). Q->P nearest: 0, 2 (mean 1). 0.5*0.5 + 0.5*1.
    expect(chamfer(P, Q)).toBeCloseTo(0.75, 12);
    expect(hausdorff(P, Q)).toBeCloseTo(2, 12);
  });

  it("iogt is the bbox overlap over the truth bbox (paper Eq. 10)", () => {
    expect(iogt({ min: [0.5, 0, 0], max: [1.5, 1, 1] }, { min: [0, 0, 0], max: [1, 1, 1] })).toBeCloseTo(0.5, 12);
    expect(iogt({ min: [2, 2, 2], max: [3, 3, 3] }, { min: [0, 0, 0], max: [1, 1, 1] })).toBe(0);
  });
});

describe("alignAndScore", () => {
  it("recovers a box rotated 15 degrees, scaled x100 and moved", () => {
    const truth = box([2, 1, 0.5]);
    const { metrics } = alignAndScore(moved(truth, 15, 100, [40, -25, 7]), truth);
    expect(metrics.chamfer).toBeLessThan(0.02);
    expect(metrics.iogt).toBeGreaterThan(0.97);
  });

  it("scores a cube against a flat slab as far apart (negative control)", () => {
    const { metrics } = alignAndScore(box([1, 1, 1]), box([1, 1, 0.1]));
    expect(metrics.chamfer).toBeGreaterThan(0.1);
  });
});

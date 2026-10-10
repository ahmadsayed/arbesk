import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VIEWS, drawingEdges, drawingSvg, svgToPng } from "../../scripts/lib/drawing.mjs";
import { box } from "./helpers/bench-meshes.js";

const hasInkscape = spawnSync("inkscape", ["--version"]).status === 0;

/** A frame that fits the mesh comfortably in a 400 x 400 panel. */
const frameFor = (mesh) => {
  const p = mesh.positions;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) {
    lo[a] = Math.min(lo[a], p[i + a]); hi[a] = Math.max(hi[a], p[i + a]);
  }
  return { centre: lo.map((v, a) => (v + hi[a]) / 2), scale: 10, W: 400, H: 400 };
};

/** A box with a closed cavity inside it: the inner box, wound inside out. */
function hollowBox() {
  const outer = box([20, 10, 10], [0, 0, 0]);
  const inner = box([10, 4, 4], [5, 3, 3]);
  const n = outer.positions.length / 3;
  const innerIdx = [];
  for (let i = 0; i < inner.indices.length; i += 3) {
    innerIdx.push(inner.indices[i] + n, inner.indices[i + 2] + n, inner.indices[i + 1] + n);
  }
  return {
    positions: Float32Array.from([...outer.positions, ...inner.positions]),
    indices: Uint32Array.from([...outer.indices, ...innerIdx]),
  };
}

/** A closed faceted cylinder along Z: each side facet is a quad split into two triangles. */
function cylinder(r, h, n) {
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pos.push(r * Math.cos(a), r * Math.sin(a), 0, r * Math.cos(a), r * Math.sin(a), h);
  }
  pos.push(0, 0, 0, 0, 0, h);
  const bottom = 2 * n, top = 2 * n + 1, idx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const b0 = 2 * i, t0 = 2 * i + 1, b1 = 2 * j, t1 = 2 * j + 1;
    idx.push(b0, b1, t1, b0, t1, t0, bottom, b1, b0, top, t0, t1);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

describe("drawingEdges", () => {
  const slab = box([20, 10, 5]);

  it("shows a box's three far edges as hidden in the isometric view", () => {
    const e = drawingEdges(slab, VIEWS.isometric, frameFor(slab));
    expect(e.visible).toHaveLength(9);
    expect(e.hidden).toHaveLength(3);
  });

  it("draws only the outline in the flat views - back edges never double it", () => {
    for (const view of [VIEWS.top, VIEWS.front, VIEWS.right]) {
      const e = drawingEdges(slab, view, frameFor(slab));
      expect(e.visible).toHaveLength(4);
      expect(e.hidden).toHaveLength(0);
    }
  });

  it("never draws the diagonal that triangulates a flat face", () => {
    const e = drawingEdges(slab, VIEWS.front, frameFor(slab));
    for (const [x1, y1, x2, y2] of e.visible) {
      expect(Math.abs(x1 - x2) < 1e-6 || Math.abs(y1 - y2) < 1e-6).toBe(true);
    }
  });

  it("keeps a faceted cylinder's silhouette solid from end to end", () => {
    // Live finding: the facet beside a silhouette is nearly edge-on, and the
    // triangle owning the edge tapers to a point, so half of each side drew
    // dashed until the edge's whole smooth surface counted as its own.
    const can = cylinder(20, 30, 48);
    const frame = { centre: [0, 0, 15], scale: 5, W: 400, H: 400 };
    const e = drawingEdges(can, VIEWS.front, frame);
    const sides = e.visible.filter(([x1, y1, x2, y2]) => Math.abs(x1 - x2) < 1 && Math.abs(y2 - y1) > 140);
    expect(sides).toHaveLength(2);
    expect(e.hidden).toHaveLength(0);
  });

  it("shows an internal cavity as hidden lines", () => {
    const solid = hollowBox();
    const e = drawingEdges(solid, VIEWS.front, frameFor(solid));
    expect(e.visible).toHaveLength(4);
    expect(e.hidden.length).toBeGreaterThanOrEqual(4);
  });
});

describe("drawingSvg", () => {
  const svg = drawingSvg(box([20, 10, 5]), { title: "slab", date: "2026-10-10" });

  it("labels the four views and the title block", () => {
    for (const label of ["Isometric", "Top", "Front", "Right", "slab", "arbesk cad-gen", "2026-10-10"]) {
      expect(svg).toContain(">" + label + "<");
    }
    expect(svg.match(/Scale: 1:[0-9.]+/g)).toHaveLength(1);
  });

  it("dimensions the bounding box in red", () => {
    const red = [...svg.matchAll(/<text[^>]*fill="#d00000"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(red.sort()).toEqual(["10.0", "20.0", "5.0"]);
  });

  it("uses MUSE's sheet size and line styles", () => {
    expect(svg).toContain('width="1580" height="1120"');
    expect(svg).toContain('stroke="#0000a0"');
    expect(svg).toContain('stroke-dasharray="6 3"');
  });
});

describe("svgToPng", () => {
  it.skipIf(!hasInkscape)("writes a PNG through inkscape", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-draw-"));
    const svgFile = path.join(dir, "s.svg");
    const pngFile = path.join(dir, "s.png");
    fs.writeFileSync(svgFile, drawingSvg(box([20, 10, 5]), { title: "slab", date: "2026-10-10" }));
    svgToPng(svgFile, pngFile);
    expect([...fs.readFileSync(pngFile).subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }, 60000);
});

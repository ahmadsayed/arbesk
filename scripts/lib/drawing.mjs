/**
 * A MUSE-style engineering sheet of a mesh: four views with hidden lines.
 * @remarks MUSE's judge scores a part from its 4-view drawing, not from code
 *   or a render, and compares it with a reference sheet drawn by DrawCAD - a
 *   tool the benchmark does not publish. This reproduces the sheet's layout and
 *   conventions (Isometric / Top / Front / Right, blue visible edges, dashed
 *   grey hidden edges, red overall dimensions, a title block) from our own
 *   mesh, so the judge compares like with like. Feature dimensions (DrawCAD's
 *   diameter callouts) are deliberately not drawn; the report lists that as a
 *   deviation.
 */
import { spawnSync } from "node:child_process";
import { boundsOf, cross, dot, orthoDepth, sub, unit } from "./render.mjs";

/** @typedef {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} Mesh */
/** @typedef {{ forward: number[], up: number[] }} View */
/** @typedef {[number, number, number, number]} Segment */

/** The sheet's four views; the isometric looks from the +X, -Y, +Z corner like DrawCAD's. */
export const VIEWS = Object.freeze({
  isometric: { forward: [-1, 1, -1], up: [0, 0, 1] },
  top: { forward: [0, 0, -1], up: [0, 1, 0] },
  front: { forward: [0, 1, 0], up: [0, 0, 1] },
  right: { forward: [-1, 0, 0], up: [0, 0, 1] },
});

/** An edge is a crease when its faces meet at more than this angle. */
const CREASE_COS = Math.cos((30 * Math.PI) / 180);

/** A hidden line may cross a visible one over this many samples without being cut:
 *  the covered band is 3 px wide, so a crossing at 30 degrees spans ~6 samples. */
const CROSSING_SAMPLES = 8;

/** Faces closer to edge-on than this contribute no depth slope: they have no visible area. */
const EDGE_ON = 0.1;

/**
 * Merges vertices that share a position, so a triangle soup gets real edges.
 * @remarks An STL read back from disk repeats every vertex per triangle; with
 *   no shared indices no edge would have two faces and every triangle edge
 *   would draw. Positions are keyed at 1e-5 mm.
 * @param {Mesh} mesh
 * @returns {{ pos: number[][], tri: number[][], origin: number[] }} origin[i] is
 *   the input triangle tri[i] came from - the id the depth view records.
 */
function weld(mesh) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {number[][]} */
  const pos = [];
  const remap = [];
  const p = mesh.positions;
  for (let i = 0; i < p.length / 3; i++) {
    const v = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
    const key = v.map((x) => Math.round(x * 1e5)).join(",");
    let id = seen.get(key);
    if (id === undefined) {
      id = pos.length;
      seen.set(key, id);
      pos.push(v);
    }
    remap.push(id);
  }
  const tri = [];
  const origin = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const f = [remap[mesh.indices[t]], remap[mesh.indices[t + 1]], remap[mesh.indices[t + 2]]];
    if (f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) {
      tri.push(f);
      origin.push(t / 3);
    }
  }
  return { pos, tri, origin };
}

/**
 * The edges worth drawing in one view, each with the faces it bounds.
 * @remarks Creases and silhouettes only. An edge between two coplanar faces -
 *   the diagonal that triangulates a flat face - is never drawn: it is an
 *   artefact of the mesh, not of the part.
 * @param {{ pos: number[][], tri: number[][], origin: number[] }} w Welded mesh.
 * @param {number[]} forward Unit view direction.
 * @returns {{ a: number[], b: number[], normals: number[][], faces: number[] }[]}
 *   faces are the edge's own surface as input-triangle ids, as the depth view
 *   records them.
 */
function candidateEdges(w, forward) {
  const normals = w.tri.map(([a, b, c]) => unit(cross(sub(w.pos[b], w.pos[a]), sub(w.pos[c], w.pos[a]))));
  /** @type {Map<string, number[]>} */
  const faces = new Map();
  w.tri.forEach((f, fi) => {
    for (let k = 0; k < 3; k++) {
      const i = f[k];
      const j = f[(k + 1) % 3];
      const key = i < j ? i + "," + j : j + "," + i;
      const list = faces.get(key);
      if (list) list.push(fi);
      else faces.set(key, [fi]);
    }
  });
  /** @type {number[][]} */
  const atVertex = w.pos.map(() => []);
  w.tri.forEach((f, fi) => f.forEach((v) => atVertex[v].push(fi)));
  const out = [];
  for (const [key, fs] of faces) {
    const [i, j] = key.split(",").map(Number);
    const ns = fs.map((f) => normals[f]);
    let draw = fs.length !== 2;
    if (!draw) {
      const crease = dot(ns[0], ns[1]) < CREASE_COS;
      const silhouette = (dot(ns[0], forward) < -1e-9) !== (dot(ns[1], forward) < -1e-9);
      draw = crease || silhouette;
    }
    if (!draw) continue;
    // The edge's own surface: its faces plus any face at its ends that is
    // smooth with one of them - the other half of a facet's quad, without
    // which a tapering triangle leaves half a silhouette unclaimed.
    const own = new Set(fs);
    for (const v of [i, j]) {
      for (const f of atVertex[v]) if (ns.some((n) => dot(n, normals[f]) >= CREASE_COS)) own.add(f);
    }
    out.push({ a: w.pos[i], b: w.pos[j], normals: ns, faces: [...own].map((f) => w.origin[f]) });
  }
  return out;
}

/**
 * How far a visible edge's depth may sit behind its neighbourhood's nearest
 * pixel, in mm.
 * @remarks The test looks at the 3x3 pixels around a sample, so a visible edge
 *   on the far side of a slanted face sees that face's nearer pixels next to
 *   it. A sample anywhere in its pixel can sit up to ~2.1 px from a neighbour's
 *   centre, so the slack is the steepest adjacent face's depth change over
 *   2.5 px; a fixed tolerance chopped a box's bottom silhouette into 2-4 px
 *   pieces in the isometric view.
 * @param {number[][]} normals The edge's face normals.
 * @param {{ right: number[], up: number[], forward: number[] }} basis
 * @param {number} scale px per mm.
 * @param {number} eps Floor, in mm.
 */
function depthSlack(normals, basis, scale, eps) {
  let slope = 0;
  for (const n of normals) {
    const nz = Math.abs(dot(n, basis.forward));
    if (nz < EDGE_ON) continue;
    slope = Math.max(slope, Math.hypot(dot(n, basis.right), dot(n, basis.up)) / nz);
  }
  return (slope / scale) * 2.5 + eps;
}

/**
 * Turns a run of samples into a segment when it spans at least two samples.
 * @param {number[][]} run [x, y] samples.
 * @param {Segment[]} into
 */
function flush(run, into) {
  if (run.length >= 2) into.push([run[0][0], run[0][1], run[run.length - 1][0], run[run.length - 1][1]]);
}

/**
 * Marks short hidden gaps between visible samples as visible, in place.
 * @remarks A faceted surface's thinnest facets can miss every pixel centre for
 *   a sample or two; without this a solid silhouette breaks into stubs.
 * @param {boolean[]} state Per-sample visibility along one edge.
 */
function bridgeGaps(state) {
  for (let k = 1; k < state.length; k++) {
    if (state[k] || !state[k - 1]) continue;
    let end = k;
    while (end < state.length && !state[end]) end++;
    if (end < state.length && end - k <= CROSSING_SAMPLES) state.fill(true, k, end);
    k = end;
  }
}

/**
 * Visible and hidden edges of a mesh in one orthographic view.
 * @remarks Each candidate edge is sampled every pixel and each sample tested
 *   against the view's depth buffer. A hidden sample within a pixel of a
 *   visible line is dropped, so an orthographic view's back edges - which
 *   project exactly onto the outline - never double it as dashes.
 * @param {Mesh} mesh Mesh in millimetres.
 * @param {View} view
 * @param {{ centre: number[], scale: number, W: number, H: number }} frame
 * @returns {{ visible: Segment[], hidden: Segment[] }} In panel pixels.
 */
export function drawingEdges(mesh, view, frame) {
  const { W, H, scale } = frame;
  const { depth, ids, project, basis } = orthoDepth(/** @type {any} */ (mesh), view, frame);
  const w = weld(mesh);
  const { min, max } = boundsOf(/** @type {any} */ (mesh));
  const eps = 1e-6 * Math.max(1, ...[0, 1, 2].map((a) => max[a] - min[a]));
  /**
   * Whether a sample is visible: one of its edge's own faces is the nearest
   * surface within a pixel, or nothing within a pixel is nearer than the slack.
   * @remarks The face test is what keeps a faceted cylinder's silhouette solid:
   *   the facet beside it is nearly edge-on, so its neighbouring pixels are far
   *   nearer than any depth slack allows, yet that facet IS the edge's own.
   * @param {number[]} s [x, y, depth] in panel pixels.
   * @param {Set<number>} own @param {number} slack
   */
  const isVisible = (s, own, slack) => {
    let nearest = Infinity;
    const cx = Math.floor(s[0]);
    const cy = Math.floor(s[1]);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = py * W + px;
        if (own.has(ids[o])) return true;
        nearest = Math.min(nearest, depth[o]);
      }
    }
    return s[2] <= nearest + slack;
  };

  /** @type {Segment[]} */
  const visible = [];
  /** @type {number[][][]} hidden runs, filtered once every visible line is known */
  const hiddenRuns = [];
  for (const edge of candidateEdges(w, basis.forward)) {
    const p = project(edge.a);
    const q = project(edge.b);
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (length < 0.5) continue;
    const slack = depthSlack(edge.normals, basis, scale, eps);
    const own = new Set(edge.faces);
    const n = Math.max(2, Math.ceil(length));
    const samples = [];
    const state = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const s = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      samples.push([s[0], s[1]]);
      state.push(isVisible(s, own, slack));
    }
    bridgeGaps(state);
    /** @type {number[][]} */
    let run = [];
    for (let k = 0; k < samples.length; k++) {
      if (run.length && state[k] !== state[k - 1]) {
        if (state[k - 1]) flush(run, visible);
        else hiddenRuns.push(run);
        run = [];
      }
      run.push(samples[k]);
    }
    if (state[samples.length - 1]) flush(run, visible);
    else hiddenRuns.push(run);
  }

  const covered = new Uint8Array(W * H);
  for (const [x1, y1, x2, y2] of visible) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let k = 0; k <= steps; k++) {
      const x = Math.floor(x1 + ((x2 - x1) * k) / steps);
      const y = Math.floor(y1 + ((y2 - y1) * k) / steps);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && py >= 0 && px < W && py < H) covered[py * W + px] = 1;
        }
      }
    }
  }
  /** @type {Segment[]} */
  const hidden = [];
  for (const samples of hiddenRuns) {
    const onLine = samples.map(([x, y]) => {
      const px = Math.floor(x);
      const py = Math.floor(y);
      return px >= 0 && py >= 0 && px < W && py < H && covered[py * W + px] === 1;
    });
    /** @type {number[][]} */
    let run = [];
    for (let k = 0; k < samples.length;) {
      if (!onLine[k]) {
        run.push(samples[k++]);
        continue;
      }
      let end = k;
      while (end < samples.length && onLine[end]) end++;
      // A short covered stretch with hidden samples on both sides is a
      // crossing, not a shared line: keep the dashes running through it.
      if (end - k <= CROSSING_SAMPLES && run.length > 0 && end < samples.length) {
        for (; k < end; k++) run.push(samples[k]);
        continue;
      }
      flush(run, hidden);
      run = [];
      k = end;
    }
    flush(run, hidden);
  }
  return { visible, hidden };
}

/** Sheet geometry, matched to MUSE's reference PNGs (1580 x 1120). */
const SHEET = Object.freeze({
  width: 1580,
  height: 1120,
  panels: {
    isometric: { x: 38, y: 38, label: "Isometric" },
    top: { x: 812, y: 38, label: "Top" },
    front: { x: 38, y: 542, label: "Front" },
    right: { x: 812, y: 542, label: "Right" },
  },
  panelW: 738,
  panelH: 466,
  title: { x: 38, y: 1008, w: 1512, h: 77 },
  fill: 0.7,
  paperMm: 420,
});

/** @param {unknown} v @returns {string} */
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** @param {number} v @returns {string} */
const f1 = (v) => v.toFixed(1);

/**
 * The panel-pixel bounding box of the mesh's bounding box in one view.
 * @param {number[]} min @param {number[]} max
 * @param {(p: number[]) => number[]} project
 */
function projectedBox(min, max, project) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < 8; i++) {
    const [x, y] = project([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
    xs.push(x);
    ys.push(y);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * A red dimension: extension-free line with arrow ticks and its value.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {string} text @param {boolean} vertical
 */
function dimension(x1, y1, x2, y2, text, vertical) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const label = vertical
    ? `<text x="${f1(mx - 8)}" y="${f1(my)}" fill="#d00000" font-size="13" font-family="sans-serif" text-anchor="middle" transform="rotate(-90 ${f1(mx - 8)} ${f1(my)})">${esc(text)}</text>`
    : `<text x="${f1(mx)}" y="${f1(my - 6)}" fill="#d00000" font-size="13" font-family="sans-serif" text-anchor="middle">${esc(text)}</text>`;
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#d00000" stroke-width="1" marker-start="url(#tick)" marker-end="url(#tick)"/>` + label;
}

/**
 * The whole sheet as SVG.
 * @param {Mesh} mesh Mesh in millimetres, Z-up.
 * @param {{ title: string, date: string }} meta Title-block text.
 * @returns {string}
 */
export function drawingSvg(mesh, meta) {
  const { min, max } = boundsOf(/** @type {any} */ (mesh));
  const centre = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const W = SHEET.panelW;
  const H = SHEET.panelH;
  // One scale for every panel, fitted to the largest view - as on a real sheet.
  let scale = Infinity;
  for (const view of Object.values(VIEWS)) {
    const unitFrame = { centre, scale: 1, W: 0, H: 0 };
    const b = projectedBox(min, max, orthoDepthProjector(view, unitFrame));
    scale = Math.min(scale, (SHEET.fill * W) / Math.max(b.x1 - b.x0, 1e-9), (SHEET.fill * H) / Math.max(b.y1 - b.y0, 1e-9));
  }
  const frame = { centre, scale, W, H };
  const parts = [];
  for (const [name, view] of Object.entries(VIEWS)) {
    const panel = SHEET.panels[/** @type {keyof typeof SHEET.panels} */ (name)];
    const { visible, hidden } = drawingEdges(mesh, view, frame);
    const line = (/** @type {Segment} */ s, /** @type {string} */ style) =>
      `<line x1="${f1(s[0] + panel.x)}" y1="${f1(s[1] + panel.y)}" x2="${f1(s[2] + panel.x)}" y2="${f1(s[3] + panel.y)}" ${style}/>`;
    parts.push(`<rect x="${panel.x}" y="${panel.y}" width="${W}" height="${H}" fill="none" stroke="#808080" stroke-width="2"/>`);
    for (const s of hidden) parts.push(line(s, 'stroke="#808080" stroke-width="1" stroke-dasharray="6 3"'));
    for (const s of visible) parts.push(line(s, 'stroke="#0000a0" stroke-width="2.2" stroke-linecap="round"'));
    parts.push(`<text x="${panel.x + W / 2}" y="${panel.y + H - 12}" font-size="13" font-family="sans-serif" text-anchor="middle">${panel.label}</text>`);
    const b = projectedBox(min, max, orthoDepthProjector(view, frame));
    const bx0 = b.x0 + panel.x, bx1 = b.x1 + panel.x, by0 = b.y0 + panel.y, by1 = b.y1 + panel.y;
    if (name === "top") {
      parts.push(dimension(bx0, by1 + 30, bx1, by1 + 30, f1(max[0] - min[0]), false));
      parts.push(dimension(bx1 + 30, by0, bx1 + 30, by1, f1(max[1] - min[1]), true));
    }
    if (name === "front") parts.push(dimension(bx1 + 30, by0, bx1 + 30, by1, f1(max[2] - min[2]), true));
  }
  const t = SHEET.title;
  const ratio = 1 / ((scale * SHEET.paperMm) / SHEET.width);
  parts.push(`<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" fill="none" stroke="#808080" stroke-width="2"/>`);
  parts.push(`<text x="${t.x + 18}" y="${t.y + 30}" font-size="15" font-family="sans-serif">${esc(meta.title)}</text>`);
  parts.push(`<text x="${t.x + 18}" y="${t.y + 54}" font-size="11" font-family="sans-serif">arbesk cad-gen</text>`);
  parts.push(`<text x="${t.x + t.w / 2}" y="${t.y + 56}" font-size="13" font-family="sans-serif" text-anchor="middle">Scale: 1:${ratio.toFixed(1)}</text>`);
  parts.push(`<text x="${t.x + t.w - 18}" y="${t.y + 30}" font-size="11" font-family="sans-serif" text-anchor="end">${esc(meta.date)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}" height="${SHEET.height}" viewBox="0 0 ${SHEET.width} ${SHEET.height}">`
    + `<defs><marker id="tick" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,2 L10,5 L0,8 z" fill="#d00000"/></marker></defs>`
    + `<rect width="100%" height="100%" fill="#ffffff"/>` + parts.join("") + "</svg>";
}

/**
 * The same world-to-panel mapping orthoDepth uses, without rasterising.
 * @param {View} view
 * @param {{ centre: number[], scale: number, W: number, H: number }} frame
 * @returns {(p: number[]) => number[]}
 */
function orthoDepthProjector(view, frame) {
  const forward = unit(view.forward);
  const right = unit(cross(forward, view.up));
  const camUp = cross(right, forward);
  return (p) => {
    const q = sub(p, frame.centre);
    return [frame.W / 2 + dot(q, right) * frame.scale, frame.H / 2 - dot(q, camUp) * frame.scale, dot(q, forward)];
  };
}

/**
 * Rasterises an SVG sheet to PNG with inkscape.
 * @param {string} svgFile @param {string} pngFile @param {number} [width]
 * @throws {Error} When inkscape is missing or fails - without the PNG the
 *   judge has nothing to score, so this is never best-effort.
 */
export function svgToPng(svgFile, pngFile, width = SHEET.width) {
  const r = spawnSync("inkscape", [svgFile, "--export-type=png", "--export-width=" + width, "--export-filename=" + pngFile], {
    encoding: "utf8",
  });
  if (r.error && /** @type {any} */ (r.error).code === "ENOENT") {
    throw new Error("inkscape not found - install it to draw MUSE sheets");
  }
  if (r.status !== 0) throw new Error("inkscape failed: " + (r.stderr || r.error?.message || "exit " + r.status));
}

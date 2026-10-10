/**
 * The harnesses' software renderer: PNG output and a depth-buffered rasteriser.
 * @remarks Moved verbatim out of scripts/cad-eval.mjs so the benchmark
 *   harnesses can draw parts without spawning that CLI. renderMesh's output is
 *   byte-identical to what cad-eval wrote before the move - the CADPrompt
 *   report's images depend on it (test/cad-gen/bench-render.test.js).
 */
import fs from "node:fs";
import zlib from "node:zlib";

/** @typedef {{ positions: Float32Array, indices: Uint32Array }} Mesh */
/** @typedef {{ width?: number, height?: number, dir?: number[], tint?: number[],
 *   frame?: { centre: number[], extent: number } }} RenderOptions */

// ------------------------------------------------------------------ PNG output

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Buffer} buf Bytes to checksum.
 * @returns {number} CRC-32.
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type Four-character chunk type.
 * @param {Buffer} data Chunk payload.
 * @returns {Buffer} A complete PNG chunk.
 */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Writes an RGB buffer as a PNG.
 * @param {string} file Destination path.
 * @param {number} width Image width in pixels.
 * @param {number} height Image height in pixels.
 * @param {Buffer} rgb Tightly packed RGB bytes.
 * @returns {number} Bytes written.
 */
export function writePng(file, width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + stride);
    raw[off] = 0;
    rgb.copy(raw, off + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, out);
  return out.length;
}

// ------------------------------------------------------------------- rendering

/** @param {number[]} a @param {number[]} b @returns {number[]} */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number[]} b @returns {number} */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {number[]} a @param {number[]} b @returns {number[]} */
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * @param {number[]} v Any non-zero vector.
 * @returns {number[]} The unit vector in the same direction.
 */
export function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * @param {Mesh} mesh Any mesh.
 * @returns {{ min: number[], max: number[] }} Its axis-aligned bounds in mm.
 */
export function boundsOf(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const nv = mesh.positions.length / 3;
  for (let i = 0; i < nv; i++) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Isometric flat-shaded render of a mesh, 2x supersampled.
 * @remarks Flat shading with a headlight: faces at different angles get
 *   different tones, which is what makes an engineering part readable in a
 *   still. Depth-buffered, so a through-hole reads as a hole.
 * @param {Mesh} mesh Mesh in millimetres, Z-up.
 * @param {RenderOptions} [opts] Size and view direction.
 * @returns {{ rgb: Buffer, width: number, height: number }} The rendered image.
 */
export function renderMesh(mesh, opts = {}) {
  const width = opts.width ?? 720;
  const height = opts.height ?? 560;
  const ss = 2;
  const dir = unit(opts.dir ?? [1, -1.5, 0.85]);
  const bg = [20, 22, 27];
  const base = opts.tint ?? [214, 219, 228];
  const pos = mesh.positions;
  const idx = mesh.indices;
  const nv = pos.length / 3;
  const { min, max } = boundsOf(mesh);
  // A shared frame is what lets several components be composited into one
  // image: fitting each mesh to the frame on its own would draw them at
  // different scales and they would not line up.
  const centre = opts.frame?.centre ?? [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
  const forward = [-dir[0], -dir[1], -dir[2]];
  const right = unit(cross(forward, [0, 0, 1]));
  const camUp = cross(right, forward);
  const cx = new Float64Array(nv);
  const cy = new Float64Array(nv);
  const cz = new Float64Array(nv);
  let extent = 1e-6;

  for (let i = 0; i < nv; i++) {
    const p = sub([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], centre);
    cx[i] = dot(p, right);
    cy[i] = dot(p, camUp);
    cz[i] = dot(p, forward);
    extent = Math.max(extent, Math.abs(cx[i]), Math.abs(cy[i]));
  }

  const W = width * ss;
  const H = height * ss;
  const scale = (Math.min(W, H) * 0.42) / (opts.frame?.extent ?? extent);
  const depth = new Float64Array(W * H).fill(Infinity);
  const shade = new Float64Array(W * H);
  const lit = new Uint8Array(W * H);
  const light = unit([dir[0], dir[1], dir[2] + 0.9]);

  rasterize({ pos, idx, cx, cy, cz, scale, W, H, depth, shade, lit, light });
  return { rgb: resolve({ width, height, ss, W, lit, shade, bg, base }), width, height };
}

/**
 * Depth-buffered triangle rasteriser.
 * @param {{ pos: Float32Array, idx: Uint32Array, cx: Float64Array,
 *   cy: Float64Array, cz: Float64Array, scale: number, W: number, H: number,
 *   depth: Float64Array, shade: Float64Array, lit: Uint8Array,
 *   light: number[], ids?: Int32Array }} s Projected geometry and the buffers
 *   to fill; ids, when given, receives the index of the triangle nearest at
 *   each pixel (the drawing's hidden-line test needs to know whose pixel it is).
 */
export function rasterize(s) {
  const { pos, idx, cx, cy, cz, scale, W, H, depth, shade, lit, light, ids } = s;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const ax = W / 2 + cx[a] * scale;
    const ay = H / 2 - cy[a] * scale;
    const bx = W / 2 + cx[b] * scale;
    const by = H / 2 - cy[b] * scale;
    const gx = W / 2 + cx[c] * scale;
    const gy = H / 2 - cy[c] * scale;
    const area = (bx - ax) * (gy - ay) - (by - ay) * (gx - ax);
    if (area === 0) continue;

    const p0 = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const p1 = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const p2 = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const tone = 0.18 + 0.82 * Math.abs(dot(unit(cross(sub(p1, p0), sub(p2, p0))), light));
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, gx)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, gx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, gy)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, gy)));
    const inv = 1 / area;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * inv;
        const w1 = ((px - ax) * (gy - ay) - (py - ay) * (gx - ax)) * inv;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const d = (1 - w0 - w1) * cz[a] + w1 * cz[b] + w0 * cz[c];
        const o = y * W + x;
        if (d < depth[o]) {
          depth[o] = d;
          shade[o] = tone;
          lit[o] = 1;
          if (ids) ids[o] = t / 3;
        }
      }
    }
  }
}

/**
 * Box-filters the supersampled buffers down to the output image.
 * @param {{ width: number, height: number, ss: number, W: number,
 *   lit: Uint8Array, shade: Float64Array, bg: number[], base: number[] }} s Render state.
 * @returns {Buffer} Tightly packed RGB bytes.
 */
function resolve(s) {
  const rgb = Buffer.alloc(s.width * s.height * 3);
  const n = s.ss * s.ss;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let sy = 0; sy < s.ss; sy++) {
        for (let sx = 0; sx < s.ss; sx++) {
          const o = (y * s.ss + sy) * s.W + (x * s.ss + sx);
          if (s.lit[o]) {
            r += s.base[0] * s.shade[o];
            g += s.base[1] * s.shade[o];
            bl += s.base[2] * s.shade[o];
          } else {
            r += s.bg[0];
            g += s.bg[1];
            bl += s.bg[2];
          }
        }
      }
      const o3 = (y * s.width + x) * 3;
      rgb[o3] = Math.min(255, Math.round(r / n));
      rgb[o3 + 1] = Math.min(255, Math.round(g / n));
      rgb[o3 + 2] = Math.min(255, Math.round(bl / n));
    }
  }
  return rgb;
}


/**
 * Depth buffer of an orthographic view, for hidden-line drawing.
 * @remarks renderMesh derives its right axis from +Z, which degenerates for a
 *   straight-down view; an engineering sheet's Top view is exactly that, so the
 *   basis here comes from an explicit up vector. Depth only: the rasteriser's
 *   shade buffers are filled and discarded.
 * @param {Mesh} mesh Mesh in millimetres.
 * @param {{ forward: number[], up: number[] }} view Viewing direction and screen up.
 * @param {{ centre: number[], scale: number, W: number, H: number }} frame World
 *   point at the panel centre, px per mm, and panel size in px.
 * @returns {{ depth: Float64Array, ids: Int32Array, project: (p: number[]) => number[],
 *   basis: { right: number[], up: number[], forward: number[] } }} depth is W*H,
 *   Infinity where nothing is drawn; ids holds the nearest triangle per pixel
 *   (-1 for none); project maps a world point to
 *   [px x, px y, depth]; basis is the camera frame in world coordinates.
 */
export function orthoDepth(mesh, view, frame) {
  const { centre, scale, W, H } = frame;
  const forward = unit(view.forward);
  const right = unit(cross(forward, view.up));
  const camUp = cross(right, forward);
  const pos = mesh.positions;
  const nv = pos.length / 3;
  const cx = new Float64Array(nv);
  const cy = new Float64Array(nv);
  const cz = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = sub([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], centre);
    cx[i] = dot(p, right);
    cy[i] = dot(p, camUp);
    cz[i] = dot(p, forward);
  }
  const depth = new Float64Array(W * H).fill(Infinity);
  const ids = new Int32Array(W * H).fill(-1);
  rasterize({
    pos, idx: mesh.indices, cx, cy, cz, scale, W, H, depth,
    shade: new Float64Array(W * H), lit: new Uint8Array(W * H), light: forward, ids,
  });
  /** @param {number[]} p */
  const project = (p) => {
    const q = sub(p, centre);
    return [W / 2 + dot(q, right) * scale, H / 2 - dot(q, camUp) * scale, dot(q, forward)];
  };
  return { depth, ids, project, basis: { right, up: camUp, forward } };
}

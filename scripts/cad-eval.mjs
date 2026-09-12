/**
 * Offline evaluation harness for @arbesk/cad-gen.
 *
 * NOT part of the server. The server never runs the kernel - it generates code
 * and runs the static gates, and the client executes. This harness exists so a
 * design can be generated against the live provider, built, measured and
 * RENDERED for a human to look at. That loop is how the guard false-positive on
 * comment prose, the silently-empty hand-built fillet, and the concave-Minkowski
 * blowup were all found; none of them were visible to a passing unit test.
 *
 * Usage:
 *   bun scripts/cad-eval.mjs "<prompt>" ["<prompt>" ...]
 *   bun scripts/cad-eval.mjs --file <scenarios.json>
 *   ... [--out <dir>]        (default: test-results/cad-eval, which is gitignored)
 *
 * Each run gets its OWN numbered directory inside the output root -
 * <root>/attempt#1, <root>/attempt#2, ... - so a gallery accumulates as the
 * prelude, the prompt and the fidelity settings change, and a later attempt can
 * be compared against an earlier one instead of overwriting it. The run prints
 * the directory it wrote to; open it and look at the PNGs.
 *
 * Reads DEEPSEEK_API_KEY from the project .env. Runs the kernel IN PROCESS with
 * no wall-clock cap, so a pathological part will simply take a long time: this
 * is a tool for looking at output, not a service.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import Module from "manifold-3d";
import { createCadGenerator } from "../packages/cad-gen/src/backend/index.ts";
import { createCadKernel } from "../packages/cad-gen/src/core/kernel.ts";
import { buildPrelude, PRELUDE_NAMES } from "../packages/cad-gen/src/core/prelude.ts";

/** @typedef {{ positions: Float32Array, indices: Uint32Array }} Mesh */
/** @typedef {{ width?: number, height?: number, dir?: number[], tint?: number[],
 *   frame?: { centre: number[], extent: number } }} RenderOptions */

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const WASM_DIR = path.join(PROJECT_ROOT, "node_modules", "manifold-3d");

// ---------------------------------------------------------------- environment

/**
 * Parses a .env file into a plain record.
 * @param {string} file Absolute path to the env file.
 * @returns {Record<string, string>} Key/value pairs, quotes stripped.
 */
function loadEnv(file) {
  /** @type {Record<string, string>} */
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

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
function writePng(file, width, height, rgb) {
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
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number[]} b @returns {number} */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {number[]} a @param {number[]} b @returns {number[]} */
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * @param {number[]} v Any non-zero vector.
 * @returns {number[]} The unit vector in the same direction.
 */
function unit(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * @param {Mesh} mesh Any mesh.
 * @returns {{ min: number[], max: number[] }} Its axis-aligned bounds in mm.
 */
function boundsOf(mesh) {
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
function renderMesh(mesh, opts = {}) {
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
 *   light: number[] }} s Projected geometry and the buffers to fill.
 */
function rasterize(s) {
  const { pos, idx, cx, cy, cz, scale, W, H, depth, shade, lit, light } = s;
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

// ------------------------------------------------------------- reference STL

/**
 * Reads an ASCII STL into a mesh.
 * @remarks Ground truth for comparison has to go through the SAME renderer as
 *   our own output, or the comparison is of two different pictures rather than
 *   of two different parts. OpenSCAD writes ASCII STL by default, and this is
 *   the whole of that format: a facet normal line, an outer loop, three vertex
 *   lines, an endloop.
 * @param {string} file Path to an ASCII .stl.
 * @returns {Mesh} Positions and triangle indices.
 */
function readAsciiStl(file) {
  const buf = fs.readFileSync(file);
  // OpenSCAD writes ASCII, but almost every STL published elsewhere is binary.
  // Detected the standard way: a binary file's first five bytes are not "solid".
  if (!/^\s*solid/.test(buf.subarray(0, 5).toString("utf8"))) {
    return readBinaryStl(buf);
  }
  const text = buf.toString("utf8");
  /** @type {number[]} */
  const positions = [];
  /** @type {number[]} */
  const indices = [];
  for (const line of text.split("\n")) {
    const m = /^\s*vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/.exec(line);
    if (!m) continue;
    positions.push(Number(m[1]), Number(m[2]), Number(m[3]));
    if (positions.length % 9 === 0) {
      const v = positions.length / 3 - 3;
      indices.push(v, v + 1, v + 2);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Reads a binary STL into a mesh.
 * @remarks 80-byte header, a triangle count, then 50 bytes each: a normal the
 *   renderer recomputes anyway, three vertices, and a trailing attribute.
 * @param {Buffer} buf The whole file.
 * @returns {Mesh} Positions and triangle indices.
 */
function readBinaryStl(buf) {
  const count = buf.readUInt32LE(80);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      positions[o] = buf.readFloatLE(at + v * 12);
      positions[o + 1] = buf.readFloatLE(at + v * 12 + 4);
      positions[o + 2] = buf.readFloatLE(at + v * 12 + 8);
      indices[t * 3 + v] = t * 3 + v;
    }
  }
  return { positions, indices };
}

// ----------------------------------------------------------------- components

/** Distinct tints, so a body that is not joined to the rest is obvious. */
const TINTS = [
  [214, 219, 228],
  [232, 158, 138],
  [140, 198, 162],
  [206, 170, 228],
  [238, 212, 140],
];

/**
 * Splits a design into its connected solids and tints each one.
 * @remarks A render shows SURFACES, not connectivity: two bodies a tenth of a
 *   millimetre apart are pixel-identical to two bodies welded together, so the
 *   eye cannot separate a joined part from a detached one. Counting the
 *   components and colouring them differently is what makes the difference
 *   visible - Manifold.decompose() is exact where the eye is not. Live evidence:
 *   a timing pulley whose teeth floated 0.75mm clear of the body rendered as
 *   "loose bars" that I had to read the code to explain, and a blind bore that
 *   was invisible from every angle.
 * @param {any} module A loaded manifold-3d module.
 * @param {any} design The design document.
 * @returns {{ solids: number, meshes: Mesh[], tints: number[][] }} What to draw.
 */
function componentsOf(module, design) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const [k, v] of Object.entries(design.parameters)) values[k] = /** @type {any} */ (v).value;
  const fn = new Function("PARAMETERS", "P", "M", ...PRELUDE_NAMES, design.code);
  const helpers = buildPrelude(module, { segments: 64 });
  const part = fn(values, values, module.Manifold, ...PRELUDE_NAMES.map((n) => helpers[n]));
  const solids = part.decompose();
  return {
    solids: solids.length,
    meshes: solids.map((/** @type {any} */ s) => {
      const raw = s.getMesh();
      const nv = raw.vertProperties.length / raw.numProp;
      const positions = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        positions[v * 3] = raw.vertProperties[v * raw.numProp];
        positions[v * 3 + 1] = raw.vertProperties[v * raw.numProp + 1];
        positions[v * 3 + 2] = raw.vertProperties[v * raw.numProp + 2];
      }
      return { positions, indices: new Uint32Array(raw.triVerts) };
    }),
    tints: solids.map((/** @type {any} */ _s, /** @type {number} */ i) => TINTS[i % TINTS.length]),
  };
}

/**
 * Draws every component into one image, each in its own tint.
 * @param {string} file Destination PNG.
 * @param {Mesh[]} meshes Component meshes, all in the same world frame.
 * @param {number[][]} tints One tint per mesh.
 * @param {RenderOptions} opts Size and view direction.
 * @returns {number} Bytes written.
 */
function renderComponents(file, meshes, tints, opts) {
  const boxes = meshes.map((m) => boundsOf(m));
  const centre = [0, 1, 2].map((a) =>
    (Math.min(...boxes.map((b) => b.min[a])) + Math.max(...boxes.map((b) => b.max[a]))) / 2);
  const extent = Math.max(...boxes.flatMap((b) =>
    [0, 1, 2].map((a) => Math.max(Math.abs(b.min[a] - centre[a]), Math.abs(b.max[a] - centre[a])))));
  const layers = meshes.map((mesh, i) =>
    renderMesh(mesh, { ...opts, tint: tints[i], frame: { centre, extent } }));
  const width = layers[0].width;
  const height = layers[0].height;
  const out = Buffer.alloc(width * height * 3);
  // Paint furthest-component-first so a small piece is never hidden behind a
  // large one: a loose standoff must not be occluded by the box it fell off.
  const order = meshes.map((m, i) => ({ i, size: m.indices.length })).sort((a, b) => b.size - a.size);
  for (const { i } of order) {
    const rgb = layers[i].rgb;
    for (let p = 0; p < out.length; p += 3) {
      if (rgb[p] !== 20 || rgb[p + 1] !== 22 || rgb[p + 2] !== 27) {
        out[p] = rgb[p];
        out[p + 1] = rgb[p + 1];
        out[p + 2] = rgb[p + 2];
      }
    }
  }
  for (let p = 0; p < out.length; p += 3) {
    if (out[p] === 0 && out[p + 1] === 0 && out[p + 2] === 0) {
      out[p] = 20;
      out[p + 1] = 22;
      out[p + 2] = 27;
    }
  }
  return writePng(file, width, height, out);
}

// ----------------------------------------------------------------------- GLB

/** Column-major mm (Z-up) -> m (Y-up), applied on the node matrix, never baked. */
const GLB_MATRIX = [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1];

/**
 * @param {Buffer} buf Any buffer.
 * @param {number} fill Pad byte.
 * @returns {Buffer} The buffer padded to a 4-byte boundary.
 */
function pad4(buf, fill) {
  const rem = buf.length % 4;
  return rem ? Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]) : buf;
}

/**
 * Writes a mesh as a binary glTF.
 * @param {string} file Destination path.
 * @param {Mesh} mesh Mesh in millimetres, Z-up.
 * @returns {number} Bytes written.
 */
function writeGlb(file, mesh) {
  const nv = mesh.positions.length / 3;
  const ni = mesh.indices.length;
  const posBuf = Buffer.from(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  const idxBuf = Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
  const bin = pad4(Buffer.concat([posBuf, idxBuf]), 0);
  const { min, max } = boundsOf(mesh);

  const gltf = {
    asset: { version: "2.0", generator: "arbesk cad-eval harness" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "part", matrix: GLB_MATRIX }],
    meshes: [{ name: "part", primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: "cad", pbrMetallicRoughness: { baseColorFactor: [0.8, 0.82, 0.86, 1], metallicFactor: 0.1, roughnessFactor: 0.45 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nv, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5125, count: ni, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: nv * 12, target: 34962 },
      { buffer: 0, byteOffset: nv * 12, byteLength: ni * 4, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const json = pad4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 16 + json.length + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(json.length, 0);
  jsonHead.write("JSON", 4, "ascii");
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.write("BIN\0", 4, "ascii");
  const out = Buffer.concat([header, jsonHead, json, binHead, bin]);
  fs.writeFileSync(file, out);
  return out.length;
}

// ---------------------------------------------------------------------- main

/** Where renders land when the caller does not name a directory. */
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, "test-results", "cad-eval");

/**
 * Creates and returns the next free `attempt#N` directory under `root`.
 * @remarks Never reuses a number, so an earlier attempt stays on disk to compare
 *   against. The counter is derived from what is already there rather than kept
 *   in a file, so deleting a gallery resets it and nothing can drift.
 * @param {string} root Gallery root, created if absent.
 * @returns {string} Absolute path to the freshly created run directory.
 */
function nextAttemptDir(root) {
  fs.mkdirSync(root, { recursive: true });
  const taken = new Set(fs.readdirSync(root));
  for (let n = 1; ; n++) {
    const name = "attempt#" + n;
    if (taken.has(name)) continue;
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    return dir;
  }
}

/**
 * Splits `--out <dir>` out of argv.
 * @param {string[]} argv Arguments after the script path.
 * @returns {{ outDir: string, rest: string[] }} Output directory and the rest.
 */
function parseArgs(argv) {
  const at = argv.indexOf("--out");
  if (at === -1) return { outDir: DEFAULT_OUT_DIR, rest: argv };
  const named = argv[at + 1];
  return {
    outDir: named && !named.startsWith("--") ? path.resolve(named) : DEFAULT_OUT_DIR,
    rest: [...argv.slice(0, at), ...argv.slice(at + 2)],
  };
}

/**
 * Resolves the scenario list from argv.
 * @param {string[]} argv Arguments after the output directory.
 * @returns {{ name: string, prompt: string }[]} Scenarios to run.
 */
function scenariosFrom(argv) {
  if (argv[0] === "--file") {
    return JSON.parse(fs.readFileSync(argv[1], "utf8"));
  }
  return argv.map((prompt, i) => ({ name: "q" + (i + 1), prompt }));
}

/**
 * @param {string} name Scenario name, used as the file stem.
 * @returns {string} A filesystem-safe slug.
 */
const slug = (name) => name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

async function main() {
  const { outDir, rest } = parseArgs(process.argv.slice(2));
  // Reference mode: render a known-good STL through our own renderer so a
  // comparison is of two PARTS, not of two different pictures.
  if (rest[0] === "--stl") {
    const mesh = readAsciiStl(rest[1]);
    const stats = boundsOf(mesh);
    const target = rest[2] ?? path.join(outDir, path.basename(rest[1]).replace(/\.stl$/i, ".png"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writePng(target, ...(() => {
      const image = renderMesh(mesh, { width: 720, height: 560 });
      return /** @type {[number, number, Buffer]} */ ([image.width, image.height, image.rgb]);
    })());
    console.log("reference " + rest[1]);
    console.log("  triangles " + mesh.indices.length / 3);
    console.log("  size mm   " + [0, 1, 2].map((a) => (stats.max[a] - stats.min[a]).toFixed(2)).join(" x "));
    console.log("  centre mm " + [0, 1, 2].map((a) => ((stats.min[a] + stats.max[a]) / 2).toFixed(2)).join(", "));
    console.log("  png       " + target);
    return;
  }
  if (rest.length === 0) {
    console.error("usage: bun scripts/cad-eval.mjs <prompt...> | --file <scenarios.json> [--out DIR]");
    process.exit(2);
  }
  const env = loadEnv(path.join(PROJECT_ROOT, ".env"));
  if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing from .env");
  const runDir = nextAttemptDir(outDir);
  console.log("run directory: " + runDir);

  // manifold.d.ts declares locateFile as zero-arity while Emscripten calls it WITH
  // the filename, so the typed config rejects a correct callback (TS2322). Type the
  // options bag as any rather than casting the callback - the same workaround, and
  // the same reason, as backend/child.ts.
  /** @type {any} */
  const moduleOptions = { locateFile: (/** @type {string} */ f) => path.join(WASM_DIR, f) };
  const module = await Module(moduleOptions);
  module.setup();
  // Delivery fidelity: this harness renders what the user would get, not the
  // coarse proxy the old server-side validation pass ran at.
  const kernel = createCadKernel(module, { segments: 64 });
  const generator = createCadGenerator({
    apiKey: env.DEEPSEEK_API_KEY,
    model: env.CAD_MODEL || "deepseek-flash",
    ...(env.DEEPSEEK_BASE_URL ? { baseUrl: env.DEEPSEEK_BASE_URL } : {}),
    ...(env.CAD_THINKING ? { thinking: true } : {}),
  });

  for (const scenario of scenariosFrom(rest)) {
    await runScenario({ generator, kernel, module, outDir: runDir, scenario });
  }
  console.log("\nrenders written to " + runDir);
}

/**
 * Generates, builds, renders and reports one scenario.
 * @param {{ generator: any, kernel: any, module: any, outDir: string,
 *   scenario: { name: string, prompt: string } }} ctx Run context.
 * @returns {Promise<void>} Resolves once the scenario has been reported.
 */
async function runScenario(ctx) {
  const { generator, kernel, outDir, scenario } = ctx;
  const stem = slug(scenario.name);
  console.log("\n=== " + scenario.name + " ===");
  console.log("PROMPT: " + scenario.prompt);
  const started = Date.now();
  try {
    const result = await generator.generate({ prompt: scenario.prompt });
    console.log("generate " + (Date.now() - started) + "ms  attempts=" +
      result.diagnostics.attempts.length + "  tokens=" + JSON.stringify(result.diagnostics.tokens));
    console.log("summary: " + result.design.summary);
    // Written BEFORE the build, so a design whose kernel run throws is still on
    // disk to read: that is exactly when its code is most wanted.
    fs.writeFileSync(path.join(outDir, stem + ".json"), JSON.stringify(result.design, null, 2));
    const buildStart = Date.now();
    const { mesh, stats } = kernel.run(result.design);
    console.log("kernel   " + (Date.now() - buildStart) + "ms  " + JSON.stringify(stats));
    const { solids, meshes, tints } = componentsOf(ctx.module, result.design);
    console.log("solids   " + solids + (solids > 1 ? "   <-- NOT ONE BODY, pieces are not joined" : ""));
    const png = path.join(outDir, stem + ".png");
    console.log("png " + png + " (" + renderComponents(png, meshes, tints, {}) + " B)");
    console.log("glb " + writeGlb(path.join(outDir, stem + ".glb"), mesh) + " B");
  } catch (e) {
    console.log("FAILED after " + (Date.now() - started) + "ms: " + (e instanceof Error ? e.message : String(e)));
  }
}

main().catch((e) => {
  console.error("HARNESS_FATAL", e);
  process.exit(1);
});

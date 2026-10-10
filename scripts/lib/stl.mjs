/**
 * STL reading and writing for the CAD harnesses.
 * @remarks Moved out of scripts/cad-eval.mjs so the benchmark reads ground
 *   truth with the same code the eval renders references with.
 */
import fs from "node:fs";

/** @typedef {{ positions: Float32Array, indices: Uint32Array }} Mesh */

/**
 * Reads an STL - ASCII or binary - into a triangle-soup mesh.
 * @remarks Ground truth for comparison has to go through the SAME code as our
 *   own output, or the comparison is of two different readings rather than of
 *   two different parts. ASCII is a facet normal line, an outer loop, three
 *   vertex lines, an endloop; a binary file's first five bytes are not "solid".
 * @param {string} file Path to an .stl.
 * @returns {Mesh} Positions and triangle indices.
 */
export function readStl(file) {
  const buf = fs.readFileSync(file);
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
export function readBinaryStl(buf) {
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

/**
 * Writes a mesh as binary STL.
 * @remarks Normals are left zero: every reader, ours included, recomputes them.
 *   The header must not start with "solid" or readers take it for ASCII.
 * @param {string} file Destination path.
 * @param {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} mesh
 */
export function writeBinaryStl(file, mesh) {
  const count = mesh.indices.length / 3;
  const buf = Buffer.alloc(84 + count * 50);
  buf.write("arbesk cad-bench", 0, "ascii");
  buf.writeUInt32LE(count, 80);
  for (let t = 0; t < count; t++) {
    const at = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const i = mesh.indices[t * 3 + v] * 3;
      for (let a = 0; a < 3; a++) buf.writeFloatLE(mesh.positions[i + a], at + v * 12 + a * 4);
    }
  }
  fs.writeFileSync(file, buf);
}

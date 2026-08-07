/**
 * Generates animated-triangle.glb — a minimal valid glTF 2.0 binary with one
 * triangle mesh and a 1s looping "spin" rotation animation on its node.
 * Run: node e2e/fixtures/make-animated-glb.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// BIN chunk: 3×VEC3 positions | 2×SCALAR times | 2×VEC4 quaternions
const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
const times = new Float32Array([0, 1]);
const rotations = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]); // identity, 180° about Z
const bin = Buffer.concat([
  Buffer.from(positions.buffer),
  Buffer.from(times.buffer),
  Buffer.from(rotations.buffer),
]);
const binPad = (4 - (bin.length % 4)) % 4;
const binPadded = Buffer.concat([bin, Buffer.alloc(binPad)]);

const gltf = {
  asset: { version: "2.0", generator: "arbesk-e2e" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "spin-tri" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  animations: [
    {
      name: "spin",
      channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
      samplers: [{ input: 1, interpolation: "LINEAR", output: 2 }],
    },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-1, -1, 0], max: [1, 1, 0] },
    { bufferView: 1, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
    { bufferView: 2, componentType: 5126, count: 2, type: "VEC4" },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 8 },
    { buffer: 0, byteOffset: 44, byteLength: 32 },
  ],
  buffers: [{ byteLength: bin.length }],
};

let json = Buffer.from(JSON.stringify(gltf), "utf8");
const jsonPad = (4 - (json.length % 4)) % 4;
if (jsonPad) json = Buffer.concat([json, Buffer.from(" ".repeat(jsonPad))]);

/**
 * @param {number} len
 * @param {number} type
 * @returns {Buffer}
 */
const chunkHeader = (len, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(len, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);

const body = Buffer.concat([
  chunkHeader(json.length, 0x4e4f534a), // JSON
  json,
  chunkHeader(binPadded.length, 0x004e4942), // BIN
  binPadded,
]);
header.writeUInt32LE(12 + body.length, 8);

const out = path.join(__dirname, "animated-triangle.glb");
writeFileSync(out, Buffer.concat([header, body]));
console.log(`wrote ${out}`);

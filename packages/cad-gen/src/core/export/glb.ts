/**
 * Mesh to GLB. Vertices stay in mm, Z-up; the conversion to m, Y-up is a node
 * matrix, as asset-core's 3MF import does.
 */
import { serializeGLB } from "@arbesk/asset-core/formats/gltf/gltf-core.js";
import type { CadDesign, CadMesh } from "../../types.ts";

/** Column-major node matrix: rotate -90 degrees about X, then scale mm to m. */
const MM_TO_M_Z_UP_TO_Y_UP = [
  0.001, 0, 0, 0,
  0, 0, -0.001, 0,
  0, 0.001, 0, 0,
  0, 0, 0, 1,
];

function computeNormals(mesh: CadMesh): Float32Array {
  const { positions, indices } = mesh;
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

function bytesOf(view: Float32Array | Uint32Array): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

function positionBounds(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const axis = i % 3;
    if (positions[i] < min[axis]) min[axis] = positions[i];
    if (positions[i] > max[axis]) max[axis] = positions[i];
  }
  return { min, max };
}

/** Packs three byte runs into one chunk, each 4-byte aligned as glTF requires. */
function packChunk(indexBytes: Uint8Array, posBytes: Uint8Array, normalBytes: Uint8Array) {
  const posOffset = indexBytes.length + ((4 - (indexBytes.length % 4)) % 4);
  const normalOffset = posOffset + posBytes.length + ((4 - (posBytes.length % 4)) % 4);
  const bin = new Uint8Array(normalOffset + normalBytes.length);
  bin.set(indexBytes, 0);
  bin.set(posBytes, posOffset);
  bin.set(normalBytes, normalOffset);
  return { bin, posOffset, normalOffset };
}

/** One part's binary run, buffer views, accessors and primitive, from the given bases. */
function partBuffers(mesh: CadMesh, byteBase: number, viewBase: number) {
  const normals = computeNormals(mesh);
  const indexBytes = bytesOf(mesh.indices);
  const posBytes = bytesOf(mesh.positions);
  const normalBytes = bytesOf(normals);
  const { bin, posOffset, normalOffset } = packChunk(indexBytes, posBytes, normalBytes);
  const bounds = positionBounds(mesh.positions);
  return {
    bin,
    bufferViews: [
      { buffer: 0, byteOffset: byteBase, byteLength: indexBytes.length, target: 34963 },
      { buffer: 0, byteOffset: byteBase + posOffset, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: byteBase + normalOffset, byteLength: normalBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: viewBase, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
      {
        bufferView: viewBase + 1, componentType: 5126, count: mesh.positions.length / 3, type: "VEC3",
        min: bounds.min, max: bounds.max,
      },
      { bufferView: viewBase + 2, componentType: 5126, count: normals.length / 3, type: "VEC3" },
    ],
    primitive: {
      attributes: { POSITION: viewBase + 1, NORMAL: viewBase + 2 }, indices: viewBase, material: 0,
    },
  };
}

function partNodes(count: number) {
  if (count === 1) return [{ mesh: 0, matrix: MM_TO_M_Z_UP_TO_Y_UP, name: "cad_part" }];
  return [
    { matrix: MM_TO_M_Z_UP_TO_Y_UP, name: "cad_part", children: Array.from({ length: count }, (_v, i) => i + 1) },
    ...Array.from({ length: count }, (_v, i) => ({ mesh: i, name: "part-" + (i + 1) })),
  ];
}

/** The glTF document and binary chunk shared by meshToGlb and meshToGltf, so they cannot drift. */
export function buildPartDocument(mesh: CadMesh | CadMesh[], design: CadDesign) {
  const meshes = Array.isArray(mesh) ? mesh : [mesh];
  const runs: ReturnType<typeof partBuffers>[] = [];
  let byteBase = 0;
  for (const [i, m] of meshes.entries()) {
    const run = partBuffers(m, byteBase, i * 3);
    runs.push(run);
    byteBase += run.bin.length; // every run ends on a 4-byte boundary (float32 normals)
  }
  const bin = new Uint8Array(byteBase);
  let at = 0;
  for (const run of runs) {
    bin.set(run.bin, at);
    at += run.bin.length;
  }

  const gltf = {
    asset: {
      version: "2.0",
      generator: "arbesk-cad-gen",
      extras: { arbesk_cad: design, arbesk_units: "mm" },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: partNodes(meshes.length),
    meshes: runs.map((r) => ({ primitives: [r.primitive] })),
    materials: [{
      name: "cad_default",
      pbrMetallicRoughness: {
        baseColorFactor: [0.75, 0.76, 0.78, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: runs.flatMap((r) => r.bufferViews),
    accessors: runs.flatMap((r) => r.accessors),
  };

  return { gltf, bin };
}

/** The design rides in asset.extras, so the file alone reconstructs the design and its credits. */
export function meshToGlb(mesh: CadMesh | CadMesh[], design: CadDesign): Uint8Array {
  const { gltf, bin } = buildPartDocument(mesh, design);
  return new Uint8Array(serializeGLB(gltf as never, bin));
}

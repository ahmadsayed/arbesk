/**
 * Mesh to GLB, for previewing a CAD part.
 * @remarks Vertex data stays in Manifold coordinates (mm, Z-up): the mm-to-m and
 *   Z-up-to-Y-up correction is applied as a NODE MATRIX, matching the convention
 *   asset-core's 3mf/to-gltf.ts already uses for 3MF input. Baking it into the
 *   vertices would corrupt the mesh for every other consumer.
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

/** Area-weighted vertex normals computed from positions and indices. */
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

/** A view over the same bytes a typed array holds, without copying them. */
function bytesOf(view: Float32Array | Uint32Array): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

/** Axis-aligned bounds, which glTF requires on a POSITION accessor. */
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

/**
 * Packs three byte runs into one binary chunk, each 4-byte aligned.
 * @remarks glTF requires every bufferView offset to be a multiple of its
 *   component size; an unaligned VEC3 accessor is the classic "renders in one
 *   viewer, black in another" bug.
 */
function packChunk(indexBytes: Uint8Array, posBytes: Uint8Array, normalBytes: Uint8Array) {
  const posOffset = indexBytes.length + ((4 - (indexBytes.length % 4)) % 4);
  const normalOffset = posOffset + posBytes.length + ((4 - (posBytes.length % 4)) % 4);
  const bin = new Uint8Array(normalOffset + normalBytes.length);
  bin.set(indexBytes, 0);
  bin.set(posBytes, posOffset);
  bin.set(normalBytes, normalOffset);
  return { bin, posOffset, normalOffset };
}

/**
 * Serialises a mesh plus its design document to GLB bytes.
 * @remarks Single self-contained buffer; the design rides in asset.extras, so
 *   the exported file alone reconstructs the design and its credits.
 */
export function meshToGlb(mesh: CadMesh, design: CadDesign): Uint8Array {
  const normals = computeNormals(mesh);
  const indexBytes = bytesOf(mesh.indices);
  const posBytes = bytesOf(mesh.positions);
  const normalBytes = bytesOf(normals);
  const { bin, posOffset, normalOffset } = packChunk(indexBytes, posBytes, normalBytes);
  const bounds = positionBounds(mesh.positions);

  const gltf = {
    asset: {
      version: "2.0",
      generator: "arbesk-cad-gen",
      extras: { arbesk_cad: design, arbesk_units: "mm" },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, matrix: MM_TO_M_Z_UP_TO_Y_UP, name: "cad_part" }],
    meshes: [{
      primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, material: 0 }],
    }],
    materials: [{
      name: "cad_default",
      pbrMetallicRoughness: {
        baseColorFactor: [0.75, 0.76, 0.78, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
    }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes.length, target: 34963 },
      { buffer: 0, byteOffset: posOffset, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes.length, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
      {
        bufferView: 1, componentType: 5126, count: mesh.positions.length / 3, type: "VEC3",
        min: bounds.min, max: bounds.max,
      },
      { bufferView: 2, componentType: 5126, count: normals.length / 3, type: "VEC3" },
    ],
  };

  return new Uint8Array(serializeGLB(gltf as never, bin));
}

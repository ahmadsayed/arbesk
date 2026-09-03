/**
 * Converts a Parsed3mf structure to glTF 2.0 JSON.
 * @remarks The output is a self-contained glTF used only as an in-memory
 *   render representation and is never persisted. 3MF is Z-up and glTF is
 *   Y-up, so build items are parented to a root node rotated −90° about X
 *   (a proper rotation, preserving triangle winding).
 */

import type { Parsed3mf } from "./parser.ts";
import { arrayBufferToBase64 } from "../../utils/encoding.ts";

/** −90° about X as a glTF quaternion [x, y, z, w]. */
const Z_UP_TO_Y_UP_QUATERNION = [
  -Math.sin(Math.PI / 4),
  0,
  0,
  Math.cos(Math.PI / 4),
];

function u8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  return arrayBufferToBase64(bytes);
}

/**
 * "#RRGGBBAA" → [r, g, b, a] normalized to 0..1.
 */
function displayColorToFactor(hex: string | null | undefined): number[] {
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex || "");
  if (!m) return [0.8, 0.8, 0.8, 1];
  const rgb = m[1];
  const alpha = m[2] || "FF";
  return [
    parseInt(rgb.slice(0, 2), 16) / 255,
    parseInt(rgb.slice(2, 4), 16) / 255,
    parseInt(rgb.slice(4, 6), 16) / 255,
    parseInt(alpha, 16) / 255,
  ];
}

/**
 * Converts a 3MF 4×3 affine transform to a glTF 16-element matrix.
 * @remarks 3MF applies transforms to row vectors and glTF to column vectors;
 *   the conventions cancel out, so this is a pure re-layout — do NOT
 *   transpose the 3×3 part.
 */
function transformToMatrix4(t: number[]): number[] {
  return [
    t[0], t[1], t[2], 0,
    t[3], t[4], t[5], 0,
    t[6], t[7], t[8], 0,
    t[9], t[10], t[11], 1,
  ];
}

function sumBufferBytes(objects: any[]): number {
  let totalBytes = 0;
  for (const obj of objects) {
    totalBytes += obj.vertices.length * 4 + obj.triangles.length * 4;
  }
  return totalBytes;
}

function resolveMaterialIndex(
  obj: any,
  parsed: Parsed3mf,
  materials: any[],
  materialIndexByKey: Map<string, number>
): number | undefined {
  if (obj.pid === null || obj.pindex === null) return undefined;
  const key = `${obj.pid}:${obj.pindex}`;
  if (!materialIndexByKey.has(key)) {
    const groupMats = parsed.basematerials.filter(
      (m) => m.groupId === obj.pid
    );
    const mat = groupMats[obj.pindex];
    materialIndexByKey.set(key, materials.length);
    materials.push({
      name: mat?.name || `basematerial_${key}`,
      // Note: displaycolor alpha is carried into baseColorFactor[3], but
      // alphaMode stays default (opaque) in v1 — translucent 3MF materials
      // render opaque.
      pbrMetallicRoughness: {
        baseColorFactor: displayColorToFactor(mat?.color),
        metallicFactor: 0,
        roughnessFactor: 0.5,
      },
    });
  }
  return materialIndexByKey.get(key);
}

function appendObjectMesh(
  obj: any,
  parsed: Parsed3mf,
  view: DataView,
  byteOffset: number,
  materials: any[],
  materialIndexByKey: Map<string, number>,
  bufferViews: any[],
  accessors: any[]
): { mesh: any; byteOffset: number } {
  // Positions (FLOAT VEC3)
  const positionsByteOffset = byteOffset;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < obj.vertices.length; i++) {
    const value = obj.vertices[i];
    view.setFloat32(byteOffset, value, true);
    byteOffset += 4;
    const axis = i % 3;
    if (value < min[axis]) min[axis] = value;
    if (value > max[axis]) max[axis] = value;
  }
  bufferViews.push({
    buffer: 0,
    byteOffset: positionsByteOffset,
    byteLength: obj.vertices.length * 4,
  });
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType: 5126, // FLOAT
    count: obj.vertices.length / 3,
    type: "VEC3",
    min,
    max,
  });
  const positionAccessor = accessors.length - 1;

  // Indices (UNSIGNED_INT SCALAR)
  const indicesByteOffset = byteOffset;
  for (const index of obj.triangles) {
    view.setUint32(byteOffset, index, true);
    byteOffset += 4;
  }
  bufferViews.push({
    buffer: 0,
    byteOffset: indicesByteOffset,
    byteLength: obj.triangles.length * 4,
  });
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType: 5125, // UNSIGNED_INT
    count: obj.triangles.length,
    type: "SCALAR",
  });
  const indexAccessor = accessors.length - 1;

  // Material from basematerials via pid/pindex
  const materialIndex = resolveMaterialIndex(obj, parsed, materials, materialIndexByKey);

  const primitive: {
    attributes: { POSITION: number };
    indices: number;
    material?: number;
  } = {
    attributes: { POSITION: positionAccessor },
    indices: indexAccessor,
  };
  if (materialIndex !== undefined) primitive.material = materialIndex;
  const mesh = {
    name: obj.name || `object_${obj.id}`,
    primitives: [primitive],
  };

  return { mesh, byteOffset };
}

function buildItemNodes(
  parsed: Parsed3mf,
  meshIndexByObjectId: Map<string, number>
): Array<{ name: string; mesh: number; matrix?: number[] }> {
  const itemNodes: Array<{ name: string; mesh: number; matrix?: number[] }> =
    [];
  for (const [i, item] of parsed.items.entries()) {
    const meshIndex = meshIndexByObjectId.get(item.objectId);
    if (meshIndex === undefined) {
      console.warn(
        `[3MF] build item references unknown object ${item.objectId} - skipped`
      );
      continue;
    }
    const node: { name: string; mesh: number; matrix?: number[] } = {
      name: parsed.objects[meshIndex].name || `item_${i}`,
      mesh: meshIndex,
    };
    if (item.transform) node.matrix = transformToMatrix4(item.transform);
    itemNodes.push(node);
  }
  return itemNodes;
}

function buildNodes(parsed: Parsed3mf): any[] {
  const meshIndexByObjectId = new Map<string, number>(
    parsed.objects.map((o, index) => [o.id, index])
  );
  const itemNodes = buildItemNodes(parsed, meshIndexByObjectId);
  return [
    {
      name: "3mf_root",
      rotation: Z_UP_TO_Y_UP_QUATERNION,
      children: itemNodes.map((_, i) => i + 1),
    },
    ...itemNodes,
  ];
}

/**
 * @param parsed - result of parse3mfModel()
 * @returns glTF 2.0 JSON
 */
export function parsed3mfToGltf(parsed: Parsed3mf): object {
  const totalBytes = sumBufferBytes(parsed.objects);
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const meshes: any[] = [];
  const materials: any[] = [];
  const materialIndexByKey = new Map<string, number>(); // "pid:pindex" → materials[] index

  let byteOffset = 0;
  for (const obj of parsed.objects) {
    const { mesh, byteOffset: nextOffset } = appendObjectMesh(
      obj,
      parsed,
      view,
      byteOffset,
      materials,
      materialIndexByKey,
      bufferViews,
      accessors
    );
    byteOffset = nextOffset;
    meshes.push(mesh);
  }

  // Scene graph: axis-fix root + one node per build item.
  const nodes = buildNodes(parsed);

  return {
    asset: { version: "2.0", generator: "arbesk-3mf" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    ...(materials.length > 0 ? { materials } : {}),
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: totalBytes,
        uri: `data:application/octet-stream;base64,${u8ToBase64(
          new Uint8Array(buffer)
        )}`,
      },
    ],
  };
}

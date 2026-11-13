/**
 * Tests for the per-mesh buffer split (gltf-buffer-split.ts): each mesh's
 * bytes move to their own buffer so an unchanged mesh keeps its CID across
 * versions and across assets. Documents are built by hand so the byte layout
 * is under the test's control.
 */
import { describe, expect, test } from "bun:test";
import {
  splitBuffersByMesh,
  MAX_MESH_BUFFERS,
  MIN_MESH_BUFFER_BYTES,
} from "@arbesk/asset-core/formats/gltf/gltf-buffer-split.js";

const FLOAT = 5126;
const USHORT = 5123;
const UBYTE = 5121;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Vertices needed for a mesh to earn its own buffer. */
const BIG = Math.ceil(MIN_MESH_BUFFER_BYTES / 12) + 1;

/** Deterministic bytes, distinct per seed. */
function fill(length, seed) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed * 97 + 7) & 0xff;
  return out;
}

/**
 * Builds a single-buffer document the way an exporter would: all index data
 * in one bufferView, then one position bufferView per mesh.
 */
function buildDocument(meshes) {
  const indexParts = [];
  const positionParts = [];
  const accessors = [];
  const gltfMeshes = [];
  let indexOffset = 0;
  for (const mesh of meshes) {
    const indices = fill(mesh.vertices * 2, mesh.seed + 1000);
    const positions = fill(mesh.vertices * 12, mesh.seed);
    const padded = Math.ceil(indices.length / 4) * 4;
    accessors.push(
      { bufferView: 0, byteOffset: indexOffset, componentType: USHORT, count: mesh.vertices, type: "SCALAR" },
      { bufferView: gltfMeshes.length + 1, componentType: FLOAT, count: mesh.vertices, type: "VEC3" },
    );
    indexParts.push({ bytes: indices, padded });
    positionParts.push(positions);
    indexOffset += padded;
    gltfMeshes.push({
      name: mesh.name,
      primitives: [{ attributes: { POSITION: accessors.length - 1 }, indices: accessors.length - 2 }],
    });
  }
  const bytes = new Uint8Array(indexOffset + positionParts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const part of indexParts) {
    bytes.set(part.bytes, pos);
    pos += part.padded;
  }
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: indexOffset, target: 34963 }];
  for (const positions of positionParts) {
    bufferViews.push({ buffer: 0, byteOffset: pos, byteLength: positions.length, target: 34962 });
    bytes.set(positions, pos);
    pos += positions.length;
  }
  return {
    composite: {
      asset: { version: "2.0" },
      buffers: [{ byteLength: bytes.length }],
      bufferViews,
      accessors,
      meshes: gltfMeshes,
    },
    bytes: [bytes],
  };
}

/** The bytes an accessor reads, through whatever layout the document has. */
function accessorBytes(composite, bytes, index) {
  const accessor = composite.accessors[index];
  const view = composite.bufferViews[accessor.bufferView];
  const size = COMPONENT_BYTES[accessor.componentType] * TYPE_COMPONENTS[accessor.type];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return bytes[view.buffer].slice(start, start + accessor.count * size);
}

function allAccessorBytes(composite, bytes) {
  return composite.accessors.map((_, i) => [...accessorBytes(composite, bytes, i)]);
}

describe("splitBuffersByMesh", () => {
  test("gives each large mesh its own buffer and keeps every accessor's data", () => {
    const { composite, bytes } = buildDocument([
      { name: "body", vertices: BIG, seed: 1 },
      { name: "jacket", vertices: BIG + 10, seed: 2 },
    ]);
    const before = allAccessorBytes(composite, bytes);

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    expect(composite.buffers).toHaveLength(2);
    expect(composite.buffers.map((b) => b.byteLength)).toEqual(bytes.map((b) => b.length));
    expect(allAccessorBytes(composite, bytes)).toEqual(before);
    // The shared index bufferView was cut in two, one piece per mesh.
    expect(composite.bufferViews.map((v) => v.buffer)).toEqual([0, 1, 0, 1]);
    expect(composite.bufferViews[0].target).toBe(34963);
  });

  test("the same mesh gets identical bytes whatever else the file contains", () => {
    const body = { name: "body", vertices: BIG, seed: 1 };
    const a = buildDocument([body, { name: "jacket", vertices: BIG + 10, seed: 2 }]);
    const b = buildDocument([{ name: "hat", vertices: BIG + 500, seed: 3 }, body]);

    splitBuffersByMesh(a.composite, a.bytes);
    splitBuffersByMesh(b.composite, b.bytes);

    expect(Buffer.from(a.bytes[0]).equals(Buffer.from(b.bytes[1]))).toBe(true);
    expect(Buffer.from(a.bytes[1]).equals(Buffer.from(b.bytes[0]))).toBe(false);
  });

  test("small meshes share one buffer, placed last", () => {
    const { composite, bytes } = buildDocument([
      { name: "button", vertices: 6, seed: 1 },
      { name: "body", vertices: BIG, seed: 2 },
      { name: "buckle", vertices: 9, seed: 3 },
    ]);
    const before = allAccessorBytes(composite, bytes);

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    expect(composite.buffers).toHaveLength(2);
    expect(bytes[0].length).toBeGreaterThanOrEqual(MIN_MESH_BUFFER_BYTES);
    expect(bytes[1].length).toBeLessThan(MIN_MESH_BUFFER_BYTES);
    expect(allAccessorBytes(composite, bytes)).toEqual(before);
  });

  test("an accessor used by two meshes goes to the shared buffer", () => {
    const { composite, bytes } = buildDocument([
      { name: "body", vertices: BIG, seed: 1 },
      { name: "twin", vertices: BIG, seed: 2 },
    ]);
    composite.meshes[1].primitives[0].attributes.POSITION = 1; // body's positions
    composite.accessors.splice(3, 1);
    composite.bufferViews.splice(2, 1);
    bytes[0] = bytes[0].slice(0, composite.bufferViews[1].byteOffset + composite.bufferViews[1].byteLength);
    composite.buffers[0].byteLength = bytes[0].length;
    const before = allAccessorBytes(composite, bytes);

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    // Neither mesh keeps enough bytes of its own; everything is shared.
    expect(composite.buffers).toHaveLength(1);
    expect(allAccessorBytes(composite, bytes)).toEqual(before);
  });

  test("caps the number of mesh buffers and keeps the largest", () => {
    const meshes = Array.from({ length: MAX_MESH_BUFFERS + 3 }, (_, i) => ({
      name: `m${i}`,
      vertices: BIG + i,
      seed: i,
    }));
    const { composite, bytes } = buildDocument(meshes);
    const before = allAccessorBytes(composite, bytes);

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    expect(composite.buffers).toHaveLength(MAX_MESH_BUFFERS + 1);
    // The three smallest meshes (m0..m2) are the ones that share.
    const sharedBuffer = composite.buffers.length - 1;
    const sharedMeshes = composite.meshes
      .filter((m) => composite.bufferViews[composite.accessors[m.primitives[0].attributes.POSITION].bufferView].buffer === sharedBuffer)
      .map((m) => m.name);
    expect(sharedMeshes).toEqual(["m0", "m1", "m2"]);
    expect(allAccessorBytes(composite, bytes)).toEqual(before);
  });

  test("keeps accessors aligned and pads every buffer to 4 bytes", () => {
    // A 1-byte accessor at an odd offset ahead of the float data.
    const weights = fill(BIG, 9);
    const positions = fill(BIG * 12, 4);
    const start = 4 + Math.ceil(weights.length / 4) * 4;
    const bytes = [new Uint8Array(start + positions.length + 3)];
    bytes[0].set(weights, 3);
    bytes[0].set(positions, start);
    const composite = {
      buffers: [{ byteLength: bytes[0].length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: start + positions.length }],
      accessors: [
        { bufferView: 0, byteOffset: 3, componentType: UBYTE, count: BIG, type: "SCALAR" },
        { bufferView: 0, byteOffset: start, componentType: FLOAT, count: BIG, type: "VEC3" },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 1, _WEIGHT: 0 } }] }],
    };
    const before = allAccessorBytes(composite, bytes);

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    expect(allAccessorBytes(composite, bytes)).toEqual(before);
    const view = composite.bufferViews[composite.accessors[1].bufferView];
    expect((view.byteOffset + (composite.accessors[1].byteOffset || 0)) % 4).toBe(0);
    expect(bytes[0].length % 4).toBe(0);
    expect(composite.buffers[0].byteLength).toBe(bytes[0].length);
  });

  test("moves animation data to the shared buffer", () => {
    const { composite, bytes } = buildDocument([{ name: "body", vertices: BIG, seed: 1 }]);
    const times = fill(16, 5);
    const merged = new Uint8Array(bytes[0].length + times.length);
    merged.set(bytes[0]);
    merged.set(times, bytes[0].length);
    composite.bufferViews.push({ buffer: 0, byteOffset: bytes[0].length, byteLength: times.length });
    composite.accessors.push({ bufferView: 2, componentType: FLOAT, count: 4, type: "SCALAR" });
    composite.buffers[0].byteLength = merged.length;
    bytes[0] = merged;

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    expect(composite.buffers).toHaveLength(2);
    expect([...bytes[1]]).toEqual([...times]);
    expect(composite.bufferViews[composite.accessors[2].bufferView].buffer).toBe(1);
  });

  test("relocates sparse accessors and Draco bufferViews with their mesh", () => {
    const { composite, bytes } = buildDocument([{ name: "body", vertices: BIG, seed: 1 }]);
    const extra = fill(8 + 24 + 40, 6); // sparse indices, sparse values, draco payload
    const base = bytes[0].length;
    const merged = new Uint8Array(base + extra.length);
    merged.set(bytes[0]);
    merged.set(extra, base);
    bytes[0] = merged;
    composite.buffers[0].byteLength = merged.length;
    composite.bufferViews.push(
      { buffer: 0, byteOffset: base, byteLength: 8 },
      { buffer: 0, byteOffset: base + 8, byteLength: 24 },
      { buffer: 0, byteOffset: base + 32, byteLength: 40 },
    );
    composite.accessors[1].sparse = {
      count: 2,
      indices: { bufferView: 2, componentType: USHORT, byteOffset: 4 },
      values: { bufferView: 3 },
    };
    composite.meshes[0].primitives[0].extensions = {
      KHR_draco_mesh_compression: { bufferView: 4, attributes: { POSITION: 0 } },
    };

    expect(splitBuffersByMesh(composite, bytes)).toBe(true);

    const slice = (view) => [...bytes[view.buffer].slice(view.byteOffset, view.byteOffset + view.byteLength)];
    const sparse = composite.accessors[1].sparse;
    const draco = composite.meshes[0].primitives[0].extensions.KHR_draco_mesh_compression;
    expect(composite.buffers).toHaveLength(1);
    expect(slice(composite.bufferViews[sparse.indices.bufferView])).toEqual([...extra.slice(4, 8)]);
    expect(sparse.indices.byteOffset).toBeUndefined();
    expect(slice(composite.bufferViews[sparse.values.bufferView])).toEqual([...extra.slice(8, 32)]);
    expect(slice(composite.bufferViews[draco.bufferView])).toEqual([...extra.slice(32)]);
  });

  test("leaves buffers it has no bytes for and renumbers their bufferViews", () => {
    const { composite, bytes } = buildDocument([
      { name: "body", vertices: BIG, seed: 1 },
      { name: "jacket", vertices: BIG, seed: 2 },
    ]);
    composite.buffers.unshift({ uri: "ipfs://bafyStored", byteLength: 12 });
    for (const view of composite.bufferViews) view.buffer = 1;
    composite.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: 12 });
    composite.accessors.push({ bufferView: 3, componentType: FLOAT, count: 1, type: "VEC3" });
    const bytesByIndex = [undefined, bytes[0]];

    expect(splitBuffersByMesh(composite, bytesByIndex)).toBe(true);

    expect(composite.buffers[0]).toEqual({ uri: "ipfs://bafyStored", byteLength: 12 });
    expect(composite.buffers).toHaveLength(3);
    expect(bytesByIndex[0]).toBeUndefined();
    const stored = composite.bufferViews[composite.accessors[4].bufferView];
    expect(stored).toEqual({ buffer: 0, byteOffset: 0, byteLength: 12 });
  });

  describe("documents it must not touch", () => {
    function untouched(mutate) {
      const { composite, bytes } = buildDocument([
        { name: "body", vertices: BIG, seed: 1 },
        { name: "jacket", vertices: BIG, seed: 2 },
      ]);
      mutate(composite);
      const snapshot = JSON.stringify(composite);
      const original = bytes[0];

      expect(splitBuffersByMesh(composite, bytes)).toBe(false);

      expect(JSON.stringify(composite)).toBe(snapshot);
      expect(bytes).toEqual([original]);
    }

    test("a bufferView redirected by an extension (meshopt)", () => {
      untouched((c) => {
        c.bufferViews[1].extensions = { EXT_meshopt_compression: { buffer: 0, byteLength: 8 } };
      });
    });

    test("a bufferView nothing known reads", () => {
      untouched((c) => {
        c.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: 4 });
      });
    });

    test("an accessor that reads past its bufferView", () => {
      untouched((c) => {
        c.accessors[1].count += 1;
      });
    });

    test("an accessor with an unknown component type", () => {
      untouched((c) => {
        c.accessors[1].componentType = 9999;
      });
    });

    test("a document with no embedded bytes", () => {
      const { composite } = buildDocument([{ name: "body", vertices: BIG, seed: 1 }]);
      expect(splitBuffersByMesh(composite, [])).toBe(false);
    });
  });
});

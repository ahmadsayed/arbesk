/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from "@jest/globals";
import {
  computeGltfBounds,
  boundsFromGlbBytes,
  compensationScale,
} from "../../frontend/src/js/asset-core/gltf/bounds.js";

function makeGltf(meshes, accessors) {
  return { asset: { version: "2.0" }, meshes, accessors };
}

function buildGlb(gltfJson) {
  const json = new TextEncoder().encode(JSON.stringify(gltfJson));
  const pad = (4 - (json.length % 4)) % 4;
  const jsonChunk = new Uint8Array(json.length + pad);
  jsonChunk.set(json);
  jsonChunk.fill(0x20, json.length);
  const total = 12 + 8 + jsonChunk.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  new Uint8Array(buf, 20).set(jsonChunk);
  return buf;
}

describe("computeGltfBounds", () => {
  test("unions mesh POSITION accessors and ignores other VEC3 data", () => {
    const gltf = makeGltf(
      [
        { primitives: [{ attributes: { POSITION: 0, NORMAL: 2 } }] },
        { primitives: [{ attributes: { POSITION: 1 } }] },
      ],
      [
        { type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
        { type: "VEC3", min: [0, 0, 0], max: [3, 0.5, 0.25] },
        // A normal accessor is ±1 in every axis — it must not shrink the union.
        { type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      ]
    );
    const bounds = computeGltfBounds(gltf);
    expect(bounds.min).toEqual([-1, -1, -1]);
    expect(bounds.max).toEqual([3, 1, 1]);
    expect(bounds.size).toEqual([4, 2, 2]);
  });

  test("returns null when no usable POSITION accessors exist", () => {
    expect(computeGltfBounds(makeGltf([], []))).toBeNull();
    expect(
      computeGltfBounds(
        makeGltf([{ primitives: [{ attributes: { POSITION: 0 } }] }], [
          { type: "VEC3" }, // no min/max
        ])
      )
    ).toBeNull();
    expect(computeGltfBounds(null)).toBeNull();
  });
});

describe("boundsFromGlbBytes", () => {
  test("reads bounds from the JSON chunk without touching the BIN chunk", () => {
    const glb = buildGlb(
      makeGltf(
        [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        [{ type: "VEC3", min: [0, 0, 0], max: [0.105, 0.5, 0.39] }]
      )
    );
    expect(boundsFromGlbBytes(glb).size).toEqual([0.105, 0.5, 0.39]);
  });

  test("returns null for non-GLB bytes", () => {
    expect(boundsFromGlbBytes(new TextEncoder().encode('{"a":1}'))).toBeNull();
    expect(boundsFromGlbBytes(new Uint8Array(4))).toBeNull();
  });
});

describe("compensationScale", () => {
  const box = (s) => ({ min: [0, 0, 0], max: [s, s, s], size: [s, s, s] });

  test("returns the max-dimension ratio (Tripo halved the model twice)", () => {
    expect(compensationScale(box(2), box(0.5))).toBeCloseTo(4, 10);
  });

  test("returns null for near-1 ratios (float noise), degenerate, or extreme input", () => {
    expect(compensationScale(box(1), box(1))).toBeNull();
    expect(compensationScale(box(1), box(1.01))).toBeNull();
    expect(compensationScale(box(1), box(0))).toBeNull();
    expect(compensationScale(box(1), box(0.0001))).toBeNull(); // ratio 10000
    expect(compensationScale(null, box(1))).toBeNull();
    expect(compensationScale(box(1), null)).toBeNull();
  });
});

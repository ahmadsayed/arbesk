/**
 * GLB parser/serializer parity tests
 *
 * Validates that the @gltf-transform/core-backed parser and the custom
 * serializer round-trip correctly on real assets, including Draco-compressed
 * files.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isGLB,
  parseGLB,
  serializeGLB,
  decomposeGLB,
} from "../../frontend/src/js/gltf/glb-parser.js";

const HOWDY_PATH = join(process.cwd(), "mock-gltf-assets", "howdy.glb");
const TRIANGLE_PATH = join(process.cwd(), "mock-gltf-assets", "triangle.glb");

function readArrayBuffer(relPath) {
  const buf = readFileSync(relPath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function hasDraco(json) {
  const exts = [...(json.extensionsRequired || []), ...(json.extensionsUsed || [])];
  return exts.includes("KHR_draco_mesh_compression");
}

describe("glb-parser", () => {
  test("isGLB identifies a GLB v2 file", () => {
    expect(isGLB(readArrayBuffer(HOWDY_PATH))).toBe(true);
    expect(isGLB(readArrayBuffer(TRIANGLE_PATH))).toBe(true);
  });

  test("isGLB rejects non-GLB data", () => {
    const buffer = new ArrayBuffer(20);
    expect(isGLB(buffer)).toBe(false);
  });

  test.each([
    ["howdy.glb", HOWDY_PATH, true],
    ["triangle.glb", TRIANGLE_PATH, false],
  ])("parseGLB extracts JSON and binary chunk from %s", async (_name, path, expectDraco) => {
    const buffer = readArrayBuffer(path);
    const { json, binaryChunk } = await parseGLB(buffer);

    expect(json).toBeDefined();
    expect(json.asset).toBeDefined();
    expect(json.asset.version).toBe("2.0");
    expect(json.nodes).toBeInstanceOf(Array);
    expect(json.buffers).toBeInstanceOf(Array);
    expect(hasDraco(json)).toBe(expectDraco);
    expect(binaryChunk).toBeInstanceOf(ArrayBuffer);
    expect(binaryChunk.byteLength).toBeGreaterThan(0);
  });

  test("serializeGLB produces a valid GLB container", async () => {
    const buffer = readArrayBuffer(TRIANGLE_PATH);
    const { json } = await parseGLB(buffer);
    const serialized = await serializeGLB(json, null);
    const outView = new DataView(serialized);
    expect(outView.getUint32(0, true)).toBe(0x46546c67); // glTF magic
    expect(outView.getUint32(4, true)).toBe(2); // version
    expect(outView.getUint32(8, true)).toBe(serialized.byteLength); // length matches
  });

  test.each([
    ["howdy.glb", HOWDY_PATH],
    ["triangle.glb", TRIANGLE_PATH],
  ])("round-trip preserves total byte length for %s", async (_name, path) => {
    const buffer = readArrayBuffer(path);
    const { json, binaryChunk } = await parseGLB(buffer);

    const serialized = await serializeGLB(json, binaryChunk);

    // Total length should match the original file. Small differences in JSON
    // whitespace are absorbed by 4-byte chunk padding, so the container length
    // is the most stable invariant.
    expect(serialized.byteLength).toBe(buffer.byteLength);

    // Re-parse the serialized bytes to confirm it is still a valid GLB.
    const reparsed = await parseGLB(serialized);
    expect(reparsed.json.asset.version).toBe("2.0");
    expect(reparsed.json.nodes.length).toBe(json.nodes.length);
  });

  test("triangle.glb round-trip is byte-identical via custom serializer", async () => {
    const buffer = readArrayBuffer(TRIANGLE_PATH);
    const { json, binaryChunk } = await parseGLB(buffer);
    const serialized = await serializeGLB(json, binaryChunk);

    const a = new Uint8Array(buffer);
    const b = new Uint8Array(serialized);
    expect(b.byteLength).toBe(a.byteLength);

    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs++;
    }
    expect(diffs).toBe(0);
  });

  test("decomposeGLB uploads buffers and images to mock writer", async () => {
    const buffer = readArrayBuffer(HOWDY_PATH);
    let counter = 0;
    const writer = async (data, filename) => {
      counter++;
      return `QmMock${counter}`;
    };

    const { composite, compositeCid } = await decomposeGLB(buffer, writer);

    expect(composite).toBeDefined();
    expect(composite.buffers).toBeInstanceOf(Array);
    expect(composite.images).toBeInstanceOf(Array);
    expect(composite.buffers[0].uri).toMatch(/^ipfs:\/\//);
    expect(compositeCid).toMatch(/^QmMock/);
  });
});

/**
 * ParsedExample → glTF 2.0 JSON converter (pure).
 *
 * This is the render-side bridge: asset-core never talks to Babylon, so any
 * format Babylon can't import natively must convert to a self-contained glTF
 * (single base64 data-URI buffer) that any loader consumes — exactly what
 * 3mf/to-gltf.ts does. The glTF is produced in memory for rendering only and
 * is never persisted; the composite example form is the stored truth.
 *
 * A real format would convert its parsed meshes/materials here; this dummy
 * always emits a single unit triangle so the pipeline is fully exercised.
 */

import { arrayBufferToBase64 } from "../../utils/encoding.ts";
import type { ParsedExample } from "./format.ts";

const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const INDICES = new Uint32Array([0, 1, 2]);

/**
 * @param parsed - result of parseExample()
 * @returns a self-contained glTF 2.0 JSON document
 */
export function parsedExampleToGltf(parsed: ParsedExample): object {
  const buffer = new ArrayBuffer(POSITIONS.byteLength + INDICES.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(new Uint8Array(POSITIONS.buffer), 0);
  bytes.set(new Uint8Array(INDICES.buffer), POSITIONS.byteLength);

  const name = parsed.name || "example";
  return {
    asset: { version: "2.0", generator: "arbesk-example" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      { name, primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5125, count: 3, type: "SCALAR" }, // UNSIGNED_INT
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: POSITIONS.byteLength },
      {
        buffer: 0,
        byteOffset: POSITIONS.byteLength,
        byteLength: INDICES.byteLength,
      },
    ],
    buffers: [
      {
        byteLength: buffer.byteLength,
        uri: `data:application/octet-stream;base64,${arrayBufferToBase64(buffer)}`,
      },
    ],
  };
}

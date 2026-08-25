/**
 * Pure parser for the raw `.example` form — no IPFS, browser, or Babylon
 * dependencies. Mirrors the role of 3mf/parser.ts (and gltf/glb-parser.ts):
 * turn raw bytes into a neutral structure the rest of the pipeline consumes.
 *
 * A real format would parse its actual mesh/material data here; this dummy
 * only splits the header line from an opaque payload.
 */

import { EXAMPLE_MAGIC } from "./format.ts";
import type { ParsedExample } from "./format.ts";

/**
 * Parse raw `.example` bytes into a neutral structure.
 *
 * @param bytes - raw format bytes
 * @throws {Error} when the magic header is missing
 */
export function parseExample(bytes: Uint8Array): ParsedExample {
  // Locate the first newline byte (0x0A) that ends the header line.
  let newline = -1;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      newline = i;
      break;
    }
  }

  const header = new TextDecoder().decode(
    newline >= 0 ? bytes.subarray(0, newline) : bytes
  );
  if (!header.startsWith(`${EXAMPLE_MAGIC} `)) {
    throw new Error("[EXAMPLE] parseExample: missing magic header");
  }

  const name = header.slice(EXAMPLE_MAGIC.length + 1).trim() || "untitled";
  // `slice` copies, so the payload stays stable regardless of the input buffer.
  const payload = newline >= 0 ? bytes.slice(newline + 1) : new Uint8Array(0);
  return { name, payload };
}

/**
 * Serialize a parsed structure back to raw `.example` bytes. Round-trips
 * exactly with parseExample for any (binary-safe) payload.
 */
export function serializeExample(parsed: ParsedExample): Uint8Array {
  const header = new TextEncoder().encode(`${EXAMPLE_MAGIC} ${parsed.name}\n`);
  const out = new Uint8Array(header.length + parsed.payload.length);
  out.set(header, 0);
  out.set(parsed.payload, header.length);
  return out;
}

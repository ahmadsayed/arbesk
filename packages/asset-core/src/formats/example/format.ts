/**
 * "example" — a minimal dummy format that exists purely as a reference for
 * adding a real format (OBJ, STL, FBX, USDZ…) to asset-core.
 *
 * START HERE. This file owns the canonical constants, types, and predicates.
 * It is PURE: no IPFS, no browser globals, no Babylon. All I/O lives in
 * composer.ts (reads via the injected IpfsReadPort) and decomposer.ts (writes
 * via the injected IpfsWritePort + uploadWithDedup) — the exact split every
 * real format in this package should follow (see gltf/ and 3mf/).
 *
 * Raw on-disk form (extension `.example`):
 *   line 1:  "ARBESK-EXAMPLE <name>\n"   (UTF-8 header)
 *   line 2+: opaque payload bytes        (text or binary, preserved verbatim)
 *
 * Stored form (composite JSON): the payload is content-addressed to IPFS as a
 * single binary part; the name and part metadata are kept inline. This is the
 * same "small metadata inline, blobs by CID" split glTF and 3MF use, and it is
 * what lets repeated saves deduplicate unchanged bytes.
 */

export const EXAMPLE_FORMAT = "example";
export const EXAMPLE_EXTENSION = ".example";
export const COMPOSITE_EXAMPLE_PATH = "composite.example.json";
/** Value of the `arbesk_format` field on a composite example document. */
export const COMPOSITE_EXAMPLE_MARKER = "composite-example";
export const EXAMPLE_MAGIC = "ARBESK-EXAMPLE";

/** Neutral in-memory representation produced by parser.ts. */
export interface ParsedExample {
  name: string;
  payload: Uint8Array;
}

/** Composite stored form (arbesk_format: "composite-example"). */
export interface CompositeExample {
  arbesk_format: string;
  name: string;
  payload: { cid: string; length: number; _arbesk?: unknown };
}

/** True when `json` is a composite example document. */
export function isCompositeExample(json: any): boolean {
  return json?.arbesk_format === COMPOSITE_EXAMPLE_MARKER;
}

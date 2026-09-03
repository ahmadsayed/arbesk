/**
 * A minimal dummy format used purely as a reference for adding a real format
 * (OBJ, STL, FBX, USDZ…) to asset-core.
 *
 * @remarks This file owns the canonical constants, types, and predicates and
 *   is pure (no IPFS, browser globals, or Babylon); all I/O lives in
 *   composer.ts/decomposer.ts, the split every real format should follow.
 *
 *   Raw on-disk form: line 1 is an "ARBESK-EXAMPLE <name>" header; the rest
 *   is opaque payload bytes. Stored form: the payload is content-addressed to
 *   IPFS as one binary part, with name and part metadata inline, so repeated
 *   saves deduplicate unchanged bytes.
 */

export const EXAMPLE_FORMAT = "example";
export const EXAMPLE_EXTENSION = ".example";
export const COMPOSITE_EXAMPLE_PATH = "composite.example.json";
/** Value of the `arbesk_format` field on a composite example document. */
export const COMPOSITE_EXAMPLE_MARKER = "composite-example";
export const EXAMPLE_MAGIC = "ARBESK-EXAMPLE";

/** Neutral in-memory representation. */
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

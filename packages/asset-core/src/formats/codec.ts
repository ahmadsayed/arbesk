/**
 * FormatCodec — the per-format contract shared by every asset format.
 *
 * Every format exposes the same two operations, named without a format
 * suffix:
 *
 *   - `compose`   : restore the native/renderable artifact as bytes.
 *   - `decompose` : split a raw artifact into a content-addressed composite.
 *
 * The dispatcher (formats/index.ts) picks the codec by format (explicit
 * hint, magic-byte sniff, or the `arbesk_format` stored-form marker), so
 * callers only ever invoke `compose`/`decompose` — never a format-named
 * function.
 */

import type { UploadCredential } from "../storage/ipfs/upload-with-credential.ts";

/** Result of decomposing a raw artifact into its content-addressed form. */
export interface DecomposeResult {
  /** The stored-form (composite) document. */
  composite: Record<string, unknown>;
  /** CID of the persisted composite JSON; absent when `store: false`. */
  compositeCid?: string;
}

/** Options accepted by every format's `compose`. */
export interface ComposeOptions {
  /** Optional format hint to skip detection ("gltf", "3mf", "example"). */
  format?: string;
  /** Reserved for future formats; the built-in codecs need nothing. */
  [key: string]: unknown;
}

/** Options accepted by every format's `decompose`. */
export interface DecomposeOptions {
  /** Optional format hint to skip detection ("gltf", "glb", "3mf", "example"). */
  format?: string;
  /** Reusable upload credential (absent → default runtime write path). */
  credential?: UploadCredential | null;
  /** Gzip-compress components before upload. */
  compress?: boolean;
  /** Asset name for IPFS filenames. */
  assetName?: string;
  /** Asset ID for IPFS filenames. */
  assetId?: string;
  /** Existing hash → CID map for component dedup. */
  dedupMap?: Map<string, string> | null;
  /** Persist the composite JSON and return its CID (default true). */
  store?: boolean;
}

/**
 * The per-format contract. `compose` and `decompose` are the only two
 * operations callers need to know; the format is selected by the dispatcher.
 */
export interface FormatCodec {
  /** Canonical lowercase format name ("gltf", "glb", "3mf", "example"). */
  format: string;
  /** File extensions for this format. */
  extensions: string[];
  /** Detect this format from raw bytes (magic sniff). */
  sniff?(bytes: Uint8Array): boolean;
  /** True when `data` is already this format's stored (composite) form. */
  isStoredForm?(data: unknown): boolean;
  /** Restore the native artifact as bytes. Omitted for source-only formats (GLB). */
  compose?(composite: unknown, opts?: ComposeOptions): Promise<Uint8Array>;
  /** Decompose a raw artifact (bytes or a parsed document) into a composite. */
  decompose(input: unknown, opts?: DecomposeOptions): Promise<DecomposeResult>;
}

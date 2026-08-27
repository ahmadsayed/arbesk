/**
 * Decomposer for the example format: raw `.example` bytes → content-addressed
 * composite JSON, written through the injected IpfsWritePort — never reaching
 * into the frontend/backend trees. Mirrors 3mf/decomposer.ts and
 * gltf/decomposer.ts.
 *
 * Decomposition strategy (the canonical pattern):
 *   - the (possibly large) payload → stored on IPFS as a binary part via
 *     uploadWithDedup (hash → CID reuse across saves)
 *   - small metadata (name, part CID + length, dedup meta) → kept inline
 *   - the whole thing → ipfsWrite.writeJSON as the composite stored form
 */

import { getRuntime } from "../../runtime.ts";
import { uploadWithDedup } from "../../formats/gltf/dedup.ts";
import { sanitizeFileName } from "../../utils/uri.ts";
import type { UploadCredential } from "../../storage/ipfs/upload-with-credential.ts";
import { parseExample } from "./parser.ts";
import {
  COMPOSITE_EXAMPLE_MARKER,
  COMPOSITE_EXAMPLE_PATH,
} from "./format.ts";

export interface DecomposeExampleOptions {
  assetName?: string;
  assetId?: string;
  dedupMap?: Map<string, string> | null;
  credential?: UploadCredential | null;
}

/**
 * Decompose raw `.example` bytes into a composite stored on IPFS.
 *
 * @param bytes - raw `.example` bytes
 */
export async function decompose(
  bytes: Uint8Array,
  options: DecomposeExampleOptions = {}
): Promise<{ compositeCid: string; composite: object }> {
  const { assetName, assetId, dedupMap = null, credential = null } = options;
  const parsed = parseExample(bytes);

  const base = sanitizeFileName(
    assetName || assetId || parsed.name || "example"
  );
  const { cid: payloadCid, meta } = await uploadWithDedup(
    parsed.payload,
    `${base}_payload.bin`,
    credential ?? undefined,
    { compress: false },
    dedupMap ?? undefined
  );

  const composite = {
    arbesk_format: COMPOSITE_EXAMPLE_MARKER,
    name: parsed.name,
    payload: { cid: payloadCid, length: parsed.payload.length, _arbesk: meta },
  };

  const { ipfsWrite } = getRuntime();
  const compositeCid = await ipfsWrite.writeJSON(composite, credential, {
    assetId,
    filename: `${base}_${COMPOSITE_EXAMPLE_PATH}`,
  });
  return { compositeCid, composite };
}

/**
 * Composer for the example format: composite JSON → raw `.example` bytes,
 * reading the payload part through the injected IpfsReadPort. Mirrors
 * 3mf/composer.ts and gltf/composer.ts.
 *
 * Reads use ipfsRead.getBytes (auto-gunzip): a part CID shared via the
 * cross-format dedup map may hold a gzipped payload; plain bytes pass through
 * unchanged.
 */

import { getRuntime } from "../../runtime.ts";
import { isCompositeExample } from "./format.ts";
import type { CompositeExample } from "./format.ts";
import { serializeExample } from "./parser.ts";

/**
 * Rebuild raw `.example` bytes from a composite example document.
 *
 * @param composite - composite example JSON (arbesk_format: "composite-example")
 */
export async function composeExample(
  composite: CompositeExample
): Promise<Uint8Array> {
  if (!isCompositeExample(composite)) {
    throw new Error("[EXAMPLE] composeExample: not a composite example document");
  }
  const payloadCid = composite.payload?.cid;
  if (!payloadCid || typeof composite.name !== "string") {
    throw new Error("[EXAMPLE] composeExample: composite missing payload.cid or name");
  }

  const { ipfsRead } = getRuntime();
  const buffer = await ipfsRead.getBytes(payloadCid);
  return serializeExample({ name: composite.name, payload: new Uint8Array(buffer) });
}

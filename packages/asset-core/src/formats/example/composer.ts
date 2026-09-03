/**
 * Composes the example format: composite JSON → raw `.example` bytes.
 * @remarks Reads auto-gunzip (ipfsRead.getBytes): a part CID shared via the
 *   cross-format dedup map may hold a gzipped payload; plain bytes pass
 *   through unchanged.
 */

import { getRuntime } from "../../runtime.ts";
import { isCompositeExample } from "./format.ts";
import type { CompositeExample } from "./format.ts";
import { serializeExample } from "./parser.ts";

/**
 * Rebuilds raw `.example` bytes from a composite example document.
 */
export async function compose(
  composite: CompositeExample
): Promise<Uint8Array> {
  if (!isCompositeExample(composite)) {
    throw new Error("[EXAMPLE] compose: not a composite example document");
  }
  const payloadCid = composite.payload?.cid;
  if (!payloadCid || typeof composite.name !== "string") {
    throw new Error("[EXAMPLE] compose: composite missing payload.cid or name");
  }

  const { ipfsRead } = getRuntime();
  const buffer = await ipfsRead.getBytes(payloadCid);
  return serializeExample({ name: composite.name, payload: new Uint8Array(buffer) });
}

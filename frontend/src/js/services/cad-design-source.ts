/**
 * Reads a CAD version's design document back out of its stored model.
 * @remarks A fresh generation stores the raw .3mf (design sidecar inside the
 *   zip); a saved version stores a composite-3mf JSON whose parts are
 *   content-addressed, the sidecar among them. Both are handled. Lazy-imports
 *   @arbesk/cad-gen so the main bundle only pays for it on an edit.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { getArrayBufferFromRemoteIPFS, getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";

const COMPOSITE_3MF_FORMAT = "composite-3mf";

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function designFromComposite(json: any, sidecarPath: string): Promise<CadDesign | null> {
  if (json?.arbesk_format !== COMPOSITE_3MF_FORMAT) return null;
  const partCid = json.parts?.[sidecarPath]?.cid;
  if (!partCid) return null;
  const { parseEmbeddedDesign } = await import("@arbesk/cad-gen");
  return parseEmbeddedDesign(await getFromRemoteIPFS(partCid));
}

/**
 * Resolves the design embedded in a CAD version's source model.
 * @returns the design, or null when it cannot be fetched or carries none.
 */
export async function resolveCadDesign(sourceCid: string): Promise<CadDesign | null> {
  try {
    const bytes = new Uint8Array(await getArrayBufferFromRemoteIPFS(sourceCid));
    const { readDesignFrom3mf, SIDECAR_PART_PATH } = await import("@arbesk/cad-gen");
    return readDesignFrom3mf(bytes) ?? (await designFromComposite(parseJson(bytes), SIDECAR_PART_PATH));
  } catch {
    return null;
  }
}

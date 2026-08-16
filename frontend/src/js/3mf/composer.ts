/**
 * 3MF composer.
 *
 * Rebuilds a raw .3mf OPC package from a composite 3MF JSON: XML parts are
 * carried verbatim and binary parts are fetched back from IPFS by CID.
 * Entry paths are unchanged from the original package, so the verbatim
 * .rels parts stay valid — round-tripping preserves content exactly.
 */

import { getArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { zipBytes, strToU8 } from "./zip.ts";
import { isComposite3mf, relsPathFor } from "./decomposer.ts";

const CONTENT_TYPES_PATH = "[Content_Types].xml";
const ROOT_RELS_PATH = "_rels/.rels";

/**
 * Composite 3MF JSON (arbesk_format: composite-3mf): small XML parts carried
 * verbatim, binary parts referenced by IPFS CID.
 */
export interface Composite3mf {
  arbesk_format: string;
  modelPath?: string;
  contentTypes: string;
  rootRels: string;
  modelRels?: string | null;
  model: string;
  parts?: Record<string, { cid: string }>;
}

/**
 * Compose a composite 3MF JSON back into raw .3mf ZIP bytes.
 *
 * @param composite - composite 3MF JSON (arbesk_format: composite-3mf)
 */
export async function compose3mf(composite: Composite3mf): Promise<Uint8Array> {
  if (!isComposite3mf(composite)) {
    throw new Error("[3MF] compose3mf: not a composite 3MF document");
  }
  for (const field of ["contentTypes", "rootRels", "model"]) {
    if (typeof (composite as unknown as Record<string, unknown>)[field] !== "string") {
      throw new Error(`[3MF] compose3mf: composite missing ${field}`);
    }
  }
  const modelPath = composite.modelPath || "3D/3dmodel.model";
  const files: Record<string, Uint8Array> = {
    [CONTENT_TYPES_PATH]: strToU8(composite.contentTypes),
    [ROOT_RELS_PATH]: strToU8(composite.rootRels),
    [modelPath]: strToU8(composite.model),
  };
  if (composite.modelRels) {
    files[relsPathFor(modelPath)] = strToU8(composite.modelRels);
  }
  for (const [entryPath, ref] of Object.entries(composite.parts || {})) {
    // Use the gzip-sniffing reader: a CID shared via the cross-format dedup
    // map may hold a gzipped payload (the glTF pipeline uploads components
    // compressed). Plain bytes pass through unchanged.
    const buffer = await getArrayBufferFromRemoteIPFS(ref.cid);
    files[entryPath] = new Uint8Array(buffer);
    console.log(`[3MF-COMPOSE] part ${entryPath} ← ipfs://${ref.cid}`);
  }
  return zipBytes(files);
}

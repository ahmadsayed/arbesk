// @ts-nocheck — TODO: add JSDoc typedefs and drop this header
/**
 * 3MF decomposer.
 *
 * Extracts a raw .3mf OPC package into individually content-addressed parts
 * on IPFS and writes a "composite 3MF" JSON that carries the small XML parts
 * verbatim and references binary parts (textures, package thumbnails) by CID.
 * The composite JSON is the native stored form of a 3MF asset in Arbesk —
 * it is never converted to glTF for storage.
 */

import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { uploadWithDedup } from "../gltf/dedup.js";
import { sanitizeFileName } from "../utils/uri.js";
import { unzipBytes, strFromU8 } from "./zip.js";

export const COMPOSITE_3MF_FORMAT = "composite-3mf";
export const COMPOSITE_3MF_PATH = "composite.3mf.json";

const CONTENT_TYPES_PATH = "[Content_Types].xml";
const ROOT_RELS_PATH = "_rels/.rels";

export function isComposite3mf(json) {
  return json?.arbesk_format === COMPOSITE_3MF_FORMAT;
}

/** Path of the .rels part belonging to a package part, per OPC rules. */
export function relsPathFor(partPath) {
  const slash = partPath.lastIndexOf("/");
  const dir = slash >= 0 ? partPath.slice(0, slash) : "";
  const base = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return `${dir}/_rels/${base}.rels`;
}

/**
 * Decompose a raw .3mf package into a composite 3MF stored on IPFS.
 *
 * @param {Uint8Array} bytes - raw .3mf ZIP bytes
 * @param {object} [options]
 * @param {string} [options.assetName]
 * @param {string} [options.assetId]
 * @param {Map<string,string>} [options.dedupMap]
 * @param {object} [options.credential]
 * @returns {Promise<{compositeCid: string, composite: object}>}
 */
export async function decompose3mf(bytes, options = {}) {
  const { assetName, assetId, dedupMap = null, credential = null } = options;
  const entries = unzipBytes(bytes);

  const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
  if (!modelPath) throw new Error("[3MF] package has no .model part");
  if (!entries[CONTENT_TYPES_PATH]) {
    throw new Error("[3MF] package is missing [Content_Types].xml");
  }
  if (!entries[ROOT_RELS_PATH]) {
    throw new Error("[3MF] package is missing _rels/.rels");
  }

  // Every entry that is not core XML goes to IPFS as a binary part.
  const modelRelsPath = relsPathFor(modelPath);
  const parts = {};
  for (const [entryPath, entryBytes] of Object.entries(entries)) {
    if (
      entryPath === CONTENT_TYPES_PATH ||
      entryPath === ROOT_RELS_PATH ||
      entryPath === modelPath ||
      entryPath === modelRelsPath
    ) {
      continue;
    }
    const filename = entryPath.slice(entryPath.lastIndexOf("/") + 1);
    const { cid, meta } = await uploadWithDedup(
      entryBytes,
      `${sanitizeFileName(assetName || assetId || "3mf")}_${filename}`,
      credential,
      { compress: false },
      dedupMap
    );
    parts[entryPath] = { cid, _arbesk: meta };
    console.log(`[3MF-DECOMPOSE] part ${entryPath} → ipfs://${cid}`);
  }

  const composite = {
    arbesk_format: COMPOSITE_3MF_FORMAT,
    modelPath,
    contentTypes: strFromU8(entries[CONTENT_TYPES_PATH]),
    rootRels: strFromU8(entries[ROOT_RELS_PATH]),
    modelRels: entries[modelRelsPath]
      ? strFromU8(entries[modelRelsPath])
      : null,
    model: strFromU8(entries[modelPath]),
    parts,
  };

  const compositeCid = await writeJSONToIPFS(composite, credential, {
    assetId,
    filename: `${sanitizeFileName(
      assetName || assetId || "composite"
    )}_composite.3mf.json`,
  });
  console.log(`[3MF-DECOMPOSE] composite → ${compositeCid}`);
  return { compositeCid, composite };
}

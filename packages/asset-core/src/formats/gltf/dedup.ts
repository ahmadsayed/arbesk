/**
 * Component-level deduplication helpers for glTF decomposition.
 * @remarks The composite glTF stores an `_arbesk` block (hash + CID) on each
 *   buffer/image entry; a subsequent save that hashes to the same value
 *   reuses the CID and skips the upload.
 */

import {
  hashBytes,
  DEFAULT_HASH_ALGORITHM,
  SUPPORTED_HASH_ALGORITHMS,
} from "../../utils/hash.ts";
import { compress } from "../../utils/compression.ts";
import { getRuntime } from "../../runtime-state.ts";
import {
  IPFS_URI_PREFIX,
  cidFromIpfsUri,
  ipfsUriFromCid,
  attachDedupMeta,
  stripDedupMeta,
} from "./gltf-core.ts";
import type { UploadCredential } from "../../storage/ipfs/upload-with-credential.ts";

// The pure helpers live in gltf-core.js (shared with the glTF worker);
// re-exported here so existing import sites keep working.
export { cidFromIpfsUri, ipfsUriFromCid, attachDedupMeta, stripDedupMeta };

const HASH_ALGORITHM = DEFAULT_HASH_ALGORITHM;

export interface DedupMeta {
  hash: string;
  hashAlgo: string;
  compressed: boolean;
  bytes: number;
}

export interface DedupUploadResult {
  cid: string;
  meta: DedupMeta;
  skipped: boolean;
}

// Coalesce concurrent uploads of identical payloads so two parallel callers
// that hash to the same value share one in-flight ipfsWrite.write promise
// instead of uploading the same bytes twice.
const _inflightUploads = new Map<string, Promise<DedupUploadResult>>();

/**
 * Extract the dedup hash → CID pair from a composite buffer/image entry,
 * or null when the entry carries no usable IPFS reference.
 */
function dedupEntryFromItem(item: any): { hash: string; cid: string } | null {
  const meta = item?._arbesk;
  // Accept any supported algorithm so composites written with the older
  // murmur3-32 key still contribute to the dedup map after the migration.
  if (!meta?.hash || !SUPPORTED_HASH_ALGORITHMS.has(meta.hashAlgo)) return null;
  const uri = item?.uri;
  if (!uri?.startsWith(IPFS_URI_PREFIX)) return null;
  const cid = uri.slice(IPFS_URI_PREFIX.length);
  return cid ? { hash: meta.hash, cid } : null;
}

/**
 * Builds a hash → CID map from one or more composite glTF JSONs.
 * @param composites - Composite glTF JSON or array of them (dynamic schema)
 */
export function buildDedupMap(composites: any): Map<string, string> {
  const map = new Map<string, string>();
  const list = Array.isArray(composites) ? composites : [composites];
  for (const composite of list) {
    for (const item of [
      ...(composite?.buffers || []),
      ...(composite?.images || []),
    ]) {
      const entry = dedupEntryFromItem(item);
      if (entry && !map.has(entry.hash)) {
        map.set(entry.hash, entry.cid);
      }
    }
  }
  return map;
}

/**
 * Hashes the upload payload and either reuses an existing CID from the dedup
 * map or uploads the bytes to IPFS.
 * @remarks When a hash matches the dedup map, the upload is skipped and the
 *   previously returned CID is reused.
 */
export async function uploadWithDedup(
  bytes: Uint8Array,
  filename: string,
  credential: UploadCredential | null = null,
  options: { compress?: boolean } = {},
  dedupMap: Map<string, string> | null = null
): Promise<DedupUploadResult> {
  const shouldCompress = !!options.compress;
  const payload = shouldCompress ? compress(bytes) : bytes;
  const finalFilename = shouldCompress ? `${filename}.gz` : filename;
  // Hash over the RAW (uncompressed) content, not the stored payload. The
  // worker path compresses with the native CompressionStream while this
  // main-thread path uses fflate; the two emit slightly different gzip bytes for
  // the same input. Keying dedup and the content cache on the raw content lets
  // their hash maps interoperate (see test/frontend/dedup-hash-parity.test.js).
  const hash = hashBytes(bytes);
  const meta = {
    hash,
    hashAlgo: HASH_ALGORITHM,
    compressed: shouldCompress,
    bytes: bytes.length,
  };

  if (dedupMap?.has(hash)) {
    const cid = dedupMap.get(hash) as string;
    return { cid, meta, skipped: true };
  }

  // Coalesce concurrent identical uploads. Key on hash + compression so two
  // callers that disagree on the stored encoding don't share a result carrying
  // the wrong `compressed` flag.
  const inflightKey = `${hash}:${shouldCompress ? 1 : 0}`;
  const existing = _inflightUploads.get(inflightKey);
  if (existing) {
    return existing;
  }

  const uploadPromise = (async () => {
    try {
      const cid = await getRuntime().ipfsWrite.write(payload, finalFilename, credential, {
        compress: false,
      });
      return { cid, meta, skipped: false };
    } finally {
      _inflightUploads.delete(inflightKey);
    }
  })();

  _inflightUploads.set(inflightKey, uploadPromise);
  return uploadPromise;
}

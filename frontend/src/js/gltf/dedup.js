// @ts-nocheck
/**
 * Component-level deduplication helpers for glTF decomposition.
 *
 * The composite glTF stores a small `_arbesk` block on each buffer/image
 * entry with the hash of the bytes that were uploaded and the CID they
 * received. On a subsequent save, if a new component hashes to the same
 * value, the existing CID is reused and the upload is skipped.
 */

import {
  hashBytes,
  DEFAULT_HASH_ALGORITHM,
  SUPPORTED_HASH_ALGORITHMS,
} from "../utils/hash.js";
import { compress } from "../utils/compression.js";
import { writeToIPFS } from "../ipfs/write-to-ipfs.js";

const HASH_ALGORITHM = DEFAULT_HASH_ALGORITHM;
const IPFS_URI_PREFIX = "ipfs://";

// Coalesce concurrent uploads of identical payloads so two parallel callers
// that hash to the same value share one in-flight writeToIPFS promise instead
// of uploading the same bytes twice.
const _inflightUploads = new Map();

/**
 * Build a hash → CID map from one or more composite glTF JSONs.
 *
 * @param {object|object[]} composites
 * @returns {Map<string, string>}
 */
export function buildDedupMap(composites) {
  const map = new Map();
  const list = Array.isArray(composites) ? composites : [composites];
  for (const composite of list) {
    if (!composite) continue;
    for (const item of [
      ...(composite.buffers || []),
      ...(composite.images || []),
    ]) {
      const meta = item?._arbesk;
      // Accept any supported algorithm so composites written with the older
      // murmur3-32 key still contribute to the dedup map after the migration.
      if (
        !meta?.hash ||
        !SUPPORTED_HASH_ALGORITHMS.has(meta.hashAlgo) ||
        !item.uri
      )
        continue;
      if (!item.uri.startsWith(IPFS_URI_PREFIX)) continue;
      const cid = item.uri.slice(IPFS_URI_PREFIX.length);
      if (cid && !map.has(meta.hash)) {
        map.set(meta.hash, cid);
      }
    }
  }
  return map;
}

/**
 * Hash the upload payload for a byte array and either reuse an existing CID
 * from the dedup map or upload the bytes to IPFS.
 *
 * The hash is computed over the exact bytes that will be stored (gzipped if
 * `options.compress` is true). When a match is found, the upload is skipped
 * and the previously returned CID is reused.
 *
 * @param {Uint8Array} bytes - Raw component bytes
 * @param {string} filename - Base filename for IPFS storage
 * @param {object} [credential=null] - Reusable upload credential
 * @param {object} [options={}] - Upload options
 * @param {boolean} [options.compress=false] - Gzip before upload/hash
 * @param {Map<string,string>} [dedupMap=null] - Existing hash → CID map
 * @returns {Promise<{cid: string, meta: object, skipped: boolean}>}
 */
export async function uploadWithDedup(
  bytes,
  filename,
  credential = null,
  options = {},
  dedupMap = null
) {
  const shouldCompress = !!options.compress;
  const payload = shouldCompress ? compress(bytes) : bytes;
  const finalFilename = shouldCompress ? `${filename}.gz` : filename;
  // Hash over the RAW (uncompressed) content, not the stored payload. The
  // worker path compresses with the native CompressionStream while this
  // main-thread path uses pako; the two emit slightly different gzip bytes for
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
    const cid = dedupMap.get(hash);
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
      const cid = await writeToIPFS(payload, finalFilename, credential, {
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

/**
 * Attach Arbesk dedup metadata to a glTF buffer or image entry.
 *
 * @param {object} item
 * @param {object} meta
 * @returns {object}
 */
export function attachDedupMeta(item, meta) {
  return { ...item, _arbesk: meta };
}

/**
 * Remove Arbesk dedup metadata from all buffers/images in a composite glTF.
 *
 * This produces a clean glTF JSON suitable for Babylon.js or serialization.
 *
 * @param {object} composite
 * @returns {object}
 */
export function stripDedupMeta(composite) {
  const cleaned = JSON.parse(JSON.stringify(composite));
  for (const item of [
    ...(cleaned.buffers || []),
    ...(cleaned.images || []),
  ]) {
    delete item._arbesk;
  }
  return cleaned;
}

/**
 * Convert an ipfs:// URI to a bare CID string.
 *
 * @param {string} uri
 * @returns {string|null}
 */
export function cidFromIpfsUri(uri) {
  if (!uri || !uri.startsWith(IPFS_URI_PREFIX)) return null;
  return uri.slice(IPFS_URI_PREFIX.length);
}

/**
 * Convert a bare CID string to an ipfs:// URI.
 *
 * @param {string} cid
 * @returns {string}
 */
export function ipfsUriFromCid(cid) {
  return IPFS_URI_PREFIX + cid;
}

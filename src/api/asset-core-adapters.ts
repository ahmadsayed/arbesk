/**
 * Backend asset-core adapters — map the asset-core IpfsReadPort/IpfsWritePort
 * onto the existing storage adapter (src/api/storage/, kubo or pinata via
 * IPFS_BACKEND) and expose a ready-to-use ArbeskCore for backend modules.
 *
 * The storage adapter is injected as a parameter — the composition root
 * builds it once (createStorageAdapter) and passes it in, so these ports stay
 * environment-agnostic like everything else in asset-core.
 */
import {
  createArbeskCore,
} from "@arbesk/asset-core/facade.js";
import type { ArbeskCore } from "@arbesk/asset-core/facade.js";
import type {
  IpfsReadPort,
  IpfsWritePort,
} from "@arbesk/asset-core/types.js";
import type { UploadCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";
import {
  compress,
  decompress,
  isGzipped,
} from "@arbesk/asset-core/utils/compression.js";
import type { StorageAdapter } from "./storage/index.ts";

/** Buffer/Uint8Array → standalone ArrayBuffer (no shared-pool aliasing). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/**
 * IpfsReadPort over the backend storage adapter. Mirrors the port contract:
 * getJSON/getBytes auto-gunzip (decomposed components are stored gzipped),
 * getRawBytes returns the exact stored bytes.
 */
function createBackendIpfsReadPort(storage: StorageAdapter): IpfsReadPort {
  return {
    async getJSON(cid) {
      const raw = await storage.catBytes(cid);
      const bytes = isGzipped(raw) ? decompress(raw) : raw;
      return JSON.parse(new TextDecoder().decode(bytes));
    },
    async getBytes(cid) {
      const raw = await storage.catBytes(cid);
      const bytes = isGzipped(raw) ? decompress(raw) : raw;
      return toArrayBuffer(bytes);
    },
    async getRawBytes(cid) {
      return toArrayBuffer(await storage.catBytes(cid));
    },
  };
}

/**
 * IpfsWritePort over the backend storage adapter. Kubo uploads need no
 * credential; the credential argument is accepted for port compatibility and
 * ignored (the backend writes through its own storage adapter, not the
 * browser's signed-URL flow).
 */
function createBackendIpfsWritePort(storage: StorageAdapter): IpfsWritePort {
  const write: IpfsWritePort["write"] = async (
    data,
    filename,
    _credential: UploadCredential | null = null,
    options = {}
  ) => {
    let bytes =
      data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : typeof data === "string"
            ? new TextEncoder().encode(data)
            : new Uint8Array(await (data as Blob).arrayBuffer());
    if (options.compress) bytes = compress(bytes);
    return storage.add(bytes, filename);
  };
  return {
    write,
    writeJSON: (json, credential = null, options = {}) =>
      write(
        JSON.stringify(json),
        options.filename ?? "manifest.json",
        credential,
        options
      ),
  };
}

/**
 * Backend ArbeskCore — IPFS through the storage adapter, inline executor
 * (default), no credentials/chain/hash ports (generation follow-ups only
 * compose; they never upload or touch editor lists).
 */
export function createBackendCore(storage: StorageAdapter): ArbeskCore {
  return createArbeskCore({
    ipfsRead: createBackendIpfsReadPort(storage),
    ipfsWrite: createBackendIpfsWritePort(storage),
  });
}

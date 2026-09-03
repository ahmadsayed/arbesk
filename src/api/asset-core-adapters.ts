/**
 * Backend asset-core adapters: map the asset-core IpfsReadPort/IpfsWritePort
 * onto the storage adapter (kubo or pinata) and expose a ready-to-use
 * ArbeskCore.
 * @remarks The storage adapter is injected so these ports stay
 *   environment-agnostic, like the rest of asset-core.
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
 * IpfsReadPort over the backend storage adapter.
 * @remarks getJSON/getBytes auto-gunzip (decomposed components are stored
 *   gzipped); getRawBytes returns the exact stored bytes.
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
 * IpfsWritePort over the backend storage adapter.
 * @remarks Kubo uploads need no credential; the credential argument is accepted
 *   for port compatibility and ignored.
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
 * Backend ArbeskCore.
 * @remarks IPFS goes through the storage adapter with no credentials/chain/hash
 *   ports — generation follow-ups only compose, never upload or touch editor
 *   lists.
 */
export function createBackendCore(storage: StorageAdapter): ArbeskCore {
  return createArbeskCore({
    ipfsRead: createBackendIpfsReadPort(storage),
    ipfsWrite: createBackendIpfsWritePort(storage),
  });
}

import { create } from "ipfs-http-client";
import { PinataSDK } from "pinata";
import { createKuboAdapter } from "./kubo-adapter.js";
import { createPinataAdapter } from "./pinata-adapter.js";

/**
 * @typedef {Object} StorageAdapter
 * @property {string} backend
 * @property {(payload: string | Uint8Array, filename?: string) => Promise<string>} add
 * @property {(files: {name: string, data: Uint8Array|string}[]) => Promise<string>} addDirectory
 * @property {(cid: string) => Promise<string>} cat
 * @property {(cid: string) => Promise<Buffer>} catBytes
 * @property {(cid: string) => Promise<boolean>} unpin
 * @property {() => Promise<string[]>} listPinned
 * @property {() => Promise<{ backend: string; [key: string]: any }>} mintUploadCredential
 * @property {(count: number) => Promise<{ backend: string; [key: string]: any }[]>} mintUploadCredentials
 * @property {() => string} gatewayBase
 */

/** @type {StorageAdapter | null} */
let _storage = null;

/**
 * Returns the process-wide storage adapter, selected by IPFS_BACKEND.
 * Defaults to "kubo" so the E2E suite and local Docker stack keep working.
 *
 * Env-var selection is used over dependency injection because the backend
 * has exactly two implementations selected at deploy time (never at runtime),
 * making DI indirection unnecessary for this two-implementation scenario.
 */
export function getStorage() {
  if (_storage) return _storage;

  const backend = process.env.IPFS_BACKEND || "kubo";
  if (backend === "pinata") {
    const gateway = process.env.PINATA_GATEWAY;
    const pinata = new PinataSDK({
      pinataJwt: process.env.PINATA_JWT,
      pinataGateway: gateway,
    });
    _storage = createPinataAdapter(pinata, {
      gatewayBase: `https://${gateway}/ipfs/`,
      uploadTtl: Number(process.env.PINATA_UPLOAD_TTL || 60),
      poolSize: Number(process.env.PINATA_POOL_SIZE || 20),
      poolExpiryMarginSeconds: Number(process.env.PINATA_POOL_EXPIRY_MARGIN || 60),
    });
    console.log(`[STORAGE] backend=pinata gateway=${gateway}`);
  } else {
    const apiUrl = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
    const gatewayBase =
      process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080/ipfs/";
    _storage = createKuboAdapter(create(new URL(apiUrl)), {
      apiUrl,
      gatewayBase,
    });
    console.log(`[STORAGE] backend=kubo api=${apiUrl}`);
  }
  return _storage;
}

/** Test helper - clears the cached adapter so IPFS_BACKEND can be re-read. */
export function _resetStorage() {
  _storage = null;
}

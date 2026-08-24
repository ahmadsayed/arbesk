import { create } from "ipfs-http-client";
import { PinataSDK } from "pinata";
import { createKuboAdapter } from "./kubo-adapter.ts";
import { createPinataAdapter } from "./pinata-adapter.ts";

export interface StorageAdapter {
  backend: string;
  add(payload: string | Uint8Array, filename?: string): Promise<string>;
  addDirectory(files: { name: string; data: Uint8Array | string }[]): Promise<string>;
  cat(cid: string): Promise<string>;
  catBytes(cid: string): Promise<Buffer>;
  unpin(cid: string): Promise<boolean>;
  listPinned(): Promise<string[]>;
  mintUploadCredential(): Promise<{ strategy: string; [key: string]: any }>;
  mintUploadCredentials(
    count: number,
  ): Promise<{ strategy: string; [key: string]: any }[]>;
  gatewayBase(): string;
}

/**
 * Build the process storage adapter from environment configuration, selected
 * by IPFS_BACKEND ("kubo" | "pinata"), defaulting to "kubo" so the E2E suite
 * and local Docker stack keep working.
 *
 * This is a pure factory: it constructs and returns an adapter and caches
 * nothing. The composition root (src/index.ts) calls it exactly once at boot
 * and injects the result into the API routes — mirroring how the frontend
 * (`initAssetCoreBrowser`) and the asset-core SDK receive their ports. No
 * module should call this to look up storage on demand.
 */
export function createStorageAdapter(): StorageAdapter {
  const backend = process.env.IPFS_BACKEND || "kubo";
  if (backend === "pinata") {
    const gateway = process.env.PINATA_GATEWAY;
    const pinata = new PinataSDK({
      pinataJwt: process.env.PINATA_JWT,
      pinataGateway: gateway,
    });
    const adapter = createPinataAdapter(pinata, {
      gatewayBase: `https://${gateway}/ipfs/`,
      uploadTtl: Number(process.env.PINATA_UPLOAD_TTL || 60),
      poolSize: Number(process.env.PINATA_POOL_SIZE || 20),
      poolExpiryMarginSeconds: Number(process.env.PINATA_POOL_EXPIRY_MARGIN || 60),
    });
    console.log(`[STORAGE] backend=pinata gateway=${gateway}`);
    return adapter;
  }

  const apiUrl = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
  const gatewayBase =
    process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080/ipfs/";
  const adapter = createKuboAdapter(create(new URL(apiUrl)), {
    apiUrl,
    gatewayBase,
  });
  console.log(`[STORAGE] backend=kubo api=${apiUrl}`);
  return adapter;
}

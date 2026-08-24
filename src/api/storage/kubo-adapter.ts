import { catManifest, catBytes } from "../ipfs-utils.ts";
import type { KuboClient } from "ipfs-http-client";
import type { StorageAdapter } from "./index.ts";

/**
 * Kubo storage adapter - wraps the local ipfs-http-client.
 * Used only by the automated E2E suite (IPFS_BACKEND=kubo).
 */
export function createKuboAdapter(
  ipfs: KuboClient,
  { apiUrl, gatewayBase }: { apiUrl: string; gatewayBase: string },
): StorageAdapter {
  return {
    backend: "kubo",

    async add(payload, filename) {
      const options = { cidVersion: 1, ...(filename ? { filename } : {}) };
      const { cid } = await ipfs.add(payload, options);
      const cidStr = cid.toString();
      try {
        await ipfs.pin.add(cidStr);
        console.log(`[IPFS] pinned → ${cidStr} (${filename || "default name"})`);
      } catch (e) {
        console.warn(`[IPFS] pin failed (non-fatal): ${(e as Error).message}`);
      }
      return cidStr;
    },

    /**
     * Upload multiple files as a single IPFS UnixFS directory and return the
     * directory root CID. Used to group a glTF + its buffers/textures into one
     * browsable folder (organizational only - loading still uses bare CIDs).
     */
    async addDirectory(files) {
      const source = files.map((f) => ({ path: f.name, content: f.data }));
      let rootCid: string | null = null;
      // addAll yields one result per file plus the wrapping directory node
      // (which has an empty path) when wrapWithDirectory is true. Kubo yields
      // the directory root last, so the final result wins.
      for await (const result of ipfs.addAll(source, {
        wrapWithDirectory: true,
        cidVersion: 1,
      })) {
        rootCid = result.cid.toString();
      }
      if (!rootCid) throw new Error("Kubo addDirectory returned no root CID");
      try {
        await ipfs.pin.add(rootCid);
        console.log(`[IPFS] pinned directory → ${rootCid}`);
      } catch (e) {
        console.warn(
          `[IPFS] directory pin failed (non-fatal): ${(e as Error).message}`,
        );
      }
      return rootCid;
    },

    async cat(cid) {
      // Reuse the shared multi-encoding decoder (Uint16Array test mock,
      // Uint8Array/Buffer real Kubo, string) so reads stay consistent.
      return catManifest(ipfs, cid);
    },

    async catBytes(cid) {
      // Raw bytes path for callers that need to decompress gzip content
      // before text decoding corrupts it.
      return catBytes(ipfs, cid);
    },

    async unpin(cid) {
      try {
        await ipfs.pin.rm(cid);
        return true;
      } catch (e) {
        if ((e as Error).message?.includes("not pinned")) return true;
        throw e;
      }
    },

    /**
     * List all pinned CIDs from the local Kubo node.
     */
    async listPinned() {
      const cids: string[] = [];
      for await (const entry of ipfs.pin.ls()) {
        if (entry?.cid) {
          cids.push(entry.cid.toString());
        }
      }
      return cids;
    },

    async mintUploadCredential() {
      return { strategy: "kubo-api", apiUrl, gateway: gatewayBase, reusable: true };
    },

    /**
     * Kubo credentials are already reusable across unlimited uploads, so a
     * batch mint just returns `count` copies of the same credential.
     */
    async mintUploadCredentials(count) {
      const credential = { strategy: "kubo-api", apiUrl, gateway: gatewayBase, reusable: true };
      return Array.from({ length: count }, () => credential);
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}

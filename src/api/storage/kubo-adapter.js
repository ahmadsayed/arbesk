import { catManifest } from "../ipfs-utils.js";

/**
 * Kubo storage adapter — wraps the local ipfs-http-client.
 * Used only by the automated E2E suite (IPFS_BACKEND=kubo).
 */
export function createKuboAdapter(ipfs, { apiUrl, gatewayBase }) {
  return {
    backend: "kubo",

    async add(payload) {
      const { cid } = await ipfs.add(payload);
      const cidStr = cid.toString();
      try {
        await ipfs.pin.add(cidStr);
        console.log(`[IPFS] pinned → ${cidStr}`);
      } catch (e) {
        console.warn(`[IPFS] pin failed (non-fatal): ${e.message}`);
      }
      return cidStr;
    },

    async cat(cid) {
      // Reuse the shared multi-encoding decoder (Uint16Array test mock,
      // Uint8Array/Buffer real Kubo, string) so reads stay consistent.
      return catManifest(ipfs, cid);
    },

    async unpin(cid) {
      try {
        await ipfs.pin.rm(cid);
        return true;
      } catch (e) {
        if (e.message?.includes("not pinned")) return true;
        throw e;
      }
    },

    async mintUploadCredential() {
      return { backend: "kubo", apiUrl, gateway: gatewayBase, reusable: true };
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}

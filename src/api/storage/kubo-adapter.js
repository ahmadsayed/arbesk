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
      let data = "";
      const decoder = new TextDecoder();
      for await (const chunk of ipfs.cat(cid)) {
        data += decoder.decode(chunk, { stream: true });
      }
      data += decoder.decode();
      return data;
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
      return { backend: "kubo", apiUrl };
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}

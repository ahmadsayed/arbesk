/**
 * Pinata storage adapter — Pinata v3 public IPFS.
 * `add` uses the master JWT (backend writes); `mintUploadCredential`
 * returns a short-lived presigned URL for browser uploads (JWT never leaves
 * the server). Public IPFS so CIDs resolve through a normal gateway and can be
 * embedded in on-chain tokenURIs.
 */
export function createPinataAdapter(pinata, { gatewayBase, uploadTtl }) {
  return {
    backend: "pinata",

    async add(payload) {
      const file = new File([payload], "upload.bin");
      const { cid } = await pinata.upload.public.file(file);
      console.log(`[IPFS] pinata add → ${cid}`);
      return cid;
    },

    async cat(cid) {
      const res = await fetch(`${gatewayBase}${cid}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`pinata gateway ${res.status} for ${cid}`);
      return await res.text();
    },

    async unpin(cid) {
      const { files } = await pinata.files.public.list().cid(cid);
      if (!files || files.length === 0) return true;
      await pinata.files.public.delete(files.map((f) => f.id));
      return true;
    },

    async mintUploadCredential() {
      const url = await pinata.upload.public.createSignedURL({
        expires: uploadTtl,
      });
      return { backend: "pinata", url, gateway: gatewayBase, reusable: false };
    },

    gatewayBase() {
      return gatewayBase;
    },
  };
}

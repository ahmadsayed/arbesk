/**
 * Pinata storage adapter - Pinata v3 public IPFS.
 * `add` uses the master JWT (backend writes); `mintUploadCredential`
 * returns a short-lived presigned URL for browser uploads (JWT never leaves
 * the server). Public IPFS so CIDs resolve through a normal gateway and can be
 * embedded in on-chain tokenURIs.
 *
 * @param {import('pinata').PinataSDK} pinata
 * @param {{ gatewayBase: string; uploadTtl: number }} options
 * @returns {import('./index.js').StorageAdapter}
 */
export function createPinataAdapter(pinata, { gatewayBase, uploadTtl }) {
  return {
    backend: "pinata",

    /**
     * @param {string | Uint8Array} payload
     * @param {string} [filename]
     */
    async add(payload, filename) {
      const file = new File(
        [/** @type {import('node:buffer').BlobPart} */ (/** @type {unknown} */ (payload))],
        filename || "upload.bin",
      );
      const { cid } = await pinata.upload.public.file(file);
      console.log(`[IPFS] pinata add → ${cid} (${filename || "upload.bin"})`);
      return cid;
    },

    /**
     * Upload multiple files as a single IPFS directory and return the
     * directory root CID. Used to group a glTF + its buffers/textures into one
     * browsable folder (organizational only - loading still uses bare CIDs).
     * @param {{name: string, data: Uint8Array|string}[]} files
     * @returns {Promise<string>} directory root CID
     */
    async addDirectory(files) {
      const fileObjects = files.map(
        (f) => new File([/** @type {any} */ (f.data)], f.name),
      );
      const { cid } = await pinata.upload.public.fileArray(fileObjects);
      console.log(`[IPFS] pinata addDirectory → ${cid}`);
      return cid;
    },

    /**
     * @param {string} cid
     */
    async cat(cid) {
      const res = await fetch(`${gatewayBase}${cid}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`pinata gateway ${res.status} for ${cid}`);
      return await res.text();
    },

    /**
     * @param {string} cid
     */
    async catBytes(cid) {
      const res = await fetch(`${gatewayBase}${cid}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`pinata gateway ${res.status} for ${cid}`);
      return Buffer.from(await res.arrayBuffer());
    },

    /**
     * @param {string} cid
     */
    async unpin(cid) {
      const { files } = await pinata.files.public.list().cid(cid);
      if (!files || files.length === 0) return true;
      await pinata.files.public.delete(files.map((/** @type {import('pinata').PinataFile} */ f) => f.id));
      return true;
    },

    /**
     * List all pinned CIDs from the public Pinata network.
     * Paginates through the file list API.
     * @returns {Promise<string[]>}
     */
    async listPinned() {
      const cids = [];
      let pageToken = null;
      const limit = 100;
      let pages = 0;
      const maxPages = Number(process.env.PINATA_GC_MAX_PAGES || 1000);

      do {
        let query = pinata.files.public.list().limit(limit);
        if (pageToken) {
          query = query.pageToken(pageToken);
        }
        const { files, next_page_token } = await query;
        for (const f of files || []) {
          if (f?.cid) cids.push(f.cid);
        }
        pageToken = next_page_token;
        pages++;
      } while (pageToken && pages < maxPages);

      return cids;
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

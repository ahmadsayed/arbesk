import { catManifest, catBytes } from "../ipfs-utils.ts";
import type { KuboClient } from "ipfs-http-client";
import type { StorageAdapter } from "./index.ts";

/** A size lookup on a root whose blocks are missing would otherwise hang. */
const PIN_STAT_TIMEOUT_MS = 5000;

/**
 * Kubo storage adapter - wraps the local ipfs-http-client.
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
     * Uploads multiple files as a single IPFS UnixFS directory and returns the
     * directory root CID.
     * @remarks Groups a glTF + its buffers/textures into one browsable folder
     *   (organizational only — loading still uses bare CIDs).
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

    /**
     * @remarks `ipfs cat` with a length limit; stops reading at `length`
     *   bytes, so the IPFS GC can tell a binary from a JSON file cheaply.
     */
    async catHead(cid, length) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of ipfs.cat(cid, { length, timeout: 15000 })) {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : Buffer.from(chunk);
        chunks.push(bytes);
        size += bytes.length;
        if (size >= length) break;
      }
      return Buffer.concat(chunks).subarray(0, length);
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
     * List the root pins (recursive + direct) on the local Kubo node.
     * @remarks Kubo's default `type=all` also yields every indirect block
     *   under a recursive pin - GC would count each as an orphan.
     */
    async listPinned() {
      const pins: { cid: string }[] = [];
      for (const type of ["recursive", "direct"] as const) {
        for await (const entry of ipfs.pin.ls({ type })) {
          if (entry?.cid) {
            pins.push({ cid: entry.cid.toString() });
          }
        }
      }
      return pins;
    },

    /**
     * Size of everything under a pinned root.
     * @remarks Roots that share blocks each count them, so a sum over
     *   several roots is an upper bound on the disk space they hold.
     */
    async pinnedBytes(cid) {
      const stat = await ipfs.files.stat(`/ipfs/${cid}`, { timeout: PIN_STAT_TIMEOUT_MS });
      return Number(stat.cumulativeSize);
    },

    async mintUploadCredential() {
      return { strategy: "kubo-api", apiUrl, gateway: gatewayBase, reusable: true };
    },

    /**
     * @remarks Kubo credentials are reusable across unlimited uploads, so a
     *   batch mint returns `count` copies of the same credential.
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

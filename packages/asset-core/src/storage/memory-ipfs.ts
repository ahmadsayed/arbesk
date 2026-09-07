import type { IpfsReadPort, IpfsWritePort, WriteJsonOptions } from "../types.ts";
import type { UploadCredential } from "./ipfs/upload-with-credential.ts";
import { compressAuto, decompressAuto, bytesFromData } from "../utils/compression.ts";
import type { CompressHint } from "../utils/compression.ts";

let counter = 0;

/**
 * In-memory IPFS double with deterministic fake CIDs.
 * @remarks Honors the compress option so getJSON/getBytes exercise the same
 *   brotli/gunzip paths as production.
 */
export function createMemoryIpfs(): {
  read: IpfsReadPort;
  write: IpfsWritePort;
  dump: () => Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();

  const put = (bytes: Uint8Array): string => {
    const cid = `bafymem${(counter++).toString().padStart(8, "0")}`;
    store.set(cid, bytes);
    return cid;
  };
  const get = (cid: string): Uint8Array => {
    const bytes = store.get(cid);
    if (!bytes) throw new Error(`memory-ipfs: unknown CID ${cid}`);
    return bytes;
  };

  const read: IpfsReadPort = {
    async getJSON(cid) {
      const plain = await decompressAuto(get(cid));
      return JSON.parse(new TextDecoder().decode(plain));
    },
    async getBytes(cid) {
      const plain = await decompressAuto(get(cid));
      return plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer;
    },
    async getRawBytes(cid) {
      const raw = get(cid);
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    },
  };

  const write: IpfsWritePort = {
    async write(data, _filename = "asset.bin", _credential: UploadCredential | null = null, options = {}) {
      const bytes = await bytesFromData(data);
      if (options.compress === false) return put(bytes);
      const codec = options.compress === "gzip" ? "gzip" as const : "brotli" as const;
      return put(await compressAuto(bytes, { codec }));
    },
    async writeJSON(json, _credential = null, options: WriteJsonOptions = {}) {
      const bytes = new TextEncoder().encode(JSON.stringify(json));
      if (options.compress === false) return put(bytes);
      const codec = options.compress === "gzip" ? "gzip" as const : "brotli" as const;
      const hint: CompressHint = "json";
      return put(await compressAuto(bytes, { codec, hint }));
    },
  };

  return { read, write, dump: () => new Map(store) };
}

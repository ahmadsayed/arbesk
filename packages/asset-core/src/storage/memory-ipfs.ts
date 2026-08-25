import type { IpfsReadPort, IpfsWritePort, WriteJsonOptions } from "../types.ts";
import type { UploadCredential } from "./ipfs/upload-with-credential.ts";
import { compress, decompress, isGzipped } from "../utils/compression.ts";

let counter = 0;

/**
 * In-memory IPFS double. Deterministic fake CIDs; honors the compress
 * option so getJSON/getBytes exercise the same gunzip paths as production.
 * Also serves as the backend-side adapter for benchmarks and tests.
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
      const raw = get(cid);
      const plain = isGzipped(raw) ? decompress(raw) : raw;
      return JSON.parse(new TextDecoder().decode(plain));
    },
    async getBytes(cid) {
      const raw = get(cid);
      const plain = isGzipped(raw) ? decompress(raw) : raw;
      return plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer;
    },
    async getRawBytes(cid) {
      const raw = get(cid);
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    },
  };

  const write: IpfsWritePort = {
    async write(data, _filename = "asset.bin", _credential: UploadCredential | null = null, options = {}) {
      let bytes =
        data instanceof Uint8Array ? data :
        data instanceof ArrayBuffer ? new Uint8Array(data) :
        typeof data === "string" ? new TextEncoder().encode(data) :
        new Uint8Array(await (data as Blob).arrayBuffer());
      if (options.compress !== false) bytes = compress(bytes);
      return put(bytes);
    },
    async writeJSON(json, credential = null, options: WriteJsonOptions = {}) {
      return this.write(JSON.stringify(json), options.filename ?? "manifest.json", credential, options);
    },
  };

  return { read, write, dump: () => new Map(store) };
}

/**
 * Browser IpfsReadPort/IpfsWritePort — thin wrappers over the existing
 * gateway/session modules.
 * @remarks Lives outside asset-core by design — this file is the
 *   environment-specific implementation.
 */
import type { IpfsReadPort, IpfsWritePort } from "@arbesk/asset-core/types.js";
import {
  getFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
  getRawArrayBufferFromRemoteIPFS,
} from "./remote-ipfs.ts";
import { writeToIPFS, writeJSONToIPFS } from "./write-to-ipfs.ts";

export function createBrowserIpfsPorts(): { read: IpfsReadPort; write: IpfsWritePort } {
  const read: IpfsReadPort = {
    getJSON: (cid) => getFromRemoteIPFS(cid),
    getBytes: (cid, onProgress) => getArrayBufferFromRemoteIPFS(cid, onProgress),
    getRawBytes: (cid) => getRawArrayBufferFromRemoteIPFS(cid) as Promise<ArrayBuffer>,
  };
  const write: IpfsWritePort = {
    write: (data, filename, credential, options) => writeToIPFS(data, filename, credential, options),
    writeJSON: (json, credential, options) => writeJSONToIPFS(json, credential, options),
  };
  return { read, write };
}

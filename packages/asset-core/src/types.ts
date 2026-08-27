/** Port + config types for asset-core. No runtime code here. */
import type { UploadCredential } from "./storage/ipfs/upload-with-credential.ts";

export interface IpfsReadPort {
  /** JSON fetch with auto-gunzip. */
  getJSON(cid: string): Promise<any>;
  /** Byte fetch with auto-gunzip and optional progress (0..1). */
  getBytes(cid: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer>;
  /** Byte fetch with NO gunzip. */
  getRawBytes(cid: string): Promise<ArrayBuffer>;
}

export interface WriteJsonOptions {
  compress?: boolean;
  type?: string;
  assetId?: string;
  filename?: string;
}

export interface IpfsWritePort {
  write(
    data: Uint8Array | ArrayBuffer | Blob | string,
    filename?: string,
    credential?: UploadCredential | null,
    options?: { compress?: boolean }
  ): Promise<string>;
  writeJSON(
    json: Record<string, any>,
    credential?: UploadCredential | null,
    options?: WriteJsonOptions
  ): Promise<string>;
}

export interface CredentialPort {
  /** Mint `count` upload credentials in one round trip (backend /ipfs/upload-urls). */
  getUploadCredentials(count?: number): Promise<UploadCredential[]>;
}

export interface ChainPort {
  /** On-chain editor-list manifest CID for an asset tag (null when none/no contract). */
  getEditorListURI?(assetTag: string): Promise<string | null>;
  /** On-chain editor-list version for an asset tag (merkle-editors flow). */
  getEditorListVersion?(assetTag: string): Promise<number>;
  /** Resolve an email login to a wallet address (backend /users/resolve-email). */
  resolveEmail?(email: string): Promise<string>;
}

export interface HashPort {
  /** drop-in for Web3.utils.soliditySha3 — implement with viem encodePacked+keccak256. */
  soliditySha3(...args: any[]): string;
  keccak256(data: Uint8Array | `0x${string}`): string;
}

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Ops dispatched through the ExecutorPort. The set mirrors exactly what the
 * glTF Web Worker registers (gltf-worker.ts) minus `ping` — async-gltf.ts
 * dispatches these same op names with a single payload object per call, so
 * an ExecutorPort implementation is either a thin pass-through to the worker
 * pool (browser) or the inline main-thread op table (executor/inline.ts).
 */
export type ExecutorOp =
  | "compose"
  | "decomposeGltf"
  | "decomposeGlb"
  | "decomposeAndUploadGltf"
  | "decomposeAndUploadGlb"
  | "bakeSourceColors";

export interface ExecutorPort {
  available(): Promise<boolean>;
  exec<T = any>(op: ExecutorOp, args: unknown[]): Promise<T>;
}

export interface Kernels {
  base64: {
    encode(bytes: Uint8Array | ArrayBuffer): string;
    decode(b64: string): Uint8Array;
  };
  hash: {
    sha256(bytes: Uint8Array): Promise<Uint8Array>;
    murmur3_128(bytes: Uint8Array, seed?: number): string;
  };
  glb: {
    isGLB(bytes: Uint8Array | ArrayBuffer): boolean;
  };
}

export interface ArbeskCoreConfig {
  ipfsRead: IpfsReadPort;
  ipfsWrite: IpfsWritePort;
  credentials?: CredentialPort;
  chain?: ChainPort;
  hash?: HashPort;
  storage?: StoragePort;
  executor?: ExecutorPort;
  kernels?: Partial<Kernels>;
}

export interface ArbeskRuntime {
  ipfsRead: IpfsReadPort;
  ipfsWrite: IpfsWritePort;
  credentials: CredentialPort | null;
  chain: ChainPort | null;
  hash: HashPort | null;
  storage: StoragePort;
  executor: ExecutorPort;
  kernels: Kernels;
}

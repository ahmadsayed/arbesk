/**
 * asset-core SDK facade — createArbeskCore.
 *
 * One-call composition root for any environment (backend, browser, tests):
 * `createArbeskCore(config)` installs the process-wide runtime (initRuntime)
 * and returns a thin object composing the pipeline (gltf/), manifest chain
 * walk/validation (manifest/), and editor commands (domain/editors.ts).
 *
 * The facade contains no logic of its own beyond input format sniffing
 * (GLB magic vs glTF JSON) and editor identity resolution (0x-address
 * passthrough, else ChainPort.resolveEmail).
 */

import type { ArbeskCoreConfig } from "./types.ts";
import type { UploadCredential } from "./ipfs/upload-with-credential.ts";
import { initRuntime, getRuntime } from "./runtime.ts";
import { isGLB, decomposeGLB } from "./gltf/glb-parser.ts";
import { decomposeAndStore } from "./gltf/decomposer.ts";
import { composeGlTFToBlobAsync } from "./gltf/async-gltf.ts";
import { getManifestChain } from "./manifest/chain.ts";
import type { ManifestChainEntry } from "./manifest/chain.ts";
import { validateManifest } from "./manifest/utils.ts";
import {
  addEditorCommand,
  removeEditorCommand,
  listEditorsCommand,
} from "./domain/editors.ts";
import type { EditorEntry } from "./domain/editors.ts";

export interface UploadOptions {
  /** Accepted for interface stability; the decompose pipeline does not report progress yet. */
  onProgress?: (fraction: number) => void;
  credential?: UploadCredential | null;
  compress?: boolean;
  assetName?: string;
  assetId?: string;
  dedupMap?: Map<string, string> | null;
}

export interface UploadResult {
  /** CID of the stored composite glTF (the content root of the upload). */
  rootCid: string;
  compositeCid?: string;
}

export interface DownloadOptions {
  /** Accepted for interface stability; compose fetches do not report progress yet. */
  onProgress?: (fraction: number) => void;
}

export interface AssetRefLike {
  tag?: string;
  chainId?: number;
  contractAddress?: string;
  tokenId?: string;
  assetId?: string;
}

export interface ArbeskCore {
  upload(
    source: Blob | ArrayBuffer | Uint8Array | string,
    opts?: UploadOptions
  ): Promise<UploadResult>;
  download(
    ref: string | Record<string, any>,
    opts?: DownloadOptions
  ): Promise<Blob>;
  compose(
    manifest: Record<string, any>,
    opts?: DownloadOptions
  ): Promise<Blob>;
  decompose(
    gltfJson: Record<string, any>,
    opts?: UploadOptions
  ): Promise<UploadResult>;
  decomposeGLB(
    bytes: Uint8Array | ArrayBuffer,
    opts?: UploadOptions
  ): Promise<UploadResult>;
  getManifest(cid: string): Promise<Record<string, any>>;
  getVersionHistory(
    cid: string,
    maxDepth?: number
  ): Promise<ManifestChainEntry[]>;
  validateManifest(manifest: unknown): ReturnType<typeof validateManifest>;
  addEditor(asset: AssetRefLike, identity: string): Promise<void>;
  removeEditor(asset: AssetRefLike, identity: string): Promise<void>;
  listEditors(asset: AssetRefLike): Promise<EditorEntry[]>;
}

/**
 * Normalize an upload source to an ArrayBuffer for format sniffing.
 */
async function toBytes(
  source: Blob | ArrayBuffer | Uint8Array | string
): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  if (source instanceof Uint8Array) {
    return source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    ) as ArrayBuffer;
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source.arrayBuffer();
  }
  if (typeof source === "string") {
    return new TextEncoder().encode(source).buffer as ArrayBuffer;
  }
  throw new Error("asset-core: unsupported upload source type");
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Resolve an editor identity: 0x addresses pass through; anything else is
 * treated as an email and needs a ChainPort with resolveEmail.
 */
async function resolveIdentity(identity: string): Promise<string> {
  if (ADDRESS_RE.test(identity)) return identity;
  const chain = getRuntime().chain;
  if (!chain?.resolveEmail) {
    throw new Error(
      "asset-core: email identity requires a ChainPort with resolveEmail — or pass a 0x address"
    );
  }
  return chain.resolveEmail(identity);
}

/**
 * Editor lists are keyed per token: the browser ChainPort passes the key
 * straight to the contract's editorListURI/editorSetVersion (tokenId). A full
 * canonical asset tag is accepted for environments keyed that way.
 */
function editorListKey(asset: AssetRefLike): string {
  const key = asset.tokenId ?? asset.tag;
  if (!key) {
    throw new Error("asset-core: editor ops require asset.tokenId or asset.tag");
  }
  return String(key);
}

/**
 * Install the runtime from `config` and return the SDK facade.
 */
export function createArbeskCore(config: ArbeskCoreConfig): ArbeskCore {
  initRuntime(config);

  async function uploadGLB(
    bytes: ArrayBuffer,
    opts: UploadOptions
  ): Promise<UploadResult> {
    const { credential = null, compress = true, onProgress, ...rest } = opts;
    void onProgress; // see UploadOptions
    const { compositeCid } = await decomposeGLB(bytes, null, {
      credential,
      compress,
      ...rest,
    });
    if (!compositeCid) {
      throw new Error("asset-core: GLB decompose stored no composite CID");
    }
    return { rootCid: compositeCid, compositeCid };
  }

  async function uploadGltfJson(
    gltfJson: Record<string, any>,
    opts: UploadOptions
  ): Promise<UploadResult> {
    const { credential = null, compress = true, onProgress, ...rest } = opts;
    void onProgress; // see UploadOptions
    const { compositeCid } = await decomposeAndStore(gltfJson, credential, {
      compress,
      ...rest,
    });
    return { rootCid: compositeCid, compositeCid };
  }

  async function upload(
    source: Blob | ArrayBuffer | Uint8Array | string,
    opts: UploadOptions = {}
  ): Promise<UploadResult> {
    const bytes = await toBytes(source);
    if (isGLB(bytes)) return uploadGLB(bytes, opts);
    const json =
      typeof source === "string"
        ? JSON.parse(source)
        : JSON.parse(new TextDecoder().decode(bytes));
    return uploadGltfJson(json, opts);
  }

  async function download(
    ref: string | Record<string, any>,
    opts: DownloadOptions = {}
  ): Promise<Blob> {
    void opts; // see DownloadOptions
    const manifest =
      typeof ref === "string" ? await getRuntime().ipfsRead.getJSON(ref) : ref;
    return composeGlTFToBlobAsync(manifest);
  }

  return {
    upload,
    download,
    compose: (manifest, opts = {}) => {
      void opts; // see DownloadOptions
      return composeGlTFToBlobAsync(manifest);
    },
    decompose: (gltfJson, opts = {}) => uploadGltfJson(gltfJson, opts),
    decomposeGLB: async (bytes, opts = {}) =>
      uploadGLB(await toBytes(bytes), opts),
    getManifest: (cid) => getRuntime().ipfsRead.getJSON(cid),
    getVersionHistory: (cid, maxDepth) => getManifestChain(cid, maxDepth),
    validateManifest,
    addEditor: async (asset, identity) => {
      const address = await resolveIdentity(identity);
      await addEditorCommand(editorListKey(asset), address);
    },
    removeEditor: async (asset, identity) => {
      const address = await resolveIdentity(identity);
      await removeEditorCommand(editorListKey(asset), address);
    },
    listEditors: (asset) => listEditorsCommand(editorListKey(asset)),
  };
}

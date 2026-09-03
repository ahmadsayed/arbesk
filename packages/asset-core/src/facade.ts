/**
 * asset-core SDK facade — createArbeskCore.
 * @remarks One-call composition root: installs the process-wide runtime and
 *   returns a thin object composing the format pipeline, manifest chain
 *   walk/validation, and editor commands. Contains no format logic of its own —
 *   compose/decompose dispatch to the selected FormatCodec and upload sniffs
 *   the input to choose the codec.
 */

import type { ArbeskCoreConfig } from "./types.ts";
import { initRuntime, getRuntime } from "./runtime.ts";
import type { UploadCredential } from "./storage/ipfs/upload-with-credential.ts";
import {
  detectFormat,
  compose as composeFormat,
  decompose as decomposeFormat,
} from "./formats/index.ts";
import type { DecomposeResult } from "./formats/codec.ts";
import { composeAsync } from "./formats/gltf/async-gltf.ts";
import { getManifestChain } from "./manifest/chain.ts";
import type { ManifestChainEntry } from "./manifest/chain.ts";
import { validateManifest } from "./manifest/utils.ts";
import {
  addEditorCommand,
  removeEditorCommand,
  listEditorsCommand,
} from "./domain/editors.ts";
import type { EditorEntry } from "./domain/editors.ts";
import {
  listCollections,
  getCollectionAssets,
  resolveCollectionByName,
  resolveAssetByName,
} from "./catalog/index.ts";
import type { CollectionSummary, AssetSummary } from "./catalog/index.ts";

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  credential?: UploadCredential | null;
  compress?: boolean;
  assetName?: string;
  assetId?: string;
  dedupMap?: Map<string, string> | null;
}

export interface UploadResult {
  rootCid: string;
  compositeCid?: string;
}

export interface DownloadOptions {
  onProgress?: (fraction: number) => void;
  format?: string;
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
    input: Record<string, any> | ArrayBuffer | Uint8Array,
    opts?: UploadOptions & { store?: boolean; format?: string }
  ): Promise<DecomposeResult>;
  getManifest(cid: string): Promise<Record<string, any>>;
  getVersionHistory(
    cid: string,
    maxDepth?: number
  ): Promise<ManifestChainEntry[]>;
  listCollections(address: string, chainId?: number): Promise<CollectionSummary[]>;
  getCollectionAssets(tokenId: string, chainId?: number): Promise<AssetSummary[]>;
  resolveCollectionByName(
    address: string,
    name: string,
    chainId?: number
  ): Promise<CollectionSummary | null>;
  resolveAssetByName(
    tokenId: string,
    name: string,
    chainId?: number
  ): Promise<{ assetID: string; cid: string } | null>;
  validateManifest(manifest: unknown): ReturnType<typeof validateManifest>;
  addEditor(asset: AssetRefLike, identity: string): Promise<void>;
  removeEditor(asset: AssetRefLike, identity: string): Promise<void>;
  listEditors(asset: AssetRefLike): Promise<EditorEntry[]>;
}

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

function editorListKey(asset: AssetRefLike): string {
  const key = asset.tokenId ?? asset.tag;
  if (!key) {
    throw new Error("asset-core: editor ops require asset.tokenId or asset.tag");
  }
  return String(key);
}

export function createArbeskCore(config: ArbeskCoreConfig): ArbeskCore {
  initRuntime(config);

  async function composeToBlob(
    manifest: Record<string, any>,
    opts: DownloadOptions = {}
  ): Promise<Blob> {
    const format = detectFormat(manifest, opts.format);
    // glTF goes through the executor (worker in the browser, inline on the
    // backend) so large compositions stay off the calling thread; other
    // formats use the main-thread codec (they have no worker offload).
    const bytes =
      format === "gltf"        ? await composeAsync(manifest)        : await composeFormat(manifest, { format });
    return new Blob([bytes as unknown as BlobPart], { type: "application/json" });
  }

  async function upload(
    source: Blob | ArrayBuffer | Uint8Array | string,
    opts: UploadOptions = {}
  ): Promise<UploadResult> {
    const { credential = null, compress = true, onProgress, ...rest } = opts;
    void onProgress;
    const bytes = await toBytes(source);
    let input: Record<string, any> | ArrayBuffer;
    if (getRuntime().kernels.glb.isGLB(bytes)) {
      input = bytes;
    } else if (typeof source === "string") {
      input = JSON.parse(source);
    } else {
      input = JSON.parse(new TextDecoder().decode(bytes));
    }
    const { compositeCid } = await decomposeFormat(input, {
      credential,
      compress,
      ...rest,
    });
    if (!compositeCid) {
      throw new Error("asset-core: decompose stored no composite CID");
    }
    return { rootCid: compositeCid, compositeCid };
  }

  async function download(
    ref: string | Record<string, any>,
    opts: DownloadOptions = {}
  ): Promise<Blob> {
    const manifest =
      typeof ref === "string" ? await getRuntime().ipfsRead.getJSON(ref) : ref;
    return composeToBlob(manifest, opts);
  }

  return {
    upload,
    download,
    compose: (manifest, opts = {}) => composeToBlob(manifest, opts),
    decompose: (input, opts = {}) => decomposeFormat(input, opts),
    getManifest: (cid) => getRuntime().ipfsRead.getJSON(cid),
    getVersionHistory: (cid, maxDepth) => getManifestChain(cid, maxDepth),
    listCollections: (address, chainId) => listCollections(address, chainId),
    getCollectionAssets: (tokenId, chainId) => getCollectionAssets(tokenId, chainId),
    resolveCollectionByName: (address, name, chainId) =>
      resolveCollectionByName(address, name, chainId),
    resolveAssetByName: (tokenId, name, chainId) =>
      resolveAssetByName(tokenId, name, chainId),
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

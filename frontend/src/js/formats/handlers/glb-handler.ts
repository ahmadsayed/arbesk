/**
 * Built-in handler for binary GLB assets.
 */

import {
  getBlobFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
} from "../../ipfs/remote-ipfs.ts";
import {
  decomposeGLBAsync,
  editSourceColorsAsync,
} from "@arbesk/asset-core/formats/gltf/async-gltf.js";
import type {
  FormatHandler,
  FormatLoadContext,
  FormatSaveContext,
} from "../registry.ts";

const GLB_MAGIC = 0x46546c67; // "glTF" as little-endian uint32

export const glbHandler: FormatHandler = {
  format: "glb",
  extensions: [".glb"],

  sniff(bytes: Uint8Array): boolean {
    if (!bytes || bytes.length < 4) return false;
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );
    return view.getUint32(0, true) === GLB_MAGIC;
  },

  /**
   * Load a binary GLB asset into the scene.
   */
  async load(src: any, ctx: FormatLoadContext) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-glb] fetching GLB blob | cid=${cid}`);
    const blob = await getBlobFromRemoteIPFS(cid, ctx.onProgress);
    console.log(`[FORMATS-glb] fetched | bytes=${blob.size}`);
    return ctx.importFromBlob(blob, ".glb");
  },

  /**
   * Decompose a binary GLB source for save/publish.
   */
  async decomposeForSave(node: any, ctx: FormatSaveContext) {
    const cid = node.source.cid;
    const glbBuffer = await getArrayBufferFromRemoteIPFS(cid);
    const { compositeCid } = await decomposeGLBAsync(glbBuffer, true, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
    if (!compositeCid) {
      throw new Error(`[FORMATS-glb] GLB decomposition produced no CID | cid=${cid}`);
    }
    return {
      cid: compositeCid,
      path: "composite.gltf",
      format: "gltf",
    };
  },

  isStoredForm(): boolean {
    return false;
  },

  isDedupSource(): boolean {
    return false;
  },

  async editSourceColors(
    node: any,
    colorMap: Record<string, string>,
    ctx: FormatSaveContext
  ) {
    return editSourceColorsAsync(node.source.cid, colorMap, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
  },
};

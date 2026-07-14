// @ts-check
/**
 * Built-in handler for binary GLB assets.
 */

import {
  getBlobFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
} from "../../ipfs/remote-ipfs.js";
import {
  decomposeGLBAsync,
  editSourceColorsAsync,
} from "../../gltf/async-gltf.js";

const GLB_MAGIC = 0x46546c67; // "glTF" as little-endian uint32

/** @type {import("../registry.js").FormatHandler} */
export const glbHandler = {
  format: "glb",
  extensions: [".glb"],

  /**
   * @param {Uint8Array} bytes
   * @returns {boolean}
   */
  sniff(bytes) {
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
   *
   * @param {any} src
   * @param {import("../registry.js").FormatLoadContext} ctx
   */
  async load(src, ctx) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-glb] fetching GLB blob | cid=${cid}`);
    const blob = await getBlobFromRemoteIPFS(cid);
    console.log(`[FORMATS-glb] fetched | bytes=${blob.size}`);
    return ctx.importFromBlob(blob, ".glb");
  },

  /**
   * Decompose a binary GLB source for save/publish.
   *
   * @param {any} node
   * @param {import("../registry.js").FormatSaveContext} ctx
   */
  async decomposeForSave(node, ctx) {
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

  /**
   * @returns {boolean}
   */
  isStoredForm() {
    return false;
  },

  /**
   * @returns {boolean}
   */
  isDedupSource() {
    return false;
  },

  /**
   * @param {any} node
   * @param {Record<string, string>} colorMap
   * @param {import("../registry.js").FormatSaveContext} ctx
   */
  async editSourceColors(node, colorMap, ctx) {
    return editSourceColorsAsync(node.source.cid, colorMap, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
  },
};

// @ts-check
/**
 * Built-in handler for loose glTF JSON assets.
 */

import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.js";
import {
  composeGlTFToBlobAsync,
  decomposeAndStoreAsync,
  editSourceColorsAsync,
} from "../../gltf/async-gltf.js";
import { isComposite } from "../../gltf/decomposer.js";
import { editCompositeColors } from "../../gltf/material-editor.js";

/** @type {import("../registry.js").FormatHandler} */
export const gltfHandler = {
  format: "gltf",
  extensions: [".gltf"],

  /**
   * Load a loose glTF JSON asset into the scene.
   *
   * @param {any} src
   * @param {import("../registry.js").FormatLoadContext} ctx
   */
  async load(src, ctx) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-gltf] fetching glTF JSON | cid=${cid}`);
    const gltfJson = await getFromRemoteIPFS(cid);
    const gltfBlob = await composeGlTFToBlobAsync(gltfJson);
    console.log(`[FORMATS-gltf] composed | bytes=${gltfBlob.size}`);
    return ctx.importFromBlob(gltfBlob, ".gltf");
  },

  /**
   * Decompose a loose glTF source for save/publish.
   *
   * @param {any} node
   * @param {import("../registry.js").FormatSaveContext} ctx
   */
  async decomposeForSave(node, ctx) {
    const cid = node.source.cid;
    const gltf = await getFromRemoteIPFS(cid);
    if (!gltf?.asset?.version) {
      console.log(`[FORMATS-gltf] CID ${cid} is not a glTF, skipping`);
      return null;
    }
    if (isComposite(gltf)) {
      console.log(
        `[FORMATS-gltf] already composite, normalizing path | cid=${cid}`
      );
      return {
        cid,
        path: "composite.gltf",
        format: "gltf",
        normalizeOnly: true,
      };
    }
    const { compositeCid } = await decomposeAndStoreAsync(gltf, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
    return {
      cid: compositeCid,
      path: "composite.gltf",
      format: "gltf",
    };
  },

  /**
   * @param {any} node
   * @returns {boolean}
   */
  isStoredForm(node) {
    return (
      node.source?.format === "gltf" && node.source?.path === "composite.gltf"
    );
  },

  /**
   * @param {any} node
   * @returns {boolean}
   */
  isDedupSource(node) {
    return (
      node.source?.path === "composite.gltf" ||
      node.source?.format === "gltf"
    );
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

  /**
   * @param {any} node
   * @param {any} meshOverrides
   * @param {any} color
   * @param {import("../registry.js").FormatSaveContext} ctx
   */
  async editCompositeColors(node, meshOverrides, color, ctx) {
    return editCompositeColors(
      node.source.cid,
      meshOverrides,
      color,
      {
        assetName: ctx.assetName,
        assetId: ctx.assetId,
      }
    );
  },
};

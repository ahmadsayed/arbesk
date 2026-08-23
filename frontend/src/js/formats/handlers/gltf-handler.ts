/**
 * Built-in handler for loose glTF JSON assets.
 */

import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.ts";
import {
  composeGlTFToBlobAsync,
  decomposeAndStoreAsync,
  editSourceColorsAsync,
} from "../../asset-core/gltf/async-gltf.ts";
import { isComposite } from "../../asset-core/gltf/decomposer.ts";
import { editCompositeColors } from "../../asset-core/gltf/material-editor.ts";
import type {
  FormatHandler,
  FormatLoadContext,
  FormatSaveContext,
} from "../registry.ts";

export const gltfHandler: FormatHandler = {
  format: "gltf",
  extensions: [".gltf"],

  /**
   * Load a loose glTF JSON asset into the scene.
   */
  async load(src: any, ctx: FormatLoadContext) {
    const cid = ctx.cid || src.cid;
    console.log(`[FORMATS-gltf] fetching glTF JSON | cid=${cid}`);
    const gltfJson = await getFromRemoteIPFS(cid);
    const gltfBlob = await composeGlTFToBlobAsync(gltfJson);
    console.log(`[FORMATS-gltf] composed | bytes=${gltfBlob.size}`);
    return ctx.importFromBlob(gltfBlob, ".gltf");
  },

  /**
   * Decompose a loose glTF source for save/publish.
   */
  async decomposeForSave(node: any, ctx: FormatSaveContext) {
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

  isStoredForm(node: any): boolean {
    return (
      node.source?.format === "gltf" && node.source?.path === "composite.gltf"
    );
  },

  isDedupSource(node: any): boolean {
    return (
      node.source?.path === "composite.gltf" ||
      node.source?.format === "gltf"
    );
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

  async editCompositeColors(
    node: any,
    meshOverrides: any,
    color: any,
    ctx: FormatSaveContext
  ) {
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

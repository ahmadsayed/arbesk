/**
 * Save-time source edits shared by the glTF and GLB handlers: both store
 * edited sources as glTF JSON, so color bakes and part removals are the same
 * operation for either format.
 */

import { editSourceColorsAsync } from "@arbesk/asset-core/formats/gltf/async-gltf.js";
import { removeSourceParts } from "@arbesk/asset-core/formats/gltf/source-part-remover.js";
import type { FormatSaveContext } from "../registry.ts";

export const sourceEditHooks = {
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

  async removeSourceParts(
    node: any,
    partNames: string[],
    ctx: FormatSaveContext
  ) {
    return removeSourceParts(node.source.cid, partNames, {
      assetName: ctx.assetName,
      assetId: ctx.assetId,
      dedupMap: ctx.dedupMap,
    });
  },
};

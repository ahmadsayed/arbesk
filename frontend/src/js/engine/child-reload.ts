import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { getManifestNodes } from "./transforms.ts";
import { reloadChildRefNode } from "./scene-loader.ts";

/** Reloads every child_ref node whose referenced token matches the update. */
export function initChildReload(): void {
  on(EVENTS.ASSET_URI_UPDATED, (payload: any) => {
    for (const n of getManifestNodes(getCurrentManifest())) {
      const ref = n?.child_ref;
      if (!ref) continue;
      const chainId = Number(ref.collection?.chainId ?? ref.chainId ?? 0);
      const tokenId = String(ref.collection?.tokenId ?? ref.tokenId ?? "");
      if (chainId === Number(payload.chainId) && tokenId === String(payload.tokenId)) {
        reloadChildRefNode(n.node_id).catch(() => {});
      }
    }
  });
}

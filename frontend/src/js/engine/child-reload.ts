import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { collectSceneChildRefs, childRefMatchesUpdate, coveredByMatchedAncestor } from "./child-refs.ts";
import { reloadChildRefNode } from "./scene-loader.ts";

/** Reloads every child_ref node whose referenced asset matches the update. */
export function initChildReload(): void {
  on(EVENTS.ASSET_URI_UPDATED, (payload: any) => {
    const matches = collectSceneChildRefs().filter(({ ref }) =>
      childRefMatchesUpdate(ref, payload)
    );
    const matchedIds = new Set(matches.map((m) => m.nodeId));
    for (const { nodeId, anchor } of matches) {
      if (coveredByMatchedAncestor(anchor, matchedIds)) continue;
      console.log(`[LIVE] reloading child node ${nodeId} (token ${payload.tokenId}, ${payload.source})`);
      reloadChildRefNode(nodeId).catch((err) => {
        // Never leave a silent no-reload: a failed reload is why live-update
        // consumers (and E2E) otherwise hang with no signal.
        console.warn("[LIVE] child reload failed:", err);
      });
    }
  });
}

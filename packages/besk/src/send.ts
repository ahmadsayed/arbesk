/**
 * Send (link) an asset into another collection — mirrors
 * frontend/src/js/services/asset-delete.ts sendAssetToCollection: fork copies
 * the current asset CID into the target collection under the same assetID;
 * live-ref writes a wrapper asset manifest whose single node is a child_ref
 * back to the source collection asset, so future edits propagate.
 */
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";
import { CHAIN_ID } from "./config.ts";
import { getBackendConfig } from "./adapters.ts";
import { getManifest, updateCollection, writeManifest } from "./catalog.ts";
import type { Session } from "./session.ts";

export interface SendOptions {
  sourceTokenId: string;
  targetTokenId: string;
  assetId: string;
  assetName: string;
  assetCid: string;
  mode: "fork" | "live-ref";
}

export async function sendAssetToCollection(
  session: Session,
  opts: SendOptions,
): Promise<{ targetAssetId: string; targetCid: string }> {
  const { sourceTokenId, targetTokenId, assetId, assetName, assetCid, mode } = opts;
  if (String(sourceTokenId) === String(targetTokenId)) {
    throw new Error("Source and target collection must be different");
  }
  if (mode !== "fork" && mode !== "live-ref") {
    throw new Error("Unsupported link mode: " + mode);
  }

  let targetAssetId = assetId;
  let targetCid = assetCid;

  if (mode === "live-ref") {
    targetAssetId = "asset_" + Date.now();
    // Thumbnails are best-effort everywhere — a missing or unreadable source
    // manifest must not block the link.
    let thumbnail: unknown = null;
    try {
      const sourceManifest = (await getManifest(assetCid)) as Record<string, any>;
      thumbnail = sourceManifest?.thumbnail ?? null;
    } catch {
      /* best-effort */
    }
    const cfg = await getBackendConfig();
    const refManifest = {
      type: "asset",
      name: assetName || targetAssetId,
      asset_id: targetAssetId,
      version: 1,
      timestamp: Date.now(),
      thumbnail,
      scene: {
        nodes: [
          {
            node_id: "node_1",
            child_ref: {
              collection: {
                chainId: CHAIN_ID,
                contractAddress:
                  cfg.networkConfigs[CHAIN_ID]?.contractAddress ?? cfg.contractAddress,
                tokenId: String(sourceTokenId),
              },
              assetID: assetId,
            },
            transform_matrix: identityMatrix(),
          },
        ],
      },
    };
    targetCid = await writeManifest(refManifest);
  }

  await updateCollection(session, targetTokenId, (draft) => {
    draft.assets = { ...(draft.assets || {}) };
    draft.assets[targetAssetId] = targetCid;
  });

  return { targetAssetId, targetCid };
}

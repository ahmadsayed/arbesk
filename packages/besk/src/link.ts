/**
 * Link (nest) a child asset into a parent asset's scene — the manifest-level
 * half of the Studio's drag-to-viewport link (frontend/src/js/engine/
 * scene-loader.ts buildLinkedSceneNode): fork freezes the child's current CID
 * as a plain source node; live-ref adds a child_ref that tracks the source
 * collection asset so future edits propagate. Optional position/scale bake
 * into the node's 16-element column-major transform_matrix.
 *
 * No viewer needed: this is a pure manifest edit. Depth/cycle limits
 * (MAX_CHILD_ASSET_DEPTH) are enforced by the renderer, not here.
 */
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";
import { CHAIN_ID } from "./config.ts";
import { getBackendConfig } from "./adapters.ts";
import { getManifest, updateCollection, writeManifest } from "./catalog.ts";
import type { Session } from "./session.ts";

export interface LinkChildOptions {
  parentTokenId: string;
  parentAssetId: string;
  parentCid: string;
  childTokenId: string;
  childAssetId: string;
  childCid: string;
  mode: "fork" | "live-ref";
  position?: { x: number; y: number; z: number };
  scale?: number;
}

/** Column-major 4x4: uniform scale on the diagonal, translation in the last column. */
function composeTransform(
  position?: { x: number; y: number; z: number },
  scale?: number,
): number[] {
  const m = identityMatrix();
  const s = scale ?? 1;
  m[0] = s;
  m[5] = s;
  m[10] = s;
  if (position) {
    m[12] = position.x;
    m[13] = position.y;
    m[14] = position.z;
  }
  return m;
}

function uniqueNodeId(base: string, nodes: { node_id?: string }[]): string {
  const taken = new Set(nodes.map((n) => n.node_id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(base + "_" + i)) i++;
  return base + "_" + i;
}

export async function linkChildAsset(
  session: Session,
  opts: LinkChildOptions,
): Promise<{ newParentCid: string; nodeId: string }> {
  const parent = (await getManifest(opts.parentCid)) as Record<string, any>;
  const nodes = parent?.scene?.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error(
      "Parent asset has no editable scene (raw composite uploads can't take children)",
    );
  }

  const nodeId = uniqueNodeId(
    "linked_" + opts.childTokenId + "_" + opts.childAssetId,
    nodes,
  );
  const base: Record<string, unknown> = {
    node_id: nodeId,
    transform_matrix: composeTransform(opts.position, opts.scale),
  };
  let node: Record<string, unknown>;
  if (opts.mode === "fork") {
    node = { ...base, source: { cid: opts.childCid } };
  } else {
    const cfg = await getBackendConfig();
    node = {
      ...base,
      child_ref: {
        collection: {
          chainId: CHAIN_ID,
          contractAddress: cfg.networkConfigs[CHAIN_ID]?.contractAddress ?? cfg.contractAddress,
          tokenId: String(opts.childTokenId),
        },
        assetID: opts.childAssetId,
      },
    };
  }

  const next = {
    ...parent,
    version: (parent.version ?? 1) + 1,
    prev_asset_manifest_cid: opts.parentCid,
    scene: { ...parent.scene, nodes: [...nodes, node] },
  };
  const newParentCid = await writeManifest(next);
  await updateCollection(session, opts.parentTokenId, (draft) => {
    draft.assets[opts.parentAssetId] = newParentCid;
  });
  return { newParentCid, nodeId };
}

/**
 * Compute the "computed" metadata map for an asset manifest from its root
 * source node. Pure over the parsed composite glTF JSON (post-decompose the
 * source format is "gltf"); 3MF and other formats return format-only (all
 * computed fields are optional).
 */
import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.ts";
import { computeModelStats } from "@arbesk/asset-core";
import { warn } from "../../utils/log.ts";

export async function computeAssetStats(
  manifest: any,
  readJson: (cid: string) => Promise<any> = getFromRemoteIPFS,
): Promise<Record<string, any> | null> {
  const root = (manifest?.scene?.nodes ?? []).find(
    (n: any) => n.source?.cid && !n.child_ref,
  );
  if (!root?.source?.cid) return null;
  const { cid, format } = root.source;
  if (format === "3mf") return { format: "3mf" };
  if (format !== "gltf") return { format };
  try {
    const json = await readJson(cid);
    return computeModelStats(json, { format: "gltf" });
  } catch (err) {
    warn("[SAVE] metadata extraction failed | cid=" + cid + ":", (err as Error).message);
    return null;
  }
}

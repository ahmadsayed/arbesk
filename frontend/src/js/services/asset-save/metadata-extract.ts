/**
 * Compute the "computed" metadata map for an asset manifest from its root
 * source node.
 * @remarks Pure over parsed composite glTF JSON; 3MF and other formats return
 *   format-only (computed fields are optional).
 */
import { getFromRemoteIPFS } from "../../ipfs/remote-ipfs.ts";
import { computeModelStats } from "@arbesk/asset-core/formats/gltf/model-stats.js";
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
  if (format === "3mf") {
    // CAD-generated 3MF carries exact kernel stats in mm (Z-up: height = Z).
    const cadStats = manifest?.metadata?.cad?.stats;
    const bbox = cadStats?.bboxMm;
    if (!bbox) return { format: "3mf" };
    const size = bbox.max.map((v: number, k: number) => v - bbox.min[k]);
    return {
      format: "3mf",
      dimensions: { width: size[0], depth: size[1], height: size[2], unit: "mm" },
      triangle_count:
        typeof cadStats.triangles === "number" ? cadStats.triangles : undefined,
    };
  }
  if (format !== "gltf") return { format };
  try {
    const json = await readJson(cid);
    return computeModelStats(json, { format: "gltf" });
  } catch (err) {
    warn("[SAVE] metadata extraction failed | cid=" + cid + ":", (err as Error).message);
    return null;
  }
}

import { Router } from "express";
import { createLedgerEntry } from "../../ledger/schema.js";
import { appendEntry } from "../../ledger/store.js";
import { getSceneNodes, bumpManifestVersion } from "../manifest-utils.js";
import { catManifest } from "../ipfs-utils.js";

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;

export default function parametricVersion(ipfs) {
  const router = Router();

  router.post("/", async (req, res) => {
    const { nodeId, color, scale, prevAssetManifestCid } = req.body;
    try {
      console.log(
        `[PARAM] nodeId=${nodeId} color=${color || "none"} scale=${scale ? `${scale.x},${scale.y},${scale.z}` : "none"} prev=${prevAssetManifestCid}`,
      );
      if (!nodeId || !prevAssetManifestCid) {
        console.log(
          `[PARAM] rejected — nodeId and prevAssetManifestCid required`,
        );
        return res
          .status(400)
          .json({ error: "nodeId and prevAssetManifestCid are required" });
      }

      // Validate color
      if (color && !HEX_COLOR_REGEX.test(color)) {
        console.log(`[PARAM] rejected — invalid color "${color}"`);
        return res
          .status(400)
          .json({ error: "color must be a valid hex color (#RRGGBB)" });
      }

      // Validate scale
      if (scale) {
        if (
          typeof scale !== "object" ||
          typeof scale.x !== "number" ||
          scale.x <= 0 ||
          typeof scale.y !== "number" ||
          scale.y <= 0 ||
          typeof scale.z !== "number" ||
          scale.z <= 0
        ) {
          console.log(`[PARAM] rejected — invalid scale`);
          return res.status(400).json({
            error: "scale must be an object with positive x, y, z numbers",
          });
        }
      }

      // Read current manifest from IPFS with 15s timeout
      const data = await catManifest(ipfs, prevAssetManifestCid);
      const manifest = JSON.parse(data);
      console.log(
        `[PARAM] loaded manifest version=${manifest.version} nodes=${getSceneNodes(manifest).length}`,
      );

      // Find node
      const nodes = getSceneNodes(manifest);
      const node = nodes.find((n) => n.node_id === nodeId);
      if (!node) {
        console.log(`[PARAM] rejected — node ${nodeId} not found`);
        return res
          .status(404)
          .json({ error: `Node ${nodeId} not found in manifest` });
      }

      // Apply parametric changes directly to the node
      node.appearance ||= {};
      if (color) node.appearance.color = color;
      if (scale) node.appearance.scale = scale;

      bumpManifestVersion(manifest, prevAssetManifestCid);

      // Write updated manifest to IPFS
      console.log(`[IPFS] add manifest | version=${manifest.version}`);
      const { cid: newAssetManifestCid } = await ipfs.add(
        JSON.stringify(manifest),
      );
      const assetManifestCid = newAssetManifestCid.toString();
      console.log(
        `[PARAM] success → ${assetManifestCid} color=${node.appearance?.color}`,
      );

      // Record to micro-ledger
      appendEntry(
        createLedgerEntry({
          opType: "PARAMETRIC",
          manifestId: manifest.asset_id,
          cid: assetManifestCid,
          prevCid: prevAssetManifestCid,
          actorAddress: req.body.actorAddress || "system",
          payload: {
            nodeId,
            params: {
              scale: scale || { x: 1, y: 1, z: 1 },
              color: color || null,
            },
          },
        }),
      );

      res.json({ assetManifestCid });
    } catch (error) {
      if (error.name === "AbortError") {
        console.error(
          `[PARAM] timeout — IPFS cat aborted for ${prevAssetManifestCid}`,
        );
        return res
          .status(504)
          .json({ error: "IPFS read timed out. Is the IPFS node running?" });
      }
      console.error("[PARAM] error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

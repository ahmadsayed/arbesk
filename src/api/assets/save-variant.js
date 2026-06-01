import { Router } from "express";
import { createLedgerEntry } from "../../ledger/schema.js";
import { appendEntry } from "../../ledger/store.js";

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{6})$/;

export default function parametricVersion(ipfs) {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { nodeId, color, scale, prevAssetManifestCid } = req.body;
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

      // Read current manifest from IPFS
      console.log(`[IPFS] cat prev manifest ${prevAssetManifestCid}`);
      let data = "";
      for await (const file of ipfs.cat(prevAssetManifestCid)) {
        const buffer = new Uint16Array(file);
        buffer.forEach((code) => {
          data += String.fromCharCode(code);
        });
      }
      const manifest = JSON.parse(data);
      console.log(
        `[PARAM] loaded manifest version=${manifest.version} nodes=${(manifest.scene?.nodes || []).length}`,
      );

      // Find node
      const nodes = manifest.scene?.nodes || [];
      const node = nodes.find((n) => n.node_id === nodeId);
      if (!node) {
        console.log(`[PARAM] rejected — node ${nodeId} not found`);
        return res
          .status(404)
          .json({ error: `Node ${nodeId} not found in manifest` });
      }

      // Build source reference from node.source object
      if (!node.source || typeof node.source !== "object") {
        return res
          .status(400)
          .json({ error: `Node ${nodeId} has no source reference` });
      }
      const srcRef = { ...node.source };

      // Append parametric variant entry
      const nextVersion = (node.variants || []).length + 1;
      const variantEntry = {
        v: nextVersion,
        timestamp: Date.now(),
        source: srcRef,
        prompt: `Scale ${scale ? `${scale.x}x,${scale.y}x,${scale.z}x` : "1x,1x,1x"}, Color ${color || "unchanged"}`,
        provider: "parametric",
        type: "parametric",
        params: {
          scale: scale || { x: 1, y: 1, z: 1 },
          color: color || null,
        },
      };

      node.variants = node.variants || [];
      node.variants.push(variantEntry);
      manifest.version += 1;
      manifest.prev_asset_manifest_cid = prevAssetManifestCid;

      // Write updated manifest to IPFS
      console.log(`[IPFS] add manifest | version=${manifest.version}`);
      const { cid: newAssetManifestCid } = await ipfs.add(
        JSON.stringify(manifest),
      );
      const assetManifestCid = newAssetManifestCid.toString();
      console.log(
        `[PARAM] success → ${assetManifestCid} variant_v=${variantEntry.v}`,
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

      res.json({
        assetManifestCid,
        variantEntry,
      });
    } catch (error) {
      console.error("[PARAM] error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

import express from "express";
import { mockGenerate } from "../adapters/mock-adapter.js";
import authenticate from "../authentication.js";
import rateLimit from "../rate-limiter.js";

import { getSceneNodes, bumpManifestVersion } from "../manifest-utils.js";

const Router = express.Router;

export default function generateAssetNode(storage) {
  const router = Router();

  /**
   * POST /api/v1/generations
   * Generate a 3D asset from a text prompt.
   */
  router.post(
    "/",
    authenticate,
    rateLimit({
      max: Number(
        process.env.GENERATION_RATE_LIMIT_MAX ||
          (process.env.MOCK_3D_GENERATION === "true" ? 1000 : 10),
      ),
      windowMs: 60 * 60 * 1000,
    }),
    async (req, res) => {
      try {
        const {
          prompt,
          nodeId,
          provider,
          assetId,
          prevAssetManifestCid,
          transform_matrix,
          providerKey,
        } = req.body;

        const effectiveProvider = provider || "mock";
        const useMockAdapter =
          process.env.MOCK_3D_GENERATION === "true" || effectiveProvider === "mock";

        console.log(
          `[GEN] prompt="${prompt}" nodeId=${nodeId} provider=${effectiveProvider} mock=${useMockAdapter}`,
        );
        if (!prompt || !nodeId) {
          console.log("[GEN] rejected — prompt and nodeId required");
          return res.status(400).json({
            error: {
              code: "MISSING_PARAMS",
              message: "prompt and nodeId are required",
            },
          });
        }

        // BYOK (Bring Your Own Key): real providers require a user-supplied API
        // key. The user pays the provider directly, so the on-chain quota/payment
        // gate is bypassed entirely. The key is used transiently and is never
        // logged or persisted. The mock provider needs no key.
        if (effectiveProvider !== "mock") {
          if (
            typeof providerKey !== "string" ||
            providerKey.trim().length === 0 ||
            providerKey.length > 200
          ) {
            console.log("[GEN] rejected — providerKey required for real provider");
            return res.status(400).json({
              error: {
                code: "MISSING_PROVIDER_KEY",
                message: "providerKey is required for the selected provider",
              },
            });
          }
          console.log(
            `[GEN] byok provider=${effectiveProvider} key=*** (len=${providerKey.trim().length}) — on-chain gate bypassed`,
          );
        }

        let result;
        if (useMockAdapter) {
          console.log(`[GEN] using MOCK adapter for "${prompt}"`);
          // Pass provider + providerKey for interface compatibility; the mock
          // ignores them, but real cloud adapters will use them.
          result = await mockGenerate(prompt, { provider: effectiveProvider, providerKey });
          console.log(
            `[GEN] mock returned provider=${result.provider || "mock"} size=${result.data?.length || result.buffer?.length || "?"} bytes`,
          );
        } else {
          console.log("[GEN] cloud adapter not implemented — rejecting");
          return res.status(501).json({
            error: {
              code: "NOT_IMPLEMENTED",
              message: "Cloud adapters not yet implemented",
            },
          });
        }

        const assetPayload = result.data || result.buffer;
        console.log(
          `[IPFS] add source asset | size=${assetPayload?.length || "?"} bytes`,
        );
        const sourceAssetCid = await storage.add(assetPayload);
        console.log(`[IPFS] add source asset → ${sourceAssetCid}`);

        let manifest = null;
        if (prevAssetManifestCid) {
          try {
            console.log(
              `[GEN] reading previous asset manifest ${prevAssetManifestCid}`,
            );
            const data = await storage.cat(prevAssetManifestCid);
            manifest = JSON.parse(data);
            console.log(
              `[GEN] previous manifest loaded — version=${manifest.version} nodes=${getSceneNodes(manifest).length}`,
            );
          } catch (e) {
            console.warn(
              `[GEN] could not read previous manifest ${prevAssetManifestCid}: ${e.message}`,
            );
          }
        }

        if (!manifest) {
          manifest = {
            asset_id: assetId || `asset_${Date.now()}`,
            version: 0,
            timestamp: Date.now(),
            prev_asset_manifest_cid: null,
            scene: { nodes: [] },
          };
        }

        const nodes = getSceneNodes(manifest);
        let node;
        if (nodes.length > 0) {
          node = nodes[0];
          node.node_id = nodeId;
          node.type = "source_asset";
          node.source = null;
          if (
            Array.isArray(transform_matrix) &&
            transform_matrix.length === 16
          ) {
            node.transform_matrix = transform_matrix;
          }
          nodes.length = 1;
        } else {
          // Use prompt as display name (truncated for UI clarity)
          const displayName = prompt
            ? prompt.slice(0, 60) + (prompt.length > 60 ? "…" : "")
            : nodeId;
          node = {
            node_id: nodeId,
            type: "source_asset",
            name: displayName,
            source: null,
            transform_matrix:
              Array.isArray(transform_matrix) && transform_matrix.length === 16
                ? transform_matrix
                : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          };
          nodes.push(node);
        }

        const assetFormat = result.format || "gltf";
        const assetPath = result.path || `asset.${assetFormat}`;
        const source = {
          cid: sourceAssetCid,
          path: assetPath,
          format: assetFormat,
        };

        node.source = source;
        node.post_processor = { color: null, scale: { x: 1, y: 1, z: 1 } };
        bumpManifestVersion(manifest, prevAssetManifestCid || null);

        console.log(
          `[IPFS] add asset manifest | version=${manifest.version} nodes=${nodes.length}`,
        );
        const assetManifestCid = await storage.add(JSON.stringify(manifest));
        console.log(`[IPFS] add asset manifest → ${assetManifestCid}`);

        console.log(
          `[GEN] success — manifest=${assetManifestCid} sourceAsset=${sourceAssetCid}`,
        );

        res.json({
          assetManifestCid,
          sourceAssetCid,
          ...(req.body.tier !== undefined &&
            req.body.tier !== null && { tier: Number(req.body.tier) }),
        });
      } catch (error) {
        console.error("[GEN] error:", error.message);
        res.status(500).json({
          error: {
            code: "GENERATION_FAILED",
            message: error.message,
          },
        });
      }
    },
  );

  return router;
}

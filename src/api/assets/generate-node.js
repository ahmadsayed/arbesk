import { Router } from "express";
import { CONTRACT_ADDRESS, API_URL, web3 } from "../../config.js";
import { mockGenerate } from "../adapters/mock-adapter.js";
import authenticate from "../authentication.js";
import rateLimit from "../rate-limiter.js";
import { createLedgerEntry } from "../../ledger/schema.js";
import { appendEntry } from "../../ledger/store.js";

import { getSceneNodes, bumpManifestVersion } from "../manifest-utils.js";
import { catManifest } from "../ipfs-utils.js";

const usedTxHashes = new Set();

export default function generateAssetNode(ipfs) {
  const router = Router();

  /**
   * POST /api/v1/generations
   * Generate a 3D asset from a text prompt.
   */
  router.post(
    "/",
    authenticate,
    rateLimit({ max: 10, windowMs: 60 * 60 * 1000 }),
    async (req, res) => {
      try {
        const {
          prompt,
          nodeId,
          txHash,
          provider,
          assetId,
          prevAssetManifestCid,
          transform_matrix,
        } = req.body;

        console.log(
          `[GEN] prompt="${prompt}" nodeId=${nodeId} tx=${txHash || res.locals.txHash || "none"} provider=${provider || "default"}`,
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

        const effectiveTxHash = txHash || res.locals.txHash;
        console.log(`[GEN] validating tx ${effectiveTxHash} on ${API_URL}`);
        const receipt = await web3.eth.getTransactionReceipt(effectiveTxHash);
        if (!receipt || Number(receipt.status) !== 1) {
          console.log(
            `[GEN] tx validation failed — receipt=${!!receipt} status=${receipt ? receipt.status : "n/a"}`,
          );
          return res.status(403).json({
            error: {
              code: "INVALID_TRANSACTION",
              message: "Invalid or failed transaction",
            },
          });
        }
        console.log(
          `[GEN] tx ${effectiveTxHash} confirmed (block ${receipt.blockNumber})`,
        );

        if (
          CONTRACT_ADDRESS &&
          receipt.to &&
          receipt.to.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()
        ) {
          console.log(
            `[GEN] contract mismatch — receipt.to=${receipt.to} CONTRACT_ADDRESS=${CONTRACT_ADDRESS}`,
          );
          return res.status(403).json({
            error: {
              code: "WRONG_CONTRACT",
              message: "Transaction not sent to ArbeskAsset contract",
            },
          });
        }

        if (CONTRACT_ADDRESS) {
          // Check for both native-token and USDC (tiered) payment events
          // USDC event now includes Tier (uint8) as 6th indexed param
          const nativeEventSig = web3.utils.keccak256(
            "AssetGenerationPaid(address,bytes32,string,uint256,uint256)",
          );
          const usdcEventSig = web3.utils.keccak256(
            "AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)",
          );
          const contractAddr = CONTRACT_ADDRESS.toLowerCase();
          const hasPaymentEvent = receipt.logs.some(
            (log) =>
              (log.topics[0] === nativeEventSig ||
                log.topics[0] === usdcEventSig) &&
              log.address.toLowerCase() === contractAddr,
          );
          if (!hasPaymentEvent) {
            console.log("[GEN] payment event not found in tx logs");
            return res.status(403).json({
              error: {
                code: "EVENT_NOT_FOUND",
                message:
                  "Transaction did not emit expected payment event (AssetGenerationPaid or AssetGenerationPaidUSDC)",
              },
            });
          }
          console.log("[GEN] payment event verified (native or USDC tiered)");

          // If request specifies a tier, validate it against the on-chain event
          if (req.body.tier !== undefined && req.body.tier !== null) {
            const requestedTier = Number(req.body.tier);
            const usdcLog = receipt.logs.find(
              (log) =>
                log.topics[0] === usdcEventSig &&
                log.address.toLowerCase() === contractAddr,
            );
            if (!usdcLog) {
              // Request claims a tier but no USDC event found — reject
              console.log(
                `[GEN] TIER MISMATCH — tier ${requestedTier} requested but no USDC payment event found`,
              );
              return res.status(403).json({
                error: {
                  code: "TIER_MISMATCH",
                  message: `Tier ${requestedTier} specified but transaction does not contain a USDC payment event`,
                },
              });
            }
            // Decode event data: (string prompt, uint256 amount, uint256 timestamp, uint8 tier)
            const decoded = web3.eth.abi.decodeParameters(
              ["string", "uint256", "uint256", "uint8"],
              usdcLog.data,
            );
            const onChainTier = Number(decoded[3]); // 4th param = tier
            if (onChainTier !== requestedTier) {
              console.log(
                `[GEN] TIER MISMATCH — requested=${requestedTier} on-chain=${onChainTier}`,
              );
              return res.status(403).json({
                error: {
                  code: "TIER_MISMATCH",
                  message: `Requested tier ${requestedTier} does not match on-chain payment tier ${onChainTier}`,
                },
              });
            }
            console.log(
              `[GEN] tier validated — ${onChainTier} (${["Basic", "Standard", "Premium", "Pro"][onChainTier] || "?"})`,
            );
          }
        }

        if (usedTxHashes.has(effectiveTxHash)) {
          console.log(
            `[GEN] REPLAY detected — tx ${effectiveTxHash} already consumed`,
          );
          return res.status(409).json({
            error: {
              code: "REPLAY_DETECTED",
              message: "This transaction has already been consumed",
            },
          });
        }

        let result;
        if (process.env.MOCK_3D_GENERATION === "true") {
          console.log(`[GEN] using MOCK adapter for "${prompt}"`);
          result = await mockGenerate(prompt);
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
        const { cid: sourceCid } = await ipfs.add(assetPayload);
        const sourceAssetCid = sourceCid.toString();
        console.log(`[IPFS] add source asset → ${sourceAssetCid}`);

        let manifest = null;
        if (prevAssetManifestCid) {
          try {
            console.log(
              `[GEN] reading previous asset manifest ${prevAssetManifestCid}`,
            );
            const data = await catManifest(ipfs, prevAssetManifestCid);
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
          node = {
            node_id: nodeId,
            type: "source_asset",
            name: nodeId,
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
        node.appearance = { color: null, scale: { x: 1, y: 1, z: 1 } };
        bumpManifestVersion(manifest, prevAssetManifestCid || null);

        console.log(
          `[IPFS] add asset manifest | version=${manifest.version} nodes=${nodes.length}`,
        );
        const { cid: newAssetManifestCid } = await ipfs.add(
          JSON.stringify(manifest),
        );
        const assetManifestCid = newAssetManifestCid.toString();
        console.log(`[IPFS] add asset manifest → ${assetManifestCid}`);

        usedTxHashes.add(effectiveTxHash);
        console.log(
          `[GEN] success — manifest=${assetManifestCid} sourceAsset=${sourceAssetCid}`,
        );

        // Record to micro-ledger
        appendEntry(
          createLedgerEntry({
            opType: "GENERATION",
            manifestId: manifest.asset_id,
            cid: assetManifestCid,
            prevCid: prevAssetManifestCid || null,
            actorAddress:
              req.body.walletAddress || res.locals.actorAddress || "system",
            payload: {
              prompt,
              provider: result.provider || provider || "mock",
              txHash: effectiveTxHash,
              nodeId,
              sourceAssetCid,
              ...(req.body.tier !== undefined &&
                req.body.tier !== null && {
                  tier: Number(req.body.tier),
                  tierName:
                    ["Basic", "Standard", "Premium", "Pro"][
                      Number(req.body.tier)
                    ] || "Unknown",
                }),
            },
          }),
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

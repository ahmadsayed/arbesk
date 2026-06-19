import express from "express";
import {
  CONTRACT_ADDRESS,
  API_URL,
  web3,
  getContractAddress,
  getWeb3,
} from "../../config.js";
import { mockGenerate } from "../adapters/mock-adapter.js";
import authenticate from "../authentication.js";
import rateLimit from "../rate-limiter.js";

import { getSceneNodes, bumpManifestVersion } from "../manifest-utils.js";

const Router = express.Router;
const usedTxHashes = new Set();

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
          txHash,
          provider,
          assetId,
          prevAssetManifestCid,
          transform_matrix,
          chainId,
        } = req.body;

        console.log(
          `[GEN] prompt="${prompt}" nodeId=${nodeId} tx=${txHash || res.locals.txHash || "none"} provider=${provider || "default"} chain=${chainId || "default"}`,
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
        const effectiveChainId = chainId || req.headers["x-chain-id"];
        const txWeb3 = effectiveChainId ? getWeb3(effectiveChainId) : web3;
        const contractAddr = getContractAddress(effectiveChainId);

        console.log(
          `[GEN] validating tx ${effectiveTxHash} on chain ${effectiveChainId || "default"} rpc=${txWeb3.currentProvider?.host || "?"} contract=${contractAddr}`,
        );
        const receipt = await txWeb3.eth.getTransactionReceipt(effectiveTxHash);
        if (!receipt || Number(receipt.status) !== 1) {
          console.log(
            `[GEN] tx validation failed — receipt=${!!receipt} status=${receipt ? receipt.status : "n/a"} to=${receipt?.to || "n/a"}`,
          );
          return res.status(403).json({
            error: {
              code: "INVALID_TRANSACTION",
              message: "Invalid or failed transaction",
            },
          });
        }
        console.log(
          `[GEN] tx ${effectiveTxHash} confirmed (block ${receipt.blockNumber}, to=${receipt.to})`,
        );

        // Verify the transaction interacted with the correct contract.
        // For direct calls: receipt.to === contract address.
        // For smart accounts / ERC-4337 / proxy wallets: receipt.to is the
        // intermediary, but the payment event must come from the contract.
        const nativeEventSig = txWeb3.utils.keccak256(
          "AssetGenerationPaid(address,bytes32,string,uint256,uint256)",
        );
        const usdcEventSig = txWeb3.utils.keccak256(
          "AssetGenerationPaidUSDC(address,bytes32,string,uint256,uint256,uint8)",
        );
        const freeEventSig = txWeb3.utils.keccak256(
          "AssetGenerationRecorded(address,bytes32,string,uint256,uint256)",
        );
        const contractAddrLower = contractAddr?.toLowerCase();
        const hasPaymentEvent = contractAddr
          ? receipt.logs.some(
              (log) =>
                (log.topics[0] === nativeEventSig ||
                  log.topics[0] === usdcEventSig ||
                  log.topics[0] === freeEventSig) &&
                log.address.toLowerCase() === contractAddrLower,
            )
          : false;

        if (
          contractAddr &&
          receipt.to &&
          receipt.to.toLowerCase() !== contractAddrLower &&
          !hasPaymentEvent
        ) {
          console.log(
            `[GEN] CONTRACT MISMATCH — receipt.to=${receipt.to} (not ${contractAddr}) and no payment event from contract`,
          );
          return res.status(403).json({
            error: {
              code: "WRONG_CONTRACT",
              message: "Transaction not sent to ArbeskAsset contract",
            },
          });
        }

        if (contractAddr && !hasPaymentEvent) {
          console.log("[GEN] payment event not found in tx logs");
          return res.status(403).json({
            error: {
              code: "EVENT_NOT_FOUND",
              message:
                "Transaction did not emit expected generation event (AssetGenerationPaid, AssetGenerationPaidUSDC, or AssetGenerationRecorded)",
            },
          });
        }
        if (contractAddr) {
          console.log("[GEN] payment event verified (native, USDC tiered, or free-tier recorded)");

          // If request specifies a tier, validate it against the on-chain event.
          // Native ETH payments (payForGeneration) do not encode tier on-chain,
          // so we only validate tier for USDC payments (payForGenerationWithUSDC).
          if (req.body.tier !== undefined && req.body.tier !== null) {
            const requestedTier = Number(req.body.tier);
            const usdcLog = receipt.logs.find(
              (log) =>
                log.topics[0] === usdcEventSig &&
                log.address.toLowerCase() === contractAddrLower,
            );
            if (usdcLog) {
              // Decode event data: (string prompt, uint256 amount, uint256 timestamp, uint8 tier)
              const decoded = txWeb3.eth.abi.decodeParameters(
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
            } else {
              // Native ETH payment — no tier on-chain, accept any tier value
              console.log(
                `[GEN] native ETH payment — tier ${requestedTier} accepted without on-chain validation`,
              );
            }
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

        usedTxHashes.add(effectiveTxHash);
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

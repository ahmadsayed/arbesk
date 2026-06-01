import { Router } from "express";
import Web3 from "web3";
import path from "path";
import url from "url";
import * as dotenv from "dotenv";
import MockAdapter from "../adapters/mock-adapter.js";
import authenticate from "../authentication.js";
import rateLimit from "../rate-limiter.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../blockchain/.env") });

const API_URL =
  process.env.API_URL || process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const web3 = new Web3(API_URL);

const mockAdapter = new MockAdapter();
const usedTxHashes = new Set();

function getSceneNodes(manifest) {
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];
  return manifest.scene.nodes;
}

export default function generateAssetNode(ipfs) {
  const router = Router();

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
          return res
            .status(400)
            .json({ error: "prompt and nodeId are required" });
        }

        const effectiveTxHash = txHash || res.locals.txHash;
        console.log(`[GEN] validating tx ${effectiveTxHash} on ${API_URL}`);
        const receipt = await web3.eth.getTransactionReceipt(effectiveTxHash);
        if (!receipt || Number(receipt.status) !== 1) {
          console.log(
            `[GEN] tx validation failed — receipt=${!!receipt} status=${receipt ? receipt.status : "n/a"}`,
          );
          return res
            .status(403)
            .json({ error: "Invalid or failed transaction" });
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
          return res
            .status(403)
            .json({ error: "Transaction not sent to ArbeskAsset contract" });
        }

        if (CONTRACT_ADDRESS) {
          const eventSignature = web3.utils.keccak256(
            "AssetGenerationPaid(address,bytes32,string,uint256,uint256)",
          );
          const hasEvent = receipt.logs.some(
            (log) =>
              log.topics[0] === eventSignature &&
              log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase(),
          );
          if (!hasEvent) {
            console.log("[GEN] event not found in tx logs");
            return res
              .status(403)
              .json({
                error: "Transaction did not emit expected payment event",
              });
          }
          console.log("[GEN] AssetGenerationPaid event verified");
        }

        if (usedTxHashes.has(effectiveTxHash)) {
          console.log(
            `[GEN] REPLAY detected — tx ${effectiveTxHash} already consumed`,
          );
          return res
            .status(409)
            .json({
              error: "REPLAY_DETECTED",
              message: "txHash already consumed",
            });
        }

        let result;
        if (process.env.MOCK_3D_GENERATION === "true") {
          console.log(`[GEN] using MOCK adapter for "${prompt}"`);
          result = await mockAdapter.generate(prompt);
          console.log(
            `[GEN] mock returned provider=${result.provider || "mock"} size=${result.data?.length || result.buffer?.length || "?"} bytes`,
          );
        } else {
          console.log("[GEN] cloud adapter not implemented — rejecting");
          return res
            .status(501)
            .json({ error: "Cloud adapters not yet implemented" });
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
            let data = "";
            for await (const file of ipfs.cat(prevAssetManifestCid)) {
              const buffer = new Uint16Array(file);
              buffer.forEach((code) => {
                data += String.fromCharCode(code);
              });
            }
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
            variants: [],
          };
          nodes.push(node);
        }

        const isReplayInVariants = nodes.some((n) =>
          (n.variants || []).some((entry) => entry.txHash === effectiveTxHash),
        );
        if (isReplayInVariants) {
          console.log(
            `[GEN] REPLAY detected in variants — tx ${effectiveTxHash}`,
          );
          return res
            .status(409)
            .json({
              error: "REPLAY_DETECTED",
              message: "txHash already in asset variants",
            });
        }

        node.variants ||= [];
        const nextVersion = node.variants.length + 1;
        const assetFormat = result.format || "gltf";
        const assetPath = result.path || `asset.${assetFormat}`;
        const source = {
          cid: sourceAssetCid,
          path: assetPath,
          format: assetFormat,
        };
        const variantEntry = {
          v: nextVersion,
          timestamp: Date.now(),
          type: "generation",
          provider: result.provider || provider || "mock",
          prompt,
          txHash: effectiveTxHash,
          source,
        };

        node.variants.push(variantEntry);
        node.source = source;
        manifest.version = (manifest.version || 0) + 1;
        manifest.timestamp = Date.now();
        manifest.prev_asset_manifest_cid = prevAssetManifestCid || null;

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
          `[GEN] success — manifest=${assetManifestCid} sourceAsset=${sourceAssetCid} variant_v=${variantEntry.v}`,
        );

        res.json({ assetManifestCid, variantEntry, sourceAssetCid });
      } catch (error) {
        console.error("[GEN] error:", error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );

  return router;
}

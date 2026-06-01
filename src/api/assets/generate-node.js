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
            return res.status(403).json({
              error: "Transaction did not emit expected payment event",
            });
          }
          console.log("[GEN] AssetGenerationPaid event verified");
        }

        if (usedTxHashes.has(effectiveTxHash)) {
          console.log(
            `[GEN] REPLAY detected — tx ${effectiveTxHash} already consumed`,
          );
          return res.status(409).json({
            error: "REPLAY_DETECTED",
            message: "txHash already consumed",
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
            },
          }),
        );

        res.json({ assetManifestCid, sourceAssetCid });
      } catch (error) {
        console.error("[GEN] error:", error.message);
        res.status(500).json({ error: error.message });
      }
    },
  );

  return router;
}

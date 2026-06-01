import { Router } from 'express';
import Web3 from 'web3';
import path from 'path';
import url from 'url';
import * as dotenv from 'dotenv';
import MockAdapter from './adapters/mock-adapter.js';
import authenticate from './authentication.js';
import rateLimit from './rate-limiter.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
dotenv.config({ path: __dirname + '/../../blockchain/.env' });

const API_URL = process.env.API_URL || process.env.HARDHAT_RPC_URL || 'http://127.0.0.1:8545';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const web3 = new Web3(API_URL);

const mockAdapter = new MockAdapter();

// In-memory replay prevention set
const usedTxHashes = new Set();

// Minimal ABI fragment for event decoding
const CONTRACT_ABI = [
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "address", "name": "userWallet", "type": "address" },
            { "indexed": true, "internalType": "bytes32", "name": "nodeId", "type": "bytes32" },
            { "indexed": false, "internalType": "string", "name": "prompt", "type": "string" },
            { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
        ],
        "name": "AssetGenerationPaid",
        "type": "event"
    }
];

export default function generateAssetNode(ipfs) {
    const router = Router();

    router.post('/', authenticate, rateLimit({ max: 10, windowMs: 60 * 60 * 1000 }), async (req, res) => {
        try {
            const { prompt, nodeId, txHash, provider, manifestId, prevManifestCid, transform_matrix } = req.body;
            console.log(`[GEN] prompt="${prompt}" nodeId=${nodeId} tx=${txHash || res.locals.txHash || 'none'} provider=${provider || 'default'}`);
            if (!prompt || !nodeId) {
                console.log(`[GEN] rejected — prompt and nodeId required`);
                return res.status(400).json({ error: 'prompt and nodeId are required' });
            }

            // 1. Validate txHash on-chain
            const effectiveTxHash = txHash || res.locals.txHash;
            console.log(`[GEN] validating tx ${effectiveTxHash} on ${API_URL}`);
            const receipt = await web3.eth.getTransactionReceipt(effectiveTxHash);
            if (!receipt || Number(receipt.status) !== 1) {
                console.log(`[GEN] tx validation failed — receipt=${!!receipt} status=${receipt ? receipt.status : 'n/a'}`);
                return res.status(403).json({ error: 'Invalid or failed transaction' });
            }
            console.log(`[GEN] tx ${effectiveTxHash} confirmed (block ${receipt.blockNumber})`);

            // 1a. Contract address validation
            if (CONTRACT_ADDRESS && receipt.to && receipt.to.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
                console.log(`[GEN] contract mismatch — receipt.to=${receipt.to} CONTRACT_ADDRESS=${CONTRACT_ADDRESS}`);
                return res.status(403).json({ error: 'Transaction not sent to ArbeskWorld contract' });
            }

            // 1b. Event log decoding (optional, only when contract address is configured)
            if (CONTRACT_ADDRESS) {
                const eventSignature = web3.utils.keccak256('AssetGenerationPaid(address,bytes32,string,uint256,uint256)');
                const hasEvent = receipt.logs.some(log =>
                    log.topics[0] === eventSignature &&
                    log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()
                );
                if (!hasEvent) {
                    console.log(`[GEN] event not found in tx logs`);
                    return res.status(403).json({ error: 'Transaction did not emit expected payment event' });
                }
                console.log(`[GEN] AssetGenerationPaid event verified`);
            }

            // 1c. Replay prevention (in-memory)
            if (usedTxHashes.has(effectiveTxHash)) {
                console.log(`[GEN] REPLAY detected — tx ${effectiveTxHash} already consumed`);
                return res.status(409).json({ error: 'REPLAY_DETECTED', message: 'txHash already consumed' });
            }

            // 2. Select adapter
            let result;
            if (process.env.MOCK_3D_GENERATION === 'true') {
                console.log(`[GEN] using MOCK adapter for "${prompt}"`);
                result = await mockAdapter.generate(prompt);
                console.log(`[GEN] mock returned provider=${result.provider || 'mock'} size=${result.data?.length || result.buffer?.length || '?'} bytes`);
            } else {
                console.log(`[GEN] cloud adapter not implemented — rejecting`);
                return res.status(501).json({ error: 'Cloud adapters not yet implemented' });
            }

            // 3. Upload to Private IPFS
            const assetPayload = result.data || result.buffer;
            console.log(`[IPFS] add asset | size=${assetPayload?.length || '?'} bytes`);
            const { cid: assetCid } = await ipfs.add(assetPayload);
            const assetCID = assetCid.toString();
            console.log(`[IPFS] add asset → ${assetCID}`);

            // 4. Read manifest if prevManifestCid provided
            let manifest = null;
            if (prevManifestCid) {
                try {
                    console.log(`[GEN] reading prev manifest ${prevManifestCid}`);
                    let data = '';
                    for await (const file of ipfs.cat(prevManifestCid)) {
                        const buffer = new Uint16Array(file);
                        buffer.forEach(code => { data += String.fromCharCode(code); });
                    }
                    manifest = JSON.parse(data);
                    console.log(`[GEN] prev manifest loaded — version=${manifest.version} nodes=${(manifest.nodes || []).length}`);
                } catch (e) {
                    console.warn(`[GEN] could not read prev manifest ${prevManifestCid}: ${e.message}`);
                }
            }

            // 5. Build or update manifest
            if (!manifest) {
                manifest = {
                    manifest_id: manifestId || `manifest_${Date.now()}`,
                    version: 0,
                    prev_manifest_cid: null,
                    nodes: []
                };
            }

            // Replace mode: reuse existing node to preserve history chain across generations
            let node;
            if (manifest.nodes.length > 0) {
                node = manifest.nodes[0];
                node.node_id = nodeId;
                node.source = null;
                if (Array.isArray(transform_matrix) && transform_matrix.length === 16) {
                    node.transform_matrix = transform_matrix;
                }
                manifest.nodes.length = 1;
            } else {
                node = {
                    node_id: nodeId,
                    source: null,
                    transform_matrix: Array.isArray(transform_matrix) && transform_matrix.length === 16
                        ? transform_matrix
                        : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                    history: []
                };
                manifest.nodes.push(node);
            }

            // 5b. Manifest history scan fallback for replay detection (server restart case)
            const isReplayInHistory = manifest.nodes.some(n =>
                n.history.some(entry => entry.txHash === effectiveTxHash)
            );
            if (isReplayInHistory) {
                console.log(`[GEN] REPLAY detected in history — tx ${effectiveTxHash}`);
                return res.status(409).json({ error: 'REPLAY_DETECTED', message: 'txHash already in manifest history' });
            }

            const nextVersion = node.history.length + 1;
            const assetFormat = result.format || 'gltf';
            const assetPath = result.path || `asset.${assetFormat}`;
            const historyEntry = {
                v: nextVersion,
                timestamp: Date.now(),
                src: {
                    cid: assetCID,
                    path: assetPath,
                    format: assetFormat
                },
                prompt: prompt,
                provider: result.provider || provider || 'mock',
                txHash: effectiveTxHash,
                type: 'generation'
            };

            node.history.push(historyEntry);
            node.source = {
                cid: assetCID,
                path: assetPath,
                format: assetFormat
            };
            manifest.version += 1;
            manifest.prev_manifest_cid = prevManifestCid || null;

            // 6. Write manifest to IPFS
            console.log(`[IPFS] add manifest | version=${manifest.version} nodes=${manifest.nodes.length}`);
            const { cid: newManifestCid } = await ipfs.add(JSON.stringify(manifest));
            const newManifestCidStr = newManifestCid.toString();
            console.log(`[IPFS] add manifest → ${newManifestCidStr}`);

            // Mark txHash as used
            usedTxHashes.add(effectiveTxHash);
            console.log(`[GEN] success — manifest=${newManifestCidStr} asset=${assetCID} history_v=${historyEntry.v}`);

            // 7. Respond
            res.json({
                newManifestCid: newManifestCidStr,
                historyEntry,
                assetCID
            });
        } catch (error) {
            console.error('[GEN] error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

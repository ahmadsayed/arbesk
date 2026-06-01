/**
 * Arbesk API Service
 *
 * Centralized frontend API client with auth signing, generation,
 * parametric version saving, and standardized error handling.
 */

import { web3 } from '../blockchain/wallet.js';

/**
 * Custom API error with status and backend error code.
 */
export class ApiError extends Error {
    constructor(message, status, code = null) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'ApiError';
    }
}

/**
 * Sign a txHash and produce the Bearer token format the backend expects.
 * @param {string} txHash — e.g. "0xabc..."
 * @returns {Promise<string>} Bearer token: "<base64msg>.<base64sig>"
 */
export async function signTxHash(txHash) {
    if (!web3 || !window.walletAddress) {
        throw new ApiError('Wallet not connected', 401, 'WALLET_NOT_CONNECTED');
    }

    const message = `txHash:${txHash}`;
    const msgB64 = btoa(message);

    try {
        const signature = await web3.eth.personal.sign(
            message,
            window.walletAddress,
            '' // password empty for MetaMask/Rabby
        );
        const sigB64 = btoa(signature);
        return `${msgB64}.${sigB64}`;
    } catch (err) {
        console.error('Sign failed:', err);
        throw new ApiError('Failed to sign authentication message', 401, 'SIGN_FAILED');
    }
}

/**
 * POST /api/assets/generate-node
 * @param {Object} params
 * @returns {Promise<{assetManifestCid, variantEntry, sourceAssetCid}>}
 */
export async function generateAsset({
    prompt,
    nodeId,
    txHash,
    provider = 'mock',
    assetId,
    prevAssetManifestCid,
    transformMatrix
}) {
    const authToken = await signTxHash(txHash);

    const body = {
        prompt,
        nodeId,
        txHash,
        provider,
        ...(assetId && { assetId }),
        ...(prevAssetManifestCid && { prevAssetManifestCid }),
        ...(transformMatrix && { transform_matrix: transformMatrix })
    };

    const response = await fetch('/api/assets/generate-node', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new ApiError(
            data.error || `Generation failed (HTTP ${response.status})`,
            response.status,
            data.error
        );
    }

    return data;
}

/**
 * POST /api/assets/save-variant
 * @param {Object} body
 * @returns {Promise<{assetManifestCid, variantEntry}>}
 */
export async function saveParametricVersion(body) {
    const response = await fetch('/api/assets/save-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new ApiError(
            data.error || `Save failed (HTTP ${response.status})`,
            response.status,
            data.error
        );
    }

    return data;
}

/**
 * GET /api/contract_address
 * @returns {Promise<string|null>}
 */
export async function getContractAddress() {
    try {
        const res = await fetch('/api/contract_address');
        const data = await res.json();
        return data.contract_address || null;
    } catch {
        return null;
    }
}

/**
 * GET /abi/ArbeskAsset.json
 * @returns {Promise<Object|null>} Full Hardhat artifact
 */
export async function getContractArtifact() {
    try {
        const res = await fetch('/api/abi/ArbeskAsset.json');
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

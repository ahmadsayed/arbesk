/**
 * Arbesk Team / Editor Management Service
 *
 * Wraps contract calls for listing, adding, and removing asset editors.
 */

import { contract, web3 } from '../blockchain/wallet.js';

/**
 * List editors for a token.
 * @param {string|number} tokenId
 * @returns {Promise<string[]>}
 */
export async function fetchEditors(tokenId) {
    if (!contract) return [];
    try {
        return await contract.methods.listEditors(tokenId).call();
    } catch (err) {
        // Silently return empty list — token may not exist or network may be wrong.
        // MetaMask logs its own RPC errors; we don't need to duplicate them.
        return [];
    }
}

/**
 * Check if the connected wallet owns the token.
 * @param {string|number} tokenId
 * @returns {Promise<boolean>}
 */
export async function isOwner(tokenId) {
    if (!contract || !window.walletAddress) return false;
    try {
        const owner = await contract.methods.ownerOf(tokenId).call();
        return owner.toLowerCase() === window.walletAddress.toLowerCase();
    } catch {
        return false;
    }
}

/**
 * Add an editor to a token.
 * @param {string|number} tokenId
 * @param {string} address
 * @returns {Promise<string|null>} txHash
 */
export async function addTeamMember(tokenId, address) {
    if (!contract || !window.walletAddress) {
        throw new Error('Wallet or contract not ready');
    }

    if (!web3.utils.isAddress(address)) {
        throw new Error('Invalid Ethereum address');
    }

    const tx = contract.methods.addEditor(tokenId, address);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
        from: window.walletAddress,
        gas: Math.floor(Number(gas) * 1.2)
    });
    return receipt.transactionHash;
}

/**
 * Remove an editor from a token.
 * @param {string|number} tokenId
 * @param {string} address
 * @returns {Promise<string|null>} txHash
 */
export async function removeTeamMember(tokenId, address) {
    if (!contract || !window.walletAddress) {
        throw new Error('Wallet or contract not ready');
    }

    const tx = contract.methods.removeEditor(tokenId, address);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
        from: window.walletAddress,
        gas: Math.floor(Number(gas) * 1.2)
    });
    return receipt.transactionHash;
}

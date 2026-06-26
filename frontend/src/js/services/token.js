// @ts-nocheck
/**
 * Arbesk Token Service
 *
 * Service layer for blockchain token operations.
 * Wraps contract calls to provide a clean abstraction for UI components.
 */

import { contract } from "../blockchain/wallet.js";
import { walletState } from "../state/wallet-state.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

/**
 * Fetch the tokenURI (collection manifest CID) for a token.
 * @param {string|number} tokenId - Token ID
 * @returns {Promise<string|null>} Collection manifest CID or null
 */
export async function getTokenURI(tokenId) {
  try {
    const c = contract || walletState.get().contract;
    if (!c) return null;
    const cid = await c.methods.tokenURI(String(tokenId)).call();
    return cid || null;
  } catch (err) {
    console.warn(`[TOKEN] failed to get tokenURI for ${tokenId}:`, err.message);
    return null;
  }
}

/**
 * Fetch the owner of a token.
 * @param {string|number} tokenId - Token ID
 * @returns {Promise<string|null>} Owner address or null
 */
export async function getOwnerOf(tokenId) {
  try {
    const c = contract || walletState.get().contract;
    if (!c) return null;
    const owner = await c.methods.ownerOf(String(tokenId)).call();
    return owner || null;
  } catch (err) {
    // ERC721NonexistentToken is thrown when token doesn't exist
    return null;
  }
}

/**
 * Check if a token exists on-chain.
 * @param {string|number} tokenId - Token ID
 * @returns {Promise<boolean>} True if token exists
 */
export async function tokenExists(tokenId) {
  const owner = await getOwnerOf(tokenId);
  return owner !== null;
}

/**
 * Fetch the asset name for a token by resolving tokenURI → manifest → name.
 * @param {string|number} tokenId - Token ID
 * @returns {Promise<string|null>} Asset name or null
 */
export async function getAssetName(tokenId) {
  try {
    const cid = await getTokenURI(tokenId);
    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return manifest.name || null;
  } catch {
    return null;
  }
}

/**
 * Fetch the collection manifest for a token.
 * @param {string|number} tokenId - Token ID
 * @returns {Promise<object|null>} Collection manifest or null
 */
export async function getCollectionManifest(tokenId) {
  try {
    const cid = await getTokenURI(tokenId);
    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return manifest || null;
  } catch {
    return null;
  }
}

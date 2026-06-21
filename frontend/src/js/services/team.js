/**
 * Arbesk Team / Editor Management Service — Merkle Architecture
 *
 * Editor list is stored on IPFS; on-chain only has the Merkle root.
 * All reads go through IPFS (with localStorage cache fallback).
 * All writes go through updateEditors (Merkle root update).
 */

import { contract } from "../blockchain/wallet.js";
import { walletState } from "../state/wallet-state.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

/**
 * List editors for a token from IPFS (with localStorage cache fallback).
 * @param {string|number} tokenId
 * @returns {Promise<Array<{address: string, role: number}>>}
 */
export async function fetchEditors(tokenId) {
  if (!tokenId) return [];

  // Try localStorage first
  try {
    const key = `arbesk_editor_list_${tokenId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cid) {
        try {
          const fresh = await getFromRemoteIPFS(parsed.cid);
          if (Array.isArray(fresh)) return fresh;
        } catch {
          /* use cached */
        }
      }
      if (Array.isArray(parsed.list)) return parsed.list;
    }
  } catch {
    /* unavailable */
  }

  return [];
}

/**
 * Check if the connected wallet owns the token.
 * @param {string|number} tokenId
 * @returns {Promise<boolean>}
 */
export async function isOwner(tokenId) {
  if (!contract || !walletState.get().walletAddress) return false;
  try {
    const owner = await contract.methods.ownerOf(tokenId).call();
    return (
      owner.toLowerCase() === walletState.get().walletAddress.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Arbesk Token Service
 *
 * Service layer for blockchain token operations.
 * Wraps contract calls to provide a clean abstraction for UI components.
 */

import { getActiveContract } from "../blockchain/wallet.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";

/**
 * Fetch the tokenURI (collection manifest CID) for a token.
 * @returns Collection manifest CID or null
 */
export async function getTokenURI(tokenId: string | number): Promise<string | null> {
  try {
    const c = getActiveContract();
    if (!c) return null;
    const cid = await c.methods.tokenURI(String(tokenId)).call();
    return cid || null;
  } catch (err) {
    console.warn(`[TOKEN] failed to get tokenURI for ${tokenId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch the owner of a token.
 * @returns Owner address or null
 */
export async function getOwnerOf(tokenId: string | number): Promise<string | null> {
  try {
    const c = getActiveContract();
    if (!c) return null;
    const owner = await c.methods.ownerOf(String(tokenId)).call();
    return owner || null;
  } catch {
    // ERC721NonexistentToken is thrown when token doesn't exist
    return null;
  }
}

/**
 * Check if a token exists on-chain.
 * @returns True if token exists
 */
export async function tokenExists(tokenId: string | number): Promise<boolean> {
  const owner = await getOwnerOf(tokenId);
  return owner !== null;
}

/**
 * Fetch the asset name for a token by resolving tokenURI → manifest → name.
 * @returns Asset name or null
 */
export async function getAssetName(tokenId: string | number): Promise<string | null> {
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
 * @returns Collection manifest or null
 */
export async function getCollectionManifest(tokenId: string | number): Promise<object | null> {
  try {
    const cid = await getTokenURI(tokenId);
    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return manifest || null;
  } catch {
    return null;
  }
}

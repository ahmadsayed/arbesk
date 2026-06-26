/**
 * Arbesk Team / Editor Management Service — Merkle Architecture
 *
 * Editor list is stored on IPFS; on-chain only has the Merkle root.
 * All reads go through IPFS (with localStorage cache fallback).
 * All writes go through updateEditors (Merkle root update).
 */

import { contract, updateEditors } from "../blockchain/wallet.js";
import { walletState } from "../state/wallet-state.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { computeRoot, getProof } from "../gltf/merkle-editors.js";
import { requireWallet } from "../blockchain/wallet-guard.js";

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";
export const CollaboratorRole = Object.freeze({
  None: 0,
  Viewer: 1,
  Editor: 2,
});

/**
 * List editors for a token from IPFS (with localStorage cache fallback).
 * @param {string|number} tokenId
 * @returns {Promise<Array<{address: string, role: number}>>}
 */
export async function fetchEditors(tokenId) {
  if (!tokenId) return [];

  // Authoritative source: the editor list CID stored on-chain is updated
  // atomically whenever editorSetVersion bumps, so it is always in sync with
  // the current Merkle root. Use this for proof generation and mutations.
  try {
    const c = contract || walletState.get().contract;
    if (c) {
      const cid = await c.methods.editorListURI(tokenId).call();
      if (cid) {
        const fresh = await getFromRemoteIPFS(cid);
        if (Array.isArray(fresh)) {
          _saveEditorListLocally(tokenId, fresh, cid);
          return fresh;
        }
      }
    }
  } catch (err) {
    console.warn(
      `[TEAM] failed to load editor list from chain for ${tokenId}:`,
      err.message
    );
  }

  // Fallback: localStorage cache (may be stale, but better than nothing when
  // the chain or IPFS is unreachable).
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

function _editorListKey(tokenId) {
  return EDITOR_LIST_PREFIX + tokenId;
}

function _saveEditorListLocally(tokenId, list, cid) {
  try {
    localStorage.setItem(
      _editorListKey(tokenId),
      JSON.stringify({ list, cid: cid || null, saved: Date.now() })
    );
  } catch (e) {
    console.warn("[TEAM] failed to cache editor list locally:", e.message);
  }
  return cid || "";
}

async function _getEditorSetVersion(tokenId) {
  if (!contract) return 1;
  try {
    const version = await contract.methods.editorSetVersion(tokenId).call();
    return Number(version);
  } catch {
    return 1;
  }
}

/** Export for use by asset-save.js */
export {
  _getEditorSetVersion as getEditorSetVersion,
  _saveEditorListLocally as saveEditorListLocally,
};

function _normalizeAddress(address) {
  if (!address || typeof address !== "string" || !address.startsWith("0x")) {
    throw new Error("Invalid Ethereum address");
  }
  return address.toLowerCase();
}

async function _updateEditorRoot(tokenId, oldEditors, newEditors) {
  const { walletAddress } = requireWallet();

  const currentVersion = await _getEditorSetVersion(tokenId);
  const nextVersion = currentVersion + 1;
  const newRoot = computeRoot(newEditors, tokenId, nextVersion);

  // Proof must be built against the CURRENT editor tree/version.
  const proofResult = getProof(
    oldEditors,
    walletAddress,
    tokenId,
    currentVersion
  );
  if (!proofResult) {
    throw new Error("Current wallet is not an editor of this token");
  }

  const listCid = await writeJSONToIPFS(newEditors, null, {
    compress: true,
    type: "editors",
    assetId: `token_${tokenId}_v${nextVersion}`,
  });
  _saveEditorListLocally(tokenId, newEditors, listCid);

  const txHash = await updateEditors(
    tokenId,
    newRoot,
    listCid,
    proofResult.role,
    proofResult.proof
  );
  if (!txHash) {
    throw new Error("updateEditors transaction failed");
  }
  return txHash;
}

/**
 * Add a new editor to a token. Caller must already be an editor.
 * @param {string|number} tokenId
 * @param {string} address
 * @returns {Promise<string>} transaction hash
 */
export async function addTeamMember(tokenId, address) {
  const normalized = _normalizeAddress(address);
  const editors = await fetchEditors(tokenId);

  if (editors.some((e) => e.address.toLowerCase() === normalized)) {
    throw new Error("Address is already an editor");
  }

  const nextEditors = [
    ...editors,
    { address: normalized, role: CollaboratorRole.Editor },
  ];
  return _updateEditorRoot(tokenId, editors, nextEditors);
}

/**
 * Remove an editor from a token. Caller must already be an editor.
 * @param {string|number} tokenId
 * @param {string} address
 * @returns {Promise<string>} transaction hash
 */
export async function removeTeamMember(tokenId, address) {
  const normalized = _normalizeAddress(address);
  const editors = await fetchEditors(tokenId);

  const nextEditors = editors.filter(
    (e) => e.address.toLowerCase() !== normalized
  );
  if (nextEditors.length === editors.length) {
    throw new Error("Address is not an editor");
  }
  if (nextEditors.length === 0) {
    throw new Error("Cannot remove the last editor");
  }

  return _updateEditorRoot(tokenId, editors, nextEditors);
}

/**
 * Change the role of an existing team member.
 * @param {string|number} tokenId
 * @param {string} address
 * @param {number} newRole
 * @returns {Promise<string>} transaction hash
 */
export async function changeTeamMemberRole(tokenId, address, newRole) {
  const normalized = _normalizeAddress(address);
  const editors = await fetchEditors(tokenId);

  if (!editors.some((e) => e.address.toLowerCase() === normalized)) {
    throw new Error("Address is not a collaborator");
  }

  const nextEditors = editors.map((e) =>
    e.address.toLowerCase() === normalized ? { ...e, role: newRole } : e
  );
  return _updateEditorRoot(tokenId, editors, nextEditors);
}

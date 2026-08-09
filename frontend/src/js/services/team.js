// @ts-nocheck
/**
 * Arbesk Team / Editor Management Service - Merkle Architecture
 *
 * Editor list is stored on IPFS; on-chain only has the Merkle root.
 * All reads go through IPFS (with localStorage cache fallback).
 * All writes go through updateEditors (Merkle root update).
 */

import { contract, updateEditors } from "../blockchain/wallet.js";
import { walletState } from "../state/wallet-state.js";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.js";
import { computeRoot, getProof, MAX_EDITORS_PER_TOKEN } from "../gltf/merkle-editors.js";
import {
  loadEditorList,
  saveEditorList,
  getEditorSetVersion,
} from "../domain/editors.js";
import { requireWallet } from "../blockchain/wallet-guard.js";
import { resolveUserEmail } from "./api.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  return loadEditorList(tokenId);
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

/** Export for use by asset-save.js */
export { getEditorSetVersion, saveEditorList as saveEditorListLocally };

function _normalizeAddress(address) {
  if (!address || typeof address !== "string" || !address.startsWith("0x")) {
    throw new Error("Invalid Ethereum address");
  }
  return address.toLowerCase();
}

async function _updateEditorRoot(tokenId, oldEditors, newEditors) {
  const { walletAddress } = requireWallet();

  const currentVersion = await getEditorSetVersion(tokenId);
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
  saveEditorList(tokenId, newEditors, listCid);

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
 * Resolve the "add collaborator" input to a wallet address.
 *
 * Accepts either a 0x address (returned as-is) or the full email of a CDP
 * email-login user, resolved to their smart account address via the backend.
 * Exact email match only — the backend never lists or autocompletes emails.
 *
 * @param {string} input - raw input field value
 * @returns {Promise<string>} wallet/smart account address to add
 * @throws {Error} user-friendly message when the input cannot be resolved
 */
export async function resolveCollaboratorInput(input) {
  const value = (input || "").trim();
  if (value.startsWith("0x")) return value;

  if (EMAIL_RE.test(value)) {
    let result;
    try {
      result = await resolveUserEmail(value);
    } catch (err) {
      if (err?.code === "CDP_NOT_CONFIGURED" || err?.status === 503) {
        throw new Error("Email lookup is not available on this server");
      }
      throw err;
    }
    if (!result.exists) {
      throw new Error(
        "No Arbesk account found for this email — the user must sign in at least once before they can be added"
      );
    }
    if (!result.address) {
      throw new Error(
        "This account has no smart wallet yet and cannot be added as a collaborator"
      );
    }
    return result.address;
  }

  throw new Error("Enter a wallet address (0x…) or an email");
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

  if (editors.length >= MAX_EDITORS_PER_TOKEN) {
    throw new Error(
      `Editor limit reached (maximum ${MAX_EDITORS_PER_TOKEN} members)`
    );
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

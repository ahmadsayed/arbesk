/**
 * Arbesk Team / Editor Management Service - Merkle Architecture
 *
 * Editor list is stored on IPFS; on-chain only has the Merkle root.
 * All reads go through IPFS (with localStorage cache fallback).
 * All writes go through updateEditors (Merkle root update).
 */

import * as wallet from "../blockchain/wallet.ts";
import { walletState } from "../state/wallet-state.ts";
import { writeJSONToIPFS } from "../ipfs/write-to-ipfs.ts";
import { computeRoot, getProof, MAX_EDITORS_PER_TOKEN } from "../asset-core/gltf/merkle-editors.ts";
import {
  loadEditorList,
  saveEditorList,
  getEditorSetVersion,
} from "../asset-core/domain/editors.ts";
import type { EditorEntry } from "../asset-core/domain/editors.ts";
import { requireWallet } from "../blockchain/wallet-guard.ts";
import { resolveUserEmail } from "./api.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Return the normalized email when a collaborator input is an email address,
 * undefined for 0x addresses and other input. Used to tag editor entries
 * with their invite email for display.
 */
export function collaboratorInputEmail(input: string): string | undefined {
  const value = (input || "").trim();
  return EMAIL_RE.test(value) ? value.toLowerCase() : undefined;
}

export const CollaboratorRole = Object.freeze({
  None: 0,
  Viewer: 1,
  Editor: 2,
});

/**
 * List editors for a token from IPFS (with localStorage cache fallback).
 */
export async function fetchEditors(tokenId: string | number): Promise<EditorEntry[]> {
  return loadEditorList(tokenId as string);
}

/**
 * Check if the connected wallet owns the token.
 */
export async function isOwner(tokenId: string | number): Promise<boolean> {
  if (!wallet.contract || !walletState.get().walletAddress) return false;
  try {
    const owner = await wallet.contract.methods.ownerOf(tokenId).call();
    return (
      owner.toLowerCase() ===
        (walletState.get().walletAddress as string).toLowerCase()
    );
  } catch {
    return false;
  }
}

/** Export for use by asset-save.js */
export { getEditorSetVersion, saveEditorList as saveEditorListLocally };

function _normalizeAddress(address: string): string {
  if (!address || typeof address !== "string" || !address.startsWith("0x")) {
    throw new Error("Invalid Ethereum address");
  }
  return address.toLowerCase();
}

async function _updateEditorRoot(
  tokenId: string | number,
  oldEditors: EditorEntry[],
  newEditors: EditorEntry[]
): Promise<string> {
  const { walletAddress } = requireWallet();

  const currentVersion = await getEditorSetVersion(tokenId as string);
  const nextVersion = currentVersion + 1;
  const newRoot = computeRoot(newEditors, tokenId as string, nextVersion);

  // Proof must be built against the CURRENT editor tree/version.
  const proofResult = getProof(
    oldEditors,
    walletAddress,
    tokenId as string,
    currentVersion
  );
  if (!proofResult) {
    throw new Error("Current wallet is not an editor of this token");
  }

  const listCid = await writeJSONToIPFS(newEditors, null as any, {
    compress: true,
    type: "editors",
    assetId: `token_${tokenId}_v${nextVersion}`,
  });
  saveEditorList(tokenId as string, newEditors, listCid);

  const txHash = await wallet.updateEditors(
    tokenId as string,
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
 * @param input - raw input field value
 * @returns wallet/smart account address to add
 * @throws {Error} user-friendly message when the input cannot be resolved
 */
export async function resolveCollaboratorInput(input: string): Promise<string> {
  const value = (input || "").trim();
  if (value.startsWith("0x")) return value;

  if (EMAIL_RE.test(value)) {
    let result;
    try {
      result = await resolveUserEmail(value);
    } catch (err) {
      const apiErr = err as any;
      if (apiErr?.code === "CDP_NOT_CONFIGURED" || apiErr?.status === 503) {
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
 * @param email - invite email for CDP email-login users (display only)
 * @returns transaction hash
 */
export async function addTeamMember(tokenId: string | number, address: string, email?: string): Promise<string> {
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
    { address: normalized, role: CollaboratorRole.Editor, ...(email ? { email } : {}) },
  ];
  return _updateEditorRoot(tokenId, editors, nextEditors);
}

/**
 * Remove an editor from a token. Caller must already be an editor.
 * @returns transaction hash
 */
export async function removeTeamMember(tokenId: string | number, address: string): Promise<string> {
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
 * @returns transaction hash
 */
export async function changeTeamMemberRole(tokenId: string | number, address: string, newRole: number): Promise<string> {
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

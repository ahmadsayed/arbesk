/**
 * Asset publishing, tokenURI updates, Merkle editor management, role-based
 * collaboration, and token burn.
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { getContractArtifact, relayWrite } from "../services/backend-client.ts";
import { showToast } from "../ui/toasts.ts";
import { isIpfsCidReachable } from "../ipfs/remote-ipfs.ts";
import { getActiveConnectionSource, getActiveContract } from "./wallet-core.ts";
import { isSmartWalletSupported } from "./smart-wallet-support.ts";
import { sendContractCall } from "./wallet-send.ts";

/** bytes32(0) — collection-wide editor-grant scope (see #50). */
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// ── Helpers ──

function _canPublishWithCurrentWallet() {
  const source = getActiveConnectionSource();
  const chainId = walletState.get().chainId;
  if (source === "cdp" && !isSmartWalletSupported(chainId)) {
    showToast({
      type: "warning",
      title: "Smart Wallet Not Supported",
      message:
        "CDP email smart wallets are only supported on Base Sepolia. Please switch to Base Sepolia in the network dropdown, or connect with an EOA wallet (MetaMask/Rabby) to publish on other networks.",
      duration: 0,
    });
    return false;
  }
  return true;
}

/**
 * Resolves the active contract and verifies a wallet is connected and allowed
 * to publish; returns null when not ready.
 */
function _readyContract() {
  const c = getActiveContract();
  if (!walletState.get().walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }
  if (!_canPublishWithCurrentWallet()) return null;
  return c;
}

/**
 * Writes through the backend relay for CDP (email) sessions (no browser tx).
 * @returns { handled, txHash }; when not CDP, handled=false and the caller
 *   falls through to the EOA browser-transaction path.
 */
async function _relayForCdp(
  op: "publish" | "updateUri" | "updateEditors" | "burn",
  tokenId: number | string,
  params: Record<string, unknown>,
): Promise<{ handled: boolean; txHash: string | null }> {
  if (getActiveConnectionSource() !== "cdp") return { handled: false, txHash: null };
  try {
    const receipt = await relayWrite(op, tokenId, params);
    return { handled: true, txHash: (receipt as any)?.transactionHash ?? null };
  } catch (error) {
    const msg = (error as any)?.message || "Relay failed";
    showToast({ type: "error", title: "Write Failed", message: msg });
    return { handled: true, txHash: null };
  }
}

// ── Asset Publishing ──

/**
 * @returns txHash on success, null on failure.
 */
async function publishAsset(
  tokenURI: string,
  tokenId: number | string,
  editorRoot: string,
  editorListUri: string
) {
  const c = _readyContract();
  if (!c) return null;

  const relayed = await _relayForCdp("publish", tokenId, {
    uri: tokenURI,
    editorRoot,
    editorListUri,
  });
  if (relayed.handled) {
    if (relayed.txHash) {
      emit(EVENTS.ASSET_PUBLISHED, { tokenId, tokenURI, txHash: relayed.txHash });
    }
    return relayed.txHash;
  }

  try {
    const receipt = await sendContractCall({
      to: walletState.get().contractAddress,
      abi: c.abi,
      functionName: "publishAsset(string,uint256,bytes32,string)",
      args: [tokenURI, BigInt(tokenId), editorRoot, editorListUri],
      pendingPayload: { tokenId, tokenURI },
    });

    emit(EVENTS.ASSET_PUBLISHED, {
      tokenId,
      tokenURI,
      txHash: receipt.transactionHash,
    });

    return receipt.transactionHash;
  } catch (error) {
    console.error("publishAsset failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.ts");
    const contractAbi =
      (/** @type {any} */ (await getContractArtifact("ArbeskAssetFree")))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);
    showToast({
      type: "error",
      title: "Publish Failed",
      message: decodedMsg,
    });
    return null;
  }
}

/**
 * @returns txHash on success, null on failure.
 */
async function updateAssetURI(
  tokenId: number | string,
  newTokenURI: string,
  proof: string[],
  assetScope: string = ZERO_HASH,
  assetId: string | null = null
) {
  const c = _readyContract();
  if (!c) return null;

  const relayed = await _relayForCdp("updateUri", tokenId, { newUri: newTokenURI, proof, assetScope, assetId });
  if (relayed.handled) {
    _notifyUriChanged(tokenId, newTokenURI, relayed.txHash, assetId);
    return relayed.txHash;
  }

  try {
    const receipt = await sendContractCall({
      to: walletState.get().contractAddress,
      abi: c.abi,
      functionName: "updateAssetURI(uint256,string,bytes32,bytes32[])",
      args: [BigInt(tokenId), newTokenURI, assetScope, proof],
      pendingPayload: { tokenId, tokenURI: newTokenURI },
    });
    _notifyUriChanged(tokenId, newTokenURI, receipt.transactionHash, assetId);
    return receipt.transactionHash;
  } catch (error) {
    console.error("updateAssetURI failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.ts");
    const contractAbi =
      (/** @type {any} */ (await getContractArtifact("ArbeskAssetFree")))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);

    const msg = (error as any).message || "";
    if (
      msg.includes("User denied") ||
      msg.includes("rejected") ||
      (error as any).code === 4001
    ) {
      return null;
    }

    throw new Error(decodedMsg);
  }
}

function _notifyUriChanged(tokenId: number | string, newTokenURI: string, txHash: string | null, assetId: string | null = null) {
  emit(EVENTS.ASSET_URI_CHANGED, {
    chainId: walletState.get().chainId,
    contractAddress: walletState.get().contractAddress,
    tokenId: String(tokenId),
    assetId: assetId ?? null,
    newAssetURI: newTokenURI,
    txHash,
  });
}

// ── Merkle Editor Management ──

/**
 * CollaboratorRole enum values matching the Solidity contract.
 */
const CollaboratorRole = Object.freeze({
  None: 0,
  Viewer: 1,
  Editor: 2,
});

/**
 * Replaces the entire editor set with a new Merkle root.
 * @remarks Caller must be a current Editor (proved via callerProof).
 * @param newRoot - bytes32 hex string: the new Merkle root.
 * @param newListUri - IPFS URI of the new editor list.
 * @param callerRole - CollaboratorRole.Editor (2).
 * @param callerProof - Merkle proof for the caller.
 * @returns txHash on success.
 */
async function updateEditors(
  tokenId: number | string,
  newRoot: string,
  newListUri: string,
  callerRole: number,
  callerProof: string[]
) {
  const c = _readyContract();
  if (!c) return null;

  const relayed = await _relayForCdp("updateEditors", tokenId, {
    newRoot,
    newListUri,
    callerRole,
    callerProof,
  });
  if (relayed.handled) return relayed.txHash;

  try {
    const receipt = await sendContractCall({
      to: walletState.get().contractAddress,
      abi: c.abi,
      functionName: "updateEditors(uint256,bytes32,string,uint8,bytes32[])",
      args: [BigInt(tokenId), newRoot, newListUri, callerRole, callerProof],
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("updateEditors failed:", error);
    return null;
  }
}

// ── Token Burn ──

/**
 * @returns txHash on success, null on failure.
 */
async function burn(tokenId: number | string, proof: string[]) {
  const c = _readyContract();
  if (!c) return null;

  // Resolve manifest CID before burning (after burn, tokenURI may revert)
  let manifestCid = null;
  try {
    manifestCid = await c.read.tokenURI([BigInt(tokenId)]);
    console.log(
      `[BURN] token ${tokenId} manifest CID → ${manifestCid || "none"}`
    );
  } catch (e) {
    console.warn(
      `[BURN] could not resolve manifest CID for token ${tokenId}:`,
      (e as Error).message
    );
    // Continue with burn even if resolution fails - unpin is best-effort
  }

  // Unpin IPFS content BEFORE the burn tx: the backend /ipfs/unpin endpoint
  // verifies ownership/editor rights on-chain, which requires the token to
  // still be live. Strictly best-effort - any failure (including 403) only
  // warns and never blocks or alters the burn.
  if (manifestCid) {
    try {
      const reachable = await isIpfsCidReachable(manifestCid).catch(
        () => false
      );
      if (!reachable) {
        console.warn(
          `[BURN] ${manifestCid} not reachable on IPFS, skipping unpin`
        );
      } else {
        console.log(`[BURN] unpinning IPFS content for ${manifestCid}…`);
        const { unpinAssetCids } = await import("../services/backend-client.ts");
        const { chainId, contractAddress } = walletState.get();
        const result = await unpinAssetCids(manifestCid, {
          tokenId: String(tokenId),
          chainId: Number(chainId),
          contractAddress,
          proof,
        });
        console.log(
          `[BURN] unpinned ${result.count} CIDs for token ${tokenId}`
        );
        if (result.errors?.length)
          console.warn(`[BURN] unpin errors:`, result.errors);
      }
    } catch (err) {
      console.warn(`[BURN] unpin failed (non-fatal):`, (err as Error).message);
    }
  }

  const relayedBurn = await _relayForCdp("burn", tokenId, { proof });
  if (relayedBurn.handled) {
    if (relayedBurn.txHash) {
      emit(EVENTS.ASSET_BURNED, { tokenId, txHash: relayedBurn.txHash });
    }
    return relayedBurn.txHash;
  }

  try {
    const receipt = await sendContractCall({
      to: walletState.get().contractAddress,
      abi: c.abi,
      functionName: "burn(uint256,bytes32[])",
      args: [BigInt(tokenId), proof],
    });

    emit(EVENTS.ASSET_BURNED, {
      tokenId,
      txHash: receipt.transactionHash,
    });

    return receipt.transactionHash;
  } catch (error) {
    console.error("burn failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.ts");
    const contractAbi =
      (/** @type {any} */ (await getContractArtifact("ArbeskAssetFree")))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);
    showToast({
      type: "error",
      title: "Burn Failed",
      message: decodedMsg,
    });
    return null;
  }
}

// ── Exports ──
export {
  publishAsset,
  updateAssetURI,
  updateEditors,
  burn,
  CollaboratorRole,
};

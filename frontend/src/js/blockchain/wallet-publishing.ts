/**
 * Arbesk Wallet Publishing
 *
 * Asset publishing, tokenURI updates, Merkle editor management,
 * role-based collaboration, and token burn.
 *
 * Extracted from wallet.js to isolate publish-side functions.
 */

import { emit, EVENTS } from "../asset-core/events/bus.ts";
import { walletState } from "../state/wallet-state.ts";
import { getContractArtifact } from "../services/api.ts";
import { showToast } from "../ui/toasts.ts";
import { isIpfsCidReachable } from "../ipfs/remote-ipfs.ts";
import { web3, getActiveConnectionSource, getActiveContract } from "./wallet-core.ts";
import { isSmartWalletSupported } from "./smart-wallet-support.ts";
import { resolveGas } from "./wallet-gas.ts";

// ── Helpers ──

function _getWeb3() {
  return web3 || window.web3 || null;
}

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

// ── Asset Publishing ──

/**
 * Send a contract transaction optimistically: emit ASSET_PUBLISH_PENDING as
 * soon as the wallet broadcasts a transaction hash (EOA PromiEvent), then
 * still await the mined receipt for the authoritative result. Callers keep
 * their receipt-based flow unchanged.
 * @param {*} promiEvent - web3 tx.send() PromiEvent
 * @param {object} payload - pending-event payload (tokenId, …)
 * @returns {Promise<*>} the mined receipt
 */
function _awaitReceiptWithPendingEvent(
  promiEvent: any,
  payload: Record<string, unknown>
) {
  if (typeof promiEvent.once === "function") {
    promiEvent.once("transactionHash", (hash: string) => {
      emit(EVENTS.ASSET_PUBLISH_PENDING, { ...payload, txHash: hash });
    });
  }
  return promiEvent;
}

/**
 * @param {string} tokenURI
 * @param {number|string} tokenId
 * @param {string} editorRoot
 * @param {string} editorListUri
 * @returns {Promise<string|null>} txHash on success, null on failure
 */
async function publishAsset(
  tokenURI: string,
  tokenId: number | string,
  editorRoot: string,
  editorListUri: string
) {
  const c = getActiveContract();
  const w3 = _getWeb3();
  if (!w3 || !walletState.get().walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }
  if (!_canPublishWithCurrentWallet()) return null;

  try {
    const tx = c.methods["publishAsset(string,uint256,bytes32,string)"](
      tokenURI,
      tokenId,
      editorRoot,
      editorListUri
    );
    const gas = await resolveGas(tx, walletState.get().walletAddress);
    const receipt = await _awaitReceiptWithPendingEvent(
      tx.send({
        from: walletState.get().walletAddress,
        gas,
      }),
      { tokenId, tokenURI }
    );

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
 * @param {number|string} tokenId
 * @param {string} newTokenURI
 * @param {string[]} proof
 * @returns {Promise<string|null>} txHash on success, null on failure
 */
async function updateAssetURI(
  tokenId: number | string,
  newTokenURI: string,
  proof: string[]
) {
  const c = getActiveContract();
  const w3 = _getWeb3();
  if (!w3 || !walletState.get().walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }
  if (!_canPublishWithCurrentWallet()) return null;

  try {
    const tx = c.methods["updateAssetURI(uint256,string,bytes32[])"](
      tokenId,
      newTokenURI,
      proof
    );
    const gas = await resolveGas(tx, walletState.get().walletAddress);
    const receipt = await _awaitReceiptWithPendingEvent(
      tx.send({
        from: walletState.get().walletAddress,
        gas,
      }),
      { tokenId, tokenURI: newTokenURI }
    );
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
 * Replace the entire editor set with a new Merkle root.
 * Caller must be a current Editor (proved via callerProof).
 * @param {number|string} tokenId
 * @param {string} newRoot - bytes32 hex string, the new Merkle root
 * @param {string} newListUri - IPFS URI of the new editor list
 * @param {number} callerRole - CollaboratorRole.Editor (2)
 * @param {string[]} callerProof - Merkle proof for the caller
 * @returns {Promise<string|null>} txHash on success
 */
async function updateEditors(
  tokenId: number | string,
  newRoot: string,
  newListUri: string,
  callerRole: number,
  callerProof: string[]
) {
  const c = getActiveContract();
  const w3 = _getWeb3();
  if (!w3 || !walletState.get().walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }
  if (!_canPublishWithCurrentWallet()) return null;

  try {
    const tx = c.methods[
      "updateEditors(uint256,bytes32,string,uint8,bytes32[])"
    ](tokenId, newRoot, newListUri, callerRole, callerProof);
    const gas = await resolveGas(tx, walletState.get().walletAddress);
    const receipt = await tx.send({
      from: walletState.get().walletAddress,
      gas,
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("updateEditors failed:", error);
    return null;
  }
}

// ── Token Burn ──

/**
 * @param {number|string} tokenId
 * @param {string[]} proof
 * @returns {Promise<string|null>} txHash on success, null on failure
 */
async function burn(tokenId: number | string, proof: string[]) {
  const c = getActiveContract();
  const w3 = _getWeb3();
  if (!w3 || !walletState.get().walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }
  if (!_canPublishWithCurrentWallet()) return null;

  // Resolve manifest CID before burning (after burn, tokenURI may revert)
  let manifestCid = null;
  try {
    manifestCid = await c.methods.tokenURI(tokenId).call();
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
        const { unpinAssetCids } = await import("../services/api.ts");
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

  try {
    const tx = c.methods["burn(uint256,bytes32[])"](tokenId, proof);
    const gas = await resolveGas(tx, walletState.get().walletAddress);
    const receipt = await tx.send({
      from: walletState.get().walletAddress,
      gas,
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

// @ts-nocheck
/**
 * Arbesk Wallet Publishing
 *
 * Asset publishing, tokenURI updates, Merkle editor management,
 * role-based collaboration, and token burn.
 *
 * Extracted from wallet.js to isolate publish-side functions.
 */

import { emit, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";
import { getContractArtifact } from "../services/api.js";
import { showToast } from "../ui/toasts.js";
import { isIpfsCidReachable } from "../ipfs/remote-ipfs.js";
import { web3, contract, getActiveConnectionSource } from "./wallet-core.js";
import { isSmartWalletSupported } from "./smart-wallet-support.js";

// ── Helpers ──

function _getWeb3() {
  return web3 || window.web3 || null;
}

function _getContract() {
  return contract || walletState.get().contract || null;
}

/**
 * Check whether the current wallet/chain combination can publish.
 * Smart wallets (Thirdweb Google) are only supported on chains with a
 * compatible ERC-4337 bundler (Monad Testnet). EOA wallets work everywhere.
 * @returns {boolean}
 */
/**
 * Whether the active wallet is a thirdweb ERC-4337 smart account.
 * @returns {boolean}
 */
function _isSmartAccount() {
  return getActiveConnectionSource() === "thirdweb";
}

// Generous gas ceiling for sponsored UserOperations. Supplying an explicit gas
// value lets web3 skip its own eth_estimateGas round trip; the ERC-4337 bundler
// re-estimates during UserOperation construction and the paymaster sponsors the
// cost, so an overestimate is free. Removing the redundant estimate trims a full
// RPC round trip from the social-login publish path.
const SMART_ACCOUNT_GAS_LIMIT = 2_000_000;

/**
 * Resolve the gas option for a contract method send.
 * EOA wallets estimate and pad by 20%; smart accounts skip estimation entirely.
 * @param {*} tx web3 contract method
 * @param {string} from sender address
 * @returns {Promise<number>}
 */
async function _resolveGas(tx, from) {
  if (_isSmartAccount()) return SMART_ACCOUNT_GAS_LIMIT;
  const gas = await tx.estimateGas({ from });
  return Math.floor(Number(gas) * 1.2);
}

function _canPublishWithCurrentWallet() {
  const source = getActiveConnectionSource();
  const chainId = walletState.get().chainId;
  if (source === "thirdweb" && !isSmartWalletSupported(chainId)) {
    showToast({
      type: "warning",
      title: "Smart Wallet Not Supported",
      message:
        "Google smart wallets are only supported on Monad Testnet. Please switch to Monad Testnet in the network dropdown, or connect with an EOA wallet (MetaMask/Rabby) to publish on MegaETH Testnet.",
      duration: 0,
    });
    return false;
  }
  return true;
}

// ── Asset Publishing ──

async function publishAsset(tokenURI, tokenId, editorRoot, editorListUri) {
  const c = _getContract();
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
    const gas = await _resolveGas(tx, walletState.get().walletAddress);
    const receipt = await tx.send({
      from: walletState.get().walletAddress,
      gas,
    });

    emit(EVENTS.ASSET_PUBLISHED, {
      tokenId,
      tokenURI,
      txHash: receipt.transactionHash,
    });

    return receipt.transactionHash;
  } catch (error) {
    console.error("publishAsset failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.js");
    const contractAbi =
      (await getContractArtifact("ArbeskAssetFree"))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);
    showToast({
      type: "error",
      title: "Publish Failed",
      message: decodedMsg,
    });
    return null;
  }
}

async function updateAssetURI(tokenId, newTokenURI, proof) {
  const c = _getContract();
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
    const gas = await _resolveGas(tx, walletState.get().walletAddress);
    const receipt = await tx.send({
      from: walletState.get().walletAddress,
      gas,
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("updateAssetURI failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.js");
    const contractAbi =
      (await getContractArtifact("ArbeskAssetFree"))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);

    const msg = error.message || "";
    if (
      msg.includes("User denied") ||
      msg.includes("rejected") ||
      error.code === 4001
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
 * @param {number} callerRole - CollaboratorRole.Editor (2)
 * @param {string[]} callerProof - Merkle proof for the caller
 * @returns {string|null} txHash on success
 */
async function updateEditors(
  tokenId,
  newRoot,
  newListUri,
  callerRole,
  callerProof
) {
  const c = _getContract();
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
    const gas = await _resolveGas(tx, walletState.get().walletAddress);
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

async function burn(tokenId, proof) {
  const c = _getContract();
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
      e.message
    );
    // Continue with burn even if resolution fails - unpin is best-effort
  }

  try {
    const tx = c.methods["burn(uint256,bytes32[])"](tokenId, proof);
    const gas = await _resolveGas(tx, walletState.get().walletAddress);
    const receipt = await tx.send({
      from: walletState.get().walletAddress,
      gas,
    });

    emit(EVENTS.ASSET_BURNED, {
      tokenId,
      txHash: receipt.transactionHash,
    });

    // Unpin IPFS content after burn - fully non-blocking, skipped if unreachable
    if (manifestCid) {
      const capturedCid = manifestCid;
      const capturedWallet = walletState.get().walletAddress;
      (async () => {
        const reachable = await isIpfsCidReachable(capturedCid).catch(
          () => false
        );
        if (!reachable) {
          console.warn(
            `[BURN] ${capturedCid} not reachable on IPFS, skipping unpin`
          );
          return;
        }
        console.log(`[BURN] unpinning IPFS content for ${capturedCid}…`);
        const { unpinAssetCids } = await import("../services/api.js");
        unpinAssetCids(capturedCid, capturedWallet)
          .then((result) => {
            console.log(
              `[BURN] unpinned ${result.count} CIDs for token ${tokenId}`
            );
            if (result.errors?.length)
              console.warn(`[BURN] unpin errors:`, result.errors);
          })
          .catch((err) =>
            console.warn(`[BURN] unpin failed (non-fatal):`, err.message)
          );
      })();
    }

    return receipt.transactionHash;
  } catch (error) {
    console.error("burn failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.js");
    const contractAbi =
      (await getContractArtifact("ArbeskAssetFree"))?.abi || null;
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
  _getWeb3,
  _getContract,
};

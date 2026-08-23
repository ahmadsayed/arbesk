/**
 * Arbesk Wallet Payments
 *
 * USDC payment flow, free-tier generation recording, and tier constants.
 * Extracted from wallet.js.
 *
 * Shared module-level state (web3, contract) is imported from ./wallet.js
 * pending migration to ./wallet-core.js.  contractAddress is not exported by
 * wallet.js - it is read from walletState (synced by _initContract).
 *
 * @module wallet-payments
 */

import { emit, EVENTS } from "../asset-core/events/bus.ts";
import { walletState } from "../state/wallet-state.ts";
import { showToast } from "../ui/toasts.ts";
import { getUsdcToken as getNetworkUsdcToken } from "./network-config.ts";
import { web3, getActiveContract } from "./wallet-core.ts";
import { resolveGas } from "./wallet-gas.ts";

// ─── Tier constants ──────────────────────────────────────────────────────────

/** Tier names for USDC quality levels */
const TIER_NAMES = ["Basic", "Standard", "Premium", "Pro"];

// ─── Internal helpers ────────────────────────────────────────────────────────

function _getWeb3() {
  return web3 || window.web3 || null;
}

/**
 * Get the current contract address.
 *
 * wallet.js does not export its module-level `contractAddress` variable, so we
 * read it from walletState (which _initContract keeps in sync).  When wallet-core.js
 * is created this will become a direct import.
 *
 * @returns {string|null}
 */
function _getContractAddress() {
  return walletState.get().contractAddress || null;
}

// ─── Tier detection ──────────────────────────────────────────────────────────

/**
 * Returns true if the currently loaded contract is the free tier
 * (ArbeskAssetFree), which uses recordGeneration() instead of payments.
 * @returns {boolean}
 */
function isFreeTierContract() {
  const c = getActiveContract();
  return !!c && typeof c.methods.recordGeneration === "function";
}

// ─── Public payment API ──────────────────────────────────────────────────────

/**
 * Pay for a generation using USDC at the selected quality tier.
 * Requires the user to first approve() the contract for the tier cost.
 * @param {string} nodeId - hex or string node identifier
 * @param {string} prompt - generation prompt
 * @param {number} tier - 0=Basic, 1=Standard, 2=Premium, 3=Pro
 * @returns {Promise<string|null>} txHash on success, null on failure
 */
async function payForGenerationWithUSDC(
  nodeId: string,
  prompt: string,
  tier: number
) {
  return payWithUSDC(nodeId, prompt, tier);
}

// ─── Free tier generation ────────────────────────────────────────────────────

/**
 * Record a free-tier generation on-chain.
 *
 * Calls ArbeskAssetFree.recordGeneration(bytes32 nodeId, string prompt).
 * No payment is required; the contract enforces a daily limit per wallet.
 *
 * @param {string} nodeId - hex-string or human-readable node identifier
 *   (padded to bytes32 on-chain).
 * @param {string} prompt - generation prompt stored in the event.
 * @returns {Promise<string|null>} transaction hash on success, null on failure.
 */
async function recordGeneration(nodeId: string, prompt: string) {
  const w3 = _getWeb3();
  if (!w3 || !walletState.get().walletAddress) {
    showToast({
      type: "error",
      title: "Not Signed In",
      message: "Please log in or sign up first.",
    });
    return null;
  }
  const c = getActiveContract();
  const contractAddress = _getContractAddress();
  if (!c || !contractAddress) {
    showToast({
      type: "error",
      title: "Contract Not Configured",
      message: "Cannot record generation. Contract not deployed.",
      duration: 0,
    });
    return null;
  }
  if (!isFreeTierContract()) {
    showToast({
      type: "error",
      title: "Wrong Contract",
      message:
        "Current contract is not the free tier. Use paid payment instead.",
      duration: 0,
    });
    return null;
  }
  try {
    const nodeIdBytes32 = w3.utils.padRight(w3.utils.utf8ToHex(nodeId), 64);
    const tx = c.methods.recordGeneration(nodeIdBytes32, prompt);

    const gas = await resolveGas(tx, walletState.get().walletAddress, 120000);
    const receipt = await tx.send({
      from: walletState.get().walletAddress,
      gas,
    });
    console.log("[FREE-GEN] recorded! txHash =", receipt.transactionHash);

    emit(EVENTS.WALLET_GENERATION_PAID, {
      txHash: receipt.transactionHash,
      nodeId,
      prompt,
      contractAddress,
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("recordGeneration failed:", error);
    const msg = (error as any).message || "";
    if (
      msg.includes("User denied") ||
      msg.includes("rejected") ||
      (error as any).code === 4001
    ) {
      // silent
    } else if (msg.includes("DailyGenerationLimitReached")) {
      showToast({
        type: "warning",
        title: "Daily Limit Reached",
        message: "You have used your free generations for today.",
        duration: 0,
      });
    } else {
      showToast({
        type: "error",
        title: "Generation Recording Failed",
        message: msg || "Could not record free generation.",
        duration: 0,
      });
    }
    return null;
  }
}

// ─── Simple USDC Payment ─────────────────────────────────────────────────────

/**
 * @param {string} nodeId
 * @param {string} prompt
 * @param {number} tier
 * @returns {Promise<string|null>}
 */
async function payWithUSDC(nodeId: string, prompt: string, tier: number) {
  const w3 = _getWeb3();
  if (!w3 || !walletState.get().walletAddress) {
    showToast({
      type: "error",
      title: "Not Signed In",
      message: "Please log in or sign up first.",
    });
    return null;
  }
  const c = getActiveContract();
  const contractAddress = _getContractAddress();
  if (!c || !contractAddress) {
    showToast({
      type: "error",
      title: "Contract Not Configured",
      message: "Cannot process payment. Contract not deployed.",
      duration: 0,
    });
    return null;
  }
  try {
    const tierCostWei = await c.methods.tierCosts(tier).call();
    if (tierCostWei === "0" || Number(tierCostWei) === 0) {
      showToast({
        type: "warning",
        title: "Tier Not Configured",
        message: "Tier cost not set for " + TIER_NAMES[tier] + ".",
        duration: 0,
      });
      return null;
    }
    const tierCostUSDC = Number(tierCostWei) / 1e6;
    console.log(
      "[USDC] tier=" + TIER_NAMES[tier] + " cost=" + tierCostUSDC + " USDC"
    );

    const chainId = Number(await w3.eth.getChainId());
    const usdcAddr =
      getNetworkUsdcToken(chainId) || (await c.methods.usdcToken().call());
    if (
      !usdcAddr ||
      usdcAddr === "0x0000000000000000000000000000000000000000"
    ) {
      showToast({
        type: "warning",
        title: "USDC Disabled",
        message: "USDC payments not enabled on this contract.",
        duration: 0,
      });
      return null;
    }

    // Step 1: Approve USDC spend
    console.log("[USDC] requesting approval for", tierCostUSDC, "USDC...");
    const usdcAbi = [
      {
        constant: false,
        inputs: [
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        type: "function",
      },
      {
        constant: true,
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        type: "function",
      },
      {
        constant: true,
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        type: "function",
      },
    ];
    const usdcContract = new w3.eth.Contract(usdcAbi, usdcAddr);

    // Check USDC balance before attempting payment
    const balance = await usdcContract.methods
      .balanceOf(walletState.get().walletAddress)
      .call();
    if (BigInt(balance) < BigInt(tierCostWei)) {
      const balanceUSDC = Number(balance) / 1e6;
      showToast({
        type: "warning",
        title: "Insufficient USDC Balance",
        message: `You need ${tierCostUSDC} USDC but only have ${balanceUSDC} USDC. Get testnet USDC from a faucet.`,
        duration: 0,
      });
      return null;
    }
    console.log(
      "[USDC] balance:",
      (Number(balance) / 1e6).toFixed(2),
      "USDC (need",
      tierCostUSDC,
      "USDC)"
    );

    // Reset allowance to 0 first if there's a stale non-zero allowance.
    // Some ERC20 tokens require this to prevent front-running; USDC doesn't
    // but it's a safe practice that costs minimal gas.
    const currentAllowance = await usdcContract.methods
      .allowance(walletState.get().walletAddress, contractAddress)
      .call();
    if (BigInt(currentAllowance) > BigInt(0)) {
      console.log(
        "[USDC] resetting existing allowance:",
        (Number(currentAllowance) / 1e6).toFixed(6),
        "USDC → 0"
      );
      const resetTx = usdcContract.methods.approve(contractAddress, "0");
      const resetGas = await resolveGas(
        resetTx,
        walletState.get().walletAddress,
        80000
      );
      await resetTx.send({
        from: walletState.get().walletAddress,
        gas: resetGas,
      });
      console.log("[USDC] allowance reset to 0");
    }

    const approveTx = usdcContract.methods.approve(
      contractAddress,
      tierCostWei
    );

    const approveGas = await resolveGas(
      approveTx,
      walletState.get().walletAddress,
      100000
    );

    await approveTx.send({
      from: walletState.get().walletAddress,
      gas: approveGas,
    });
    console.log("[USDC] approval confirmed");

    // Verify the allowance was actually set (critical for OP Stack L2s where
    // sequencer state may lag behind). Retry up to 5 times with a 500ms delay.
    for (let attempt = 0; attempt < 5; attempt++) {
      const allowed = await usdcContract.methods
        .allowance(walletState.get().walletAddress, contractAddress)
        .call();
      if (BigInt(allowed) >= BigInt(tierCostWei)) {
        console.log("[USDC] allowance verified:", allowed.toString());
        break;
      }
      if (attempt < 4) {
        console.log(
          `[USDC] allowance not yet visible (attempt ${
            attempt + 1
          }/5), waiting 500ms...`
        );
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.warn(
          "[USDC] allowance still not visible after 5 attempts. Proceeding anyway - the payment tx may revert if the RPC is stale."
        );
      }
    }

    // Step 2: Pay for generation
    console.log("[USDC] calling payForGenerationWithUSDC...");
    const nodeIdBytes32 = w3.utils.padRight(w3.utils.utf8ToHex(nodeId), 64);
    const payTx = c.methods.payForGenerationWithUSDC(
      nodeIdBytes32,
      prompt,
      tier
    );

    // estimateGas may fail when the approval tx hasn't been indexed by the
    // RPC's simulation state; resolveGas falls back to a generous default.
    const payGas = await resolveGas(
      payTx,
      walletState.get().walletAddress,
      300000
    );

    const receipt = await payTx.send({
      from: walletState.get().walletAddress,
      gas: payGas,
    });
    console.log("[USDC] payment confirmed! txHash =", receipt.transactionHash);

    emit(EVENTS.WALLET_GENERATION_PAID, {
      txHash: receipt.transactionHash,
      nodeId,
      prompt,
      tier,
      tierCostUSDC,
      blockNumber: receipt.blockNumber,
      contractAddress,
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("payWithUSDC failed:", error);
    const msg = (error as any).message || "";
    if (
      msg.includes("User denied") ||
      msg.includes("rejected") ||
      (error as any).code === 4001
    ) {
      // silent
    } else if (
      msg.includes("insufficient") ||
      msg.includes("exceeds") ||
      msg.includes("exceed")
    ) {
      showToast({
        type: "warning",
        title: "Insufficient USDC",
        message:
          "Insufficient USDC balance or allowance. Top up your testnet USDC and try again.",
        duration: 0,
      });
    } else if (
      msg.includes("reverted") ||
      msg.includes("revert") ||
      msg.includes("VM Exception")
    ) {
      // Transaction mined but reverted - usually balance/allowance related.
      // Check on-chain state for the specific reason.
      showToast({
        type: "error",
        title: "Transaction Reverted",
        message:
          "The transaction was mined but reverted. This usually means insufficient USDC balance or allowance. Check your testnet USDC balance.",
        duration: 0,
      });
    } else {
      showToast({
        type: "error",
        title: "Payment Failed",
        message: msg,
        actions: [
          { label: "Retry", onClick: () => payWithUSDC(nodeId, prompt, tier) },
        ],
      });
    }
    return null;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export {
  payForGenerationWithUSDC,
  payWithUSDC,
  recordGeneration,
  isFreeTierContract,
};

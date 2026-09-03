/**
 * USDC payment flow, free-tier generation recording, and tier constants.
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { showToast } from "../ui/toasts.ts";
import { getUsdcToken as getNetworkUsdcToken } from "./network-config.ts";
import { getActiveContract } from "./wallet-core.ts";
import { sendContractCall } from "./wallet-send.ts";
import { getReadClient } from "./viem-clients.ts";
import { pad, stringToHex } from "viem";

// ─── Tier constants ──────────────────────────────────────────────────────────

/** Tier names for USDC quality levels */
const TIER_NAMES = ["Basic", "Standard", "Premium", "Pro"];

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Returns the contract address from wallet state.
 */
function _getContractAddress() {
  return walletState.get().contractAddress || null;
}

// ─── Tier detection ──────────────────────────────────────────────────────────

/**
 * Returns true when the loaded contract is the free tier (ArbeskAssetFree),
 * which uses recordGeneration() instead of payments.
 */
function isFreeTierContract() {
  const c = getActiveContract();
  return (
    !!c &&
    Array.isArray(c.abi) &&
    c.abi.some((i: any) => i.type === "function" && i.name === "recordGeneration")
  );
}

// ─── Public payment API ──────────────────────────────────────────────────────

/**
 * Pays for a generation using USDC at the selected quality tier.
 * @remarks The caller must first approve() the contract for the tier cost.
 * @param tier - 0=Basic, 1=Standard, 2=Premium, 3=Pro
 * @returns txHash on success, null on failure
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
 * Records a free-tier generation on-chain.
 * @remarks No payment is required; the contract enforces a daily limit per
 *   wallet.
 * @param nodeId - node identifier, padded to bytes32 on-chain.
 * @param prompt - generation prompt stored in the event.
 * @returns transaction hash on success, null on failure.
 */
/**
 * Requires a connected wallet and a configured contract for generation write
 * paths; toasts and returns null otherwise.
 */
function _requireGenerationContract(action: string): { c: any; contractAddress: string } | null {
  if (!walletState.get().walletAddress) {
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
      message: `Cannot ${action}. Contract not deployed.`,
      duration: 0,
    });
    return null;
  }
  return { c, contractAddress };
}

/** True for wallet user-denied rejections (MetaMask 4001 etc.) — stay silent. */
function _isUserRejection(error: any): boolean {
  const msg = error?.message || "";
  return (
    msg.includes("User denied") || msg.includes("rejected") || error?.code === 4001
  );
}

async function recordGeneration(nodeId: string, prompt: string) {
  const ready = _requireGenerationContract("record generation");
  if (!ready) return null;
  const { c, contractAddress } = ready;
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
    const nodeIdBytes32 = pad(stringToHex(nodeId), { size: 32 });
    const receipt = await sendContractCall({
      to: contractAddress,
      abi: c.abi,
      functionName: "recordGeneration",
      args: [nodeIdBytes32, prompt],
      fallbackGas: 120000,
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
    if (_isUserRejection(error)) {
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

const USDC_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;


async function resolveUsdcAddress(chainId: number, c: any): Promise<string | null> {
  const usdcAddr = getNetworkUsdcToken(chainId) || (await c.read.usdcToken());
  if (!usdcAddr || usdcAddr === "0x0000000000000000000000000000000000000000") {
    showToast({
      type: "warning",
      title: "USDC Disabled",
      message: "USDC payments not enabled on this contract.",
      duration: 0,
    });
    return null;
  }
  return usdcAddr;
}

async function ensureUsdcFunding(
  chainId: number,
  usdcAddr: string,
  contractAddress: string,
  tierCostWei: bigint,
  tierCostUSDC: number
): Promise<boolean> {
  const walletAddress = walletState.get().walletAddress as string;

  // Check USDC balance before attempting payment
  const balance = (await getReadClient(chainId).readContract({
    address: usdcAddr as `0x${string}`,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [walletAddress as `0x${string}`],
  })) as bigint;
  if (balance < tierCostWei) {
    const balanceUSDC = Number(balance) / 1e6;
    showToast({
      type: "warning",
      title: "Insufficient USDC Balance",
      message: `You need ${tierCostUSDC} USDC but only have ${balanceUSDC} USDC. Get testnet USDC from a faucet.`,
      duration: 0,
    });
    return false;
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
  const currentAllowance = (await getReadClient(chainId).readContract({
    address: usdcAddr as `0x${string}`,
    abi: USDC_ABI,
    functionName: "allowance",
    args: [
      walletAddress as `0x${string}`,
      contractAddress as `0x${string}`,
    ],
  })) as bigint;
  if (currentAllowance > 0n) {
    console.log(
      "[USDC] resetting existing allowance:",
      (Number(currentAllowance) / 1e6).toFixed(6),
      "USDC → 0"
    );
    await sendContractCall({
      to: usdcAddr,
      abi: USDC_ABI,
      functionName: "approve",
      args: [contractAddress, 0n],
      fallbackGas: 80000,
    });
    console.log("[USDC] allowance reset to 0");
  }

  await sendContractCall({
    to: usdcAddr,
    abi: USDC_ABI,
    functionName: "approve",
    args: [contractAddress, tierCostWei],
    fallbackGas: 100000,
  });
  console.log("[USDC] approval confirmed");

  // Verify the allowance was actually set (critical for OP Stack L2s where
  // sequencer state may lag behind). Retry up to 5 times with a 500ms delay.
  for (let attempt = 0; attempt < 5; attempt++) {
    const allowed = (await getReadClient(chainId).readContract({
      address: usdcAddr as `0x${string}`,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [
        walletAddress as `0x${string}`,
        contractAddress as `0x${string}`,
      ],
    })) as bigint;
    if (allowed >= tierCostWei) {
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
  return true;
}

function handleUsdcPaymentError(error: any, nodeId: string, prompt: string, tier: number): void {
  console.error("payWithUSDC failed:", error);
  const msg = (error as any).message || "";
  if (_isUserRejection(error)) {
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
}

async function resolveTierCost(
  c: any,
  tier: number
): Promise<{ tierCostWei: bigint; tierCostUSDC: number } | null> {
  const tierCostWei = await c.read.tierCosts([BigInt(tier)]);
  if (tierCostWei === 0n) {
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
  return { tierCostWei, tierCostUSDC };
}

/**
 * @param {string} nodeId
 * @param {string} prompt
 * @param {number} tier
 * @returns {Promise<string|null>}
 */
async function payWithUSDC(nodeId: string, prompt: string, tier: number) {
  const ready = _requireGenerationContract("process payment");
  if (!ready) return null;
  const { c, contractAddress } = ready;
  try {
    const tierCost = await resolveTierCost(c, tier);
    if (!tierCost) return null;
    const { tierCostWei, tierCostUSDC } = tierCost;

    const chainId = await getReadClient().getChainId();
    const usdcAddr = await resolveUsdcAddress(chainId, c);
    if (!usdcAddr) return null;

    // Step 1: Approve USDC spend
    console.log("[USDC] requesting approval for", tierCostUSDC, "USDC...");
    const funded = await ensureUsdcFunding(
      chainId,
      usdcAddr,
      contractAddress,
      tierCostWei,
      tierCostUSDC
    );
    if (!funded) return null;

    // Step 2: Pay for generation
    console.log("[USDC] calling payForGenerationWithUSDC...");
    const nodeIdBytes32 = pad(stringToHex(nodeId), { size: 32 });

    // estimateGas may fail when the approval tx hasn't been indexed by the
    // RPC's simulation state; sendContractCall falls back to a generous default.
    const receipt = await sendContractCall({
      to: contractAddress,
      abi: c.abi,
      functionName: "payForGenerationWithUSDC",
      args: [nodeIdBytes32, prompt, BigInt(tier)],
      fallbackGas: 300000,
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
    handleUsdcPaymentError(error, nodeId, prompt, tier);
    return null;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export {
  payForGenerationWithUSDC,
  recordGeneration,
  isFreeTierContract,
};

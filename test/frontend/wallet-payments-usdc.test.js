/** @jest-environment jsdom */
import { jest } from "@jest/globals";

const WALLET = "0xWallet";
const CONTRACT_ADDRESS = "0xContract";
const USDC = "0xUsdc";
const TX_HASH = "0xTxHash";

let _allowance = 0n;
let _getUsdcToken = null;

async function loadUsdcModule({
  tierCostWei = 1_000_000n,
  usdcToken = USDC,
  balance = 5_000_000n,
  allowance = 0n,
  getUsdcToken = null,
  sendImpl = null,
} = {}) {
  jest.resetModules();
  _allowance = allowance;
  _getUsdcToken = getUsdcToken;

  const contract = {
    abi: [],
    read: {
      tierCosts: jest.fn(async () => tierCostWei),
      usdcToken: jest.fn(async () => usdcToken),
    },
  };

  const readContract = jest.fn(async ({ functionName }) => {
    if (functionName === "balanceOf") return balance;
    if (functionName === "allowance") return _allowance;
    return 0n;
  });

  const sendContractCall = jest.fn(sendImpl || (async (args) => {
    if (args.functionName === "approve") {
      _allowance = args.args[1];
    }
    return { transactionHash: TX_HASH, blockNumber: 1 };
  }));

  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-core.js", () => ({
    getActiveContract: () => contract,
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/viem-clients.js", () => ({
    getReadClient: jest.fn(() => ({
      getChainId: jest.fn(async () => 1337),
      readContract,
    })),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/network-config.js", () => ({
    getUsdcToken: jest.fn(() => _getUsdcToken),
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-send.js", () => ({
    sendContractCall,
  }));
  await jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.js", () => ({
    walletState: {
      get: jest.fn(() => ({
        walletAddress: WALLET,
        contractAddress: CONTRACT_ADDRESS,
      })),
    },
  }));
  await jest.unstable_mockModule("@arbesk/asset-core/events/bus.js", () => ({
    emit: jest.fn(),
    EVENTS: { WALLET_GENERATION_PAID: "walletGenerationPaid" },
  }));
  await jest.unstable_mockModule("../../frontend/src/js/ui/toasts.js", () => ({
    showToast: jest.fn(),
  }));

  const mod = await import("../../frontend/src/js/blockchain/wallet-payments.js");
  return { mod, sendContractCall, readContract };
}

describe("payWithUSDC", () => {
  test("warns and returns null when the tier cost is unset", async () => {
    const { mod, sendContractCall } = await loadUsdcModule({ tierCostWei: 0n });
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    const txHash = await mod.payForGenerationWithUSDC("node-1", "prompt", 2);

    expect(txHash).toBeNull();
    expect(sendContractCall).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Tier Not Configured" })
    );
  });

  test("warns and returns null when USDC is disabled", async () => {
    const { mod, sendContractCall } = await loadUsdcModule({
      usdcToken: null,
      getUsdcToken: null,
    });
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    const txHash = await mod.payForGenerationWithUSDC("node-1", "prompt", 2);

    expect(txHash).toBeNull();
    expect(sendContractCall).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "USDC Disabled" })
    );
  });

  test("warns and returns null when the balance is insufficient", async () => {
    const { mod, sendContractCall } = await loadUsdcModule({
      balance: 500_000n, // < 1_000_000n tier cost
    });
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    const txHash = await mod.payForGenerationWithUSDC("node-1", "prompt", 2);

    expect(txHash).toBeNull();
    expect(sendContractCall).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Insufficient USDC Balance" })
    );
  });

  test("approves and pays, returning the txHash on success", async () => {
    const { mod, sendContractCall } = await loadUsdcModule();
    const bus = await import("@arbesk/asset-core/events/bus.js");

    const txHash = await mod.payForGenerationWithUSDC("node-1", "prompt", 2);

    expect(txHash).toBe(TX_HASH);
    // approve(tierCost) then payForGenerationWithUSDC(...)
    const approveCall = sendContractCall.mock.calls.find(
      (c) => c[0].functionName === "approve"
    );
    expect(approveCall).toBeTruthy();
    expect(approveCall[0].args[1]).toBe(1_000_000n);
    const payCall = sendContractCall.mock.calls.find(
      (c) => c[0].functionName === "payForGenerationWithUSDC"
    );
    expect(payCall).toBeTruthy();
    expect(payCall[0].args[2]).toBe(2n);
    expect(bus.emit).toHaveBeenCalledWith(
      "walletGenerationPaid",
      expect.objectContaining({ txHash: TX_HASH, tier: 2 })
    );
  });

  test("stays silent on user rejection and returns null", async () => {
    const { mod } = await loadUsdcModule({
      sendImpl: async () => {
        throw new Error("User denied transaction signature.");
      },
    });
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    const txHash = await mod.payForGenerationWithUSDC("node-1", "prompt", 2);

    expect(txHash).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });

  test("shows a generic payment-failed toast on other errors", async () => {
    const { mod } = await loadUsdcModule({
      sendImpl: async () => {
        throw new Error("boom");
      },
    });
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    const txHash = await mod.payForGenerationWithUSDC("node-1", "prompt", 2);

    expect(txHash).toBeNull();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Payment Failed", message: "boom" })
    );
  });
});

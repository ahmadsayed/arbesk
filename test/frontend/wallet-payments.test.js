/**
 * @jest-environment jsdom
 *
 * wallet-payments.ts — gas handling per wallet type.
 * CDP smart accounts must skip eth_estimateGas (sponsored UserOperations);
 * EOA wallets estimate and pad.
 */
import { jest } from "@jest/globals";

const WALLET = "0xWallet";
const CONTRACT_ADDRESS = "0xContract";
const TX_HASH = "0xTxHash";

let _connectionSource = "injected";
let _estimateGas;
let _signerSend;

const RECORD_ABI = [
  {
    type: "function",
    name: "recordGeneration",
    stateMutability: "nonpayable",
    inputs: [
      { name: "nodeId", type: "bytes32" },
      { name: "prompt", type: "string" },
    ],
    outputs: [],
  },
];

function _mockContract() {
  return { abi: RECORD_ABI };
}

async function loadModule() {
  const contract = _mockContract();
  _signerSend = jest.fn().mockResolvedValue({
    hash: "0xUserOp",
    wait: jest.fn().mockResolvedValue({
      transactionHash: TX_HASH,
      status: true,
      blockNumber: 1,
    }),
  });
  _estimateGas = jest.fn().mockResolvedValue(100000n);
  const signer = {
    getAddress: () => WALLET,
    getSignerAddress: () => WALLET,
    sendTransaction: _signerSend,
  };

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.js",
    () => ({
      getActiveContract: () => contract,
      getActiveConnectionSource: () => _connectionSource,
      getSigner: () => signer,
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/viem-clients.js",
    () => ({
      getReadClient: jest.fn(() => ({ estimateGas: _estimateGas })),
      getWalletClient: jest.fn(),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({
          walletAddress: WALLET,
          contractAddress: CONTRACT_ADDRESS,
        })),
      },
    })
  );
  await jest.unstable_mockModule("@arbesk/asset-core/events/bus.js", () => ({
    emit: jest.fn(),
    EVENTS: { WALLET_GENERATION_PAID: "walletGenerationPaid" },
  }));
  await jest.unstable_mockModule("../../frontend/src/js/ui/toasts.js", () => ({
    showToast: jest.fn(),
  }));

  return import("../../frontend/src/js/blockchain/wallet-payments.js");
}

beforeEach(() => {
  jest.resetModules();
  _connectionSource = "injected";
});

describe("recordGeneration gas handling", () => {
  test("CDP smart account: skips estimateGas and sends with the flat sponsored gas limit", async () => {
    _connectionSource = "cdp";
    const { recordGeneration } = await loadModule();

    const txHash = await recordGeneration("node-1", "a prompt");

    expect(txHash).toBe(TX_HASH);
    expect(_estimateGas).not.toHaveBeenCalled();
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: CONTRACT_ADDRESS,
        gas: 2_000_000n,
      })
    );
  });

  test("EOA wallet: estimates gas and pads by 20%", async () => {
    const { recordGeneration } = await loadModule();

    const txHash = await recordGeneration("node-1", "a prompt");

    expect(txHash).toBe(TX_HASH);
    expect(_estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ account: WALLET })
    );
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 120000n })
    );
  });

  test("EOA wallet: falls back to the padded default when estimation fails", async () => {
    const { recordGeneration } = await loadModule();
    _estimateGas.mockRejectedValue(new Error("revert"));

    const txHash = await recordGeneration("node-1", "a prompt");

    expect(txHash).toBe(TX_HASH);
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 144000n })
    );
  });
});

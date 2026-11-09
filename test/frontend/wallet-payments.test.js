// @test-env dom
/**
 * wallet-payments.ts — gas handling per wallet type.
 * CDP smart accounts must skip eth_estimateGas (sponsored UserOperations);
 * EOA wallets estimate and pad.
 */

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
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

  await mock.module(
    "../../frontend/src/js/blockchain/wallet-core.js",
    () => ({
      getActiveContract: () => contract,
      getActiveConnectionSource: () => _connectionSource,
      getSigner: () => signer,
    })
  );
  await mock.module(
    "../../frontend/src/js/blockchain/viem-clients.js",
    () => ({
      getReadClient: jest.fn(() => ({ estimateGas: _estimateGas })),
      getWalletClient: jest.fn(),
    })
  );
  await mock.module(
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
  await mock.module("@arbesk/asset-core/events/bus.js", () => ({
    emit: jest.fn(),
    EVENTS: { WALLET_GENERATION_PAID: "walletGenerationPaid" },
  }));
  await mock.module("../../frontend/src/js/ui/toasts.js", () => ({
    showToast: jest.fn(),
  }));

  return import("../../frontend/src/js/blockchain/wallet-payments.js");
}

beforeEach(() => {
  resetModules();
  _connectionSource = "injected";
});

describe("recordGeneration gas handling", () => {
  test("CDP skips estimation; EOA estimates and pads, falling back when estimation fails", async () => {
    // CDP smart account: sponsored UserOperation, no estimateGas.
    _connectionSource = "cdp";
    let { recordGeneration } = await loadModule();
    expect(await recordGeneration("node-1", "a prompt")).toBe(TX_HASH);
    expect(_estimateGas).not.toHaveBeenCalled();
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: CONTRACT_ADDRESS, gas: 2_000_000n })
    );

    // EOA wallet: estimate and pad by 20% (100000n → 120000n).
    resetModules();
    _connectionSource = "injected";
    ({ recordGeneration } = await loadModule());
    expect(await recordGeneration("node-1", "a prompt")).toBe(TX_HASH);
    expect(_estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ account: WALLET })
    );
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 120000n })
    );

    // EOA fallback: estimation failure uses the padded 144000n default.
    resetModules();
    ({ recordGeneration } = await loadModule());
    _estimateGas.mockRejectedValue(new Error("revert"));
    expect(await recordGeneration("node-1", "a prompt")).toBe(TX_HASH);
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 144000n })
    );
  });
});

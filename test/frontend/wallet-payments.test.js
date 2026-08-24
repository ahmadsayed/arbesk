/**
 * @jest-environment jsdom
 *
 * wallet-payments.js — gas handling per wallet type.
 * CDP smart accounts must skip eth_estimateGas (sponsored UserOperations);
 * EOA wallets estimate and pad.
 */
import { jest } from "@jest/globals";

const WALLET = "0xWallet";
const CONTRACT_ADDRESS = "0xContract";
const TX_HASH = "0xTxHash";

let _connectionSource = "injected";
let _recordTx;
let _signerSend;

function _mockContract() {
  _recordTx = {
    estimateGas: jest.fn().mockResolvedValue(100000n),
    encodeABI: jest.fn().mockReturnValue("0xDATA"),
  };
  return {
    methods: {
      recordGeneration: jest.fn(() => _recordTx),
    },
  };
}

async function loadModule() {
  const contract = _mockContract();
  _signerSend = jest.fn().mockResolvedValue({
    hash: "0xUserOp",
    wait: jest.fn().mockResolvedValue({ transactionHash: TX_HASH, status: true }),
  });
  const signer = {
    getAddress: () => WALLET,
    getSignerAddress: () => WALLET,
    sendTransaction: _signerSend,
  };

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.js",
    () => ({
      web3: {
        utils: {
          utf8ToHex: (s) => "0x" + Buffer.from(s, "utf8").toString("hex"),
          padRight: (hex, n) => hex.padEnd(n, "0"),
        },
      },
      getActiveContract: () => contract,
      getActiveConnectionSource: () => _connectionSource,
      getSigner: () => signer,
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
    expect(_recordTx.estimateGas).not.toHaveBeenCalled();
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: CONTRACT_ADDRESS,
        gas: 2_000_000,
      })
    );
  });

  test("EOA wallet: estimates gas and pads by 20%", async () => {
    const { recordGeneration } = await loadModule();

    const txHash = await recordGeneration("node-1", "a prompt");

    expect(txHash).toBe(TX_HASH);
    expect(_recordTx.estimateGas).toHaveBeenCalledWith({ from: WALLET });
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ gas: 120000 })
    );
  });

  test("EOA wallet: falls back to the padded default when estimation fails", async () => {
    const { recordGeneration } = await loadModule();
    _recordTx.estimateGas.mockRejectedValue(new Error("revert"));

    const txHash = await recordGeneration("node-1", "a prompt");

    expect(txHash).toBe(TX_HASH);
    expect(_signerSend).toHaveBeenCalledWith(
      expect.objectContaining({ gas: Math.floor(120000 * 1.2) })
    );
  });
});

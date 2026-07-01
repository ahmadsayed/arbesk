/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const SMART_ACCOUNT_ADDRESS = "0xSmartAccount";
const EOA_ADDRESS = "0xEoaAccount";
const USER_OP_HASH = "0xUserOpHash";
const TX_HASH = "0xTxHash";

let _getUserOperationImpl;

async function loadModule() {
  await jest.unstable_mockModule(
    "@coinbase/cdp-core",
    () => ({
      initialize: jest.fn(),
      signInWithEmail: jest.fn(),
      verifyEmailOTP: jest.fn(),
      getCurrentUser: jest.fn(),
      createEvmSmartAccount: jest.fn(),
      signEvmMessage: jest.fn(),
      sendUserOperation: jest.fn().mockResolvedValue({ userOperationHash: USER_OP_HASH }),
      getUserOperation: jest.fn((...args) => _getUserOperationImpl(...args)),
      signOut: jest.fn(),
    }),
    { virtual: true }
  );

  return import("../../frontend/src/js/blockchain/wallet-cdp.js");
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("buildCdpEip1193Provider eth_sendTransaction — UserOperation confirmation", () => {
  test("resolves with transactionHash as soon as it appears, before status reaches 'complete'", async () => {
    _getUserOperationImpl = async () => ({
      status: "broadcast",
      transactionHash: TX_HASH,
    });

    const { buildCdpEip1193Provider } = await loadModule();
    const provider = buildCdpEip1193Provider(
      { address: EOA_ADDRESS },
      SMART_ACCOUNT_ADDRESS
    );

    const resultPromise = provider.request({
      method: "eth_sendTransaction",
      params: [{ to: "0xTarget", value: "0x0", data: "0x" }],
    });

    await jest.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toBe(TX_HASH);
  });

  test("rejects with the revert message when the UserOperation fails", async () => {
    _getUserOperationImpl = async () => ({
      status: "failed",
      receipts: [{ revert: { message: "execution reverted: insufficient balance" } }],
    });

    const { buildCdpEip1193Provider } = await loadModule();
    const provider = buildCdpEip1193Provider(
      { address: EOA_ADDRESS },
      SMART_ACCOUNT_ADDRESS
    );

    const resultPromise = provider.request({
      method: "eth_sendTransaction",
      params: [{ to: "0xTarget", value: "0x0", data: "0x" }],
    });
    resultPromise.catch(() => {}); // avoid unhandled rejection before assertion runs

    await jest.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).rejects.toThrow(
      "execution reverted: insufficient balance"
    );
  });

  test("rejects when the UserOperation is dropped", async () => {
    _getUserOperationImpl = async () => ({ status: "dropped" });

    const { buildCdpEip1193Provider } = await loadModule();
    const provider = buildCdpEip1193Provider(
      { address: EOA_ADDRESS },
      SMART_ACCOUNT_ADDRESS
    );

    const resultPromise = provider.request({
      method: "eth_sendTransaction",
      params: [{ to: "0xTarget", value: "0x0", data: "0x" }],
    });
    resultPromise.catch(() => {});

    await jest.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).rejects.toThrow("UserOperation dropped");
  });
});

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
      createDelegation: jest.fn().mockResolvedValue({}),
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

describe("resetCdpStorage", () => {
  test("clears CDP/coinbase localStorage keys, app email key, and signs out", async () => {
    localStorage.setItem("cdp-session", "stale");
    localStorage.setItem("coinbase-cache", "stale");
    localStorage.setItem("arbesk-cdp-email", "stale@example.com");

    const { resetCdpStorage } = await loadModule();
    await resetCdpStorage();

    expect(localStorage.getItem("cdp-session")).toBeNull();
    expect(localStorage.getItem("coinbase-cache")).toBeNull();
    expect(localStorage.getItem("arbesk-cdp-email")).toBeNull();
  });
});

describe("createCdpSigner sendTransaction — UserOperation confirmation", () => {
  test("wait() resolves with transactionHash as soon as it appears, before status 'complete'", async () => {
    _getUserOperationImpl = async () => ({
      status: "broadcast",
      transactionHash: TX_HASH,
    });

    const { createCdpSigner } = await loadModule();
    const signer = createCdpSigner({ address: EOA_ADDRESS }, SMART_ACCOUNT_ADDRESS);

    const result = await signer.sendTransaction({ to: "0xTarget", value: "0x0", data: "0x" });
    expect(result.hash).toBe(USER_OP_HASH);

    const waitPromise = result.wait();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(waitPromise).resolves.toEqual({
      transactionHash: TX_HASH,
      status: true,
    });
  });

  test("wait() rejects with the revert message when the UserOperation fails", async () => {
    _getUserOperationImpl = async () => ({
      status: "failed",
      receipts: [{ revert: { message: "execution reverted: insufficient balance" } }],
    });

    const { createCdpSigner } = await loadModule();
    const signer = createCdpSigner({ address: EOA_ADDRESS }, SMART_ACCOUNT_ADDRESS);

    const result = await signer.sendTransaction({ to: "0xTarget", value: "0x0", data: "0x" });
    const waitPromise = result.wait();
    waitPromise.catch(() => {});

    await jest.advanceTimersByTimeAsync(1000);
    await expect(waitPromise).rejects.toThrow(
      "execution reverted: insufficient balance"
    );
  });

  test("wait() rejects when the UserOperation is dropped", async () => {
    _getUserOperationImpl = async () => ({ status: "dropped" });

    const { createCdpSigner } = await loadModule();
    const signer = createCdpSigner({ address: EOA_ADDRESS }, SMART_ACCOUNT_ADDRESS);

    const result = await signer.sendTransaction({ to: "0xTarget", value: "0x0", data: "0x" });
    const waitPromise = result.wait();
    waitPromise.catch(() => {});

    await jest.advanceTimersByTimeAsync(1000);
    await expect(waitPromise).rejects.toThrow("UserOperation dropped");
  });
});

/**
 * @jest-environment jsdom
 */
import { walletState, _resetForTesting } from "../../frontend/src/js/state/wallet-state.js";
import { on, off, EVENTS } from "../../frontend/src/js/events/bus.js";

beforeEach(() => _resetForTesting());

describe("walletState.get()", () => {
  test("returns null defaults", () => {
    expect(walletState.get()).toEqual({
      walletAddress: null,
      eoaAddress: null,
      chainId: null,
      contract: null,
      contractAddress: null,
      walletSource: null,
      email: null,
    });
  });

  test("returns a snapshot copy, not the live object", () => {
    const snap = walletState.get();
    walletState.set({ walletAddress: "0xabc" });
    expect(snap.walletAddress).toBeNull();
  });
});

describe("walletState.set()", () => {
  test("merges partial update", () => {
    walletState.set({ walletAddress: "0xabc" });
    expect(walletState.get().walletAddress).toBe("0xabc");
    expect(walletState.get().chainId).toBeNull();
  });

  test("emits WALLET_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      const handler = (payload) => {
        off(EVENTS.WALLET_STATE_CHANGED, handler);
        expect(payload.walletAddress).toBe("0xabc");
        resolve();
      };
      on(EVENTS.WALLET_STATE_CHANGED, handler);
      walletState.set({ walletAddress: "0xabc" });
    });
  });
});

describe("walletState.reset()", () => {
  test("restores all fields to null", () => {
    walletState.set({ walletAddress: "0xabc", chainId: 10 });
    walletState.reset();
    expect(walletState.get()).toEqual({
      walletAddress: null,
      eoaAddress: null,
      chainId: null,
      contract: null,
      contractAddress: null,
      walletSource: null,
      email: null,
    });
  });
});

/**
 * CDP writes go through the backend relay, not sendContractCall, so the relay
 * path must emit ASSET_PUBLISH_PENDING itself for the optimistic library UI.
 */
import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";

let resolveRelay;
const relayWrite = jest.fn(
  () => new Promise((resolve) => { resolveRelay = resolve; })
);

mock.module("../../frontend/src/js/services/backend-client.ts", () => ({
  relayWrite,
  getContractArtifact: jest.fn(async () => null),
}));
mock.module("../../frontend/src/js/blockchain/wallet-core.ts", () => ({
  getActiveConnectionSource: () => "cdp",
  getActiveContract: () => ({ abi: [] }),
}));
mock.module("../../frontend/src/js/blockchain/smart-wallet-support.ts", () => ({
  isSmartWalletSupported: () => true,
}));
mock.module("../../frontend/src/js/ui/toasts.ts", () => ({ showToast: jest.fn() }));
mock.module("../../frontend/src/js/ipfs/remote-ipfs.ts", () => ({ isIpfsCidReachable: jest.fn() }));
mock.module("../../frontend/src/js/blockchain/wallet-send.ts", () => ({ sendContractCall: jest.fn() }));

const { on, off, EVENTS } = await import("@arbesk/asset-core/events/bus.js");
const { walletState } = await import("../../frontend/src/js/state/wallet-state.ts");
const { publishAsset, updateAssetURI } = await import(
  "../../frontend/src/js/blockchain/wallet-publishing.ts"
);

describe("CDP relay writes emit ASSET_PUBLISH_PENDING", () => {
  let pending;
  const onPending = (p) => pending.push(p);

  beforeEach(() => {
    pending = [];
    relayWrite.mockClear();
    walletState.set({ walletAddress: "0xabc", chainId: 84532 });
    on(EVENTS.ASSET_PUBLISH_PENDING, onPending);
  });

  afterEach(() => off(EVENTS.ASSET_PUBLISH_PENDING, onPending));

  async function expectPendingBeforeRelaySettles(run, payload) {
    const done = run();
    await Promise.resolve();
    expect(relayWrite).toHaveBeenCalledTimes(1);
    expect(pending).toEqual([{ ...payload, txHash: null }]);
    resolveRelay({ receipt: { transactionHash: "0xtx" } });
    await done;
  }

  test("publishAsset", async () => {
    await expectPendingBeforeRelaySettles(
      () => publishAsset("ipfs://col", "7", "0xroot", "ipfs://editors"),
      { tokenId: "7", tokenURI: "ipfs://col" }
    );
  });

  test("updateAssetURI", async () => {
    await expectPendingBeforeRelaySettles(
      () => updateAssetURI("7", "ipfs://new", []),
      { tokenId: "7", tokenURI: "ipfs://new" }
    );
  });
});

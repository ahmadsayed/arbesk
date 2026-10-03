// @test-env dom
/**
 * resolveSubjectChain: a profile subject that IS the connected wallet resolves
 * to the wallet's chain without probing — right after a mint the owned-token
 * lookup can still be empty, and the empty-profile fallback (first real
 * network) would send the owner's own tokenURI reads to the wrong chain.
 */
import { beforeEach, describe, expect, jest, mock, test } from "bun:test";

const fetchAssetLibrary = jest.fn(async () => ({ owned: [] }));
mock.module("../../frontend/src/js/ui/asset-library.ts", () => ({
  fetchAssetLibrary,
  expandTokenToAssets: jest.fn(),
  getReadableContract: jest.fn(),
}));

const { walletState } = await import("../../frontend/src/js/state/wallet-state.ts");
const { CHAIN_IDS } = await import("../../constants/chains.js");
const { resolveSubjectChain } = await import("../../frontend/src/js/ui/library-controller.ts");

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("resolveSubjectChain", () => {
  beforeEach(() => {
    fetchAssetLibrary.mockClear();
  });

  test("own profile resolves to the wallet chain without probing", async () => {
    walletState.set({ walletAddress: OWNER, chainId: CHAIN_IDS.HARDHAT_LOCAL });
    expect(await resolveSubjectChain(OWNER.toLowerCase())).toBe(CHAIN_IDS.HARDHAT_LOCAL);
    expect(fetchAssetLibrary).not.toHaveBeenCalled();
  });

  test("another address still probes candidate chains", async () => {
    walletState.set({ walletAddress: OWNER, chainId: CHAIN_IDS.HARDHAT_LOCAL });
    await resolveSubjectChain("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(fetchAssetLibrary).toHaveBeenCalled();
  });
});

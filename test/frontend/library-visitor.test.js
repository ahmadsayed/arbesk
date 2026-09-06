/**
 * @jest-environment jsdom
 *
 * Public profile / visitor mode (ui/library-controller.ts): anonymous
 * visitors with a `/library/<base58>` subject load the subject's owned
 * collections only (no shared), skip the sign-in gate, and get read-only
 * chrome; a subject equal to the connected wallet stays owner mode.
 * Network (asset-library), IPFS, and wallet state are mocked.
 */
import { jest, expect, test, describe, beforeEach } from "@jest/globals";

const SUBJECT = "0xccc626354a2ea985d4abdc1173597a46afc63595";
const OTHER_WALLET = "0x8f3c00000000000000000000000000000000009b2e";

function buildDom() {
  document.body.innerHTML = `
    <div id="libraryGate"></div>
    <div id="libraryMain" class="hidden"></div>
    <button id="libraryCreateCollectionBtn"></button>
    <button id="libraryUploadBtn"></button>
    <span id="libraryVisitorBadge" hidden></span>
    <select id="headerbarNetworkSelect">
      <option value="hardhat">Hardhat</option>
      <option value="baseSepolia">Base Sepolia</option>
    </select>
  `;
}

async function load({
  walletAddress = null,
  walletChainId = 31337,
  fetchResult = { owned: ["1"], shared: ["9"] },
  tokensByChain = null,
  failOnChains = [],
  noRealNetworks = false,
} = {}) {
  jest.resetModules();

  if (noRealNetworks) {
    // Simulate a pure local dev backend: no chain has a deployment block.
    await jest.unstable_mockModule("../../constants/chains.js", () => ({
      __esModule: true,
      CHAIN_IDS: { HARDHAT_LOCAL: 31415822, BASE_TESTNET: 84532 },
      SUPPORTED_CHAIN_IDS: [31415822, 84532],
      DEPLOYMENT_BLOCKS: { 31415822: 0, 84532: 0 },
      LOG_CHUNK_SIZES: { 31415822: 10000, 84532: 2000 },
    }));
  }

  const fetchAssetLibrary = jest.fn(async (_address, _force, opts) => {
    const chainId = opts?.chainId;
    if (failOnChains.includes(chainId)) {
      throw new Error("fetch failed: connection refused");
    }
    if (tokensByChain) {
      return { owned: tokensByChain[chainId] ?? [], shared: [] };
    }
    return fetchResult;
  });
  const expandTokenToAssets = jest.fn(async () => []);
  const getReadableContract = jest.fn(async (chainId) => ({
    read: { tokenURI: async () => "bafyCollection" },
    _chainId: chainId,
  }));
  const getFromRemoteIPFS = jest.fn(async () => ({ name: "Props Pack" }));

  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      __esModule: true,
      walletState: {
        get: jest.fn(() => ({
          walletAddress,
          // A disconnected viewer has no chain — the anonymous case.
          chainId: walletAddress ? walletChainId : null,
        })),
      },
      _resetForTesting: jest.fn(),
    }),
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/ui/asset-library.js",
    () => ({
      __esModule: true,
      fetchAssetLibrary,
      expandTokenToAssets,
      getReadableContract,
    }),
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({
      __esModule: true,
      getFromRemoteIPFS,
      getBlobFromRemoteIPFS: jest.fn(),
    }),
  );

  const stateMod = await import("../../frontend/src/js/state/library-state.js");
  const controller = await import(
    "../../frontend/src/js/ui/library-controller.js"
  );
  return {
    ...controller,
    libraryState: stateMod.libraryState,
    isLibraryVisitor: stateMod.isLibraryVisitor,
    mocks: { fetchAssetLibrary, getFromRemoteIPFS, getReadableContract },
  };
}

beforeEach(() => {
  buildDom();
});

describe("refreshLibraryData in visitor mode", () => {
  test("anonymous + subject loads owned-only and skips shared", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({ walletAddress: null });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    // Anonymous probe order: indexer-backed chains first (84532), which the
    // default mock answers, so the main fetch runs on 84532.
    expect(mocks.fetchAssetLibrary).toHaveBeenCalledWith(SUBJECT, false, {
      includeShared: false,
      chainId: 84532,
    });
    const { collections } = libraryState.get();
    // Only the owned token becomes a card — shared token "9" never appears.
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({
      tokenId: "1",
      name: "Props Pack",
      role: "owner",
    });
  });

  test("subject equal to the connected wallet keeps owner behavior", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({ walletAddress: SUBJECT });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    // Owner mode on a profile URL still probes real networks first — the
    // default mock answers on 84532, so the shared fetch runs there.
    expect(mocks.fetchAssetLibrary).toHaveBeenCalledWith(SUBJECT, false, {
      includeShared: true,
      chainId: 84532,
    });
    const { collections } = libraryState.get();
    expect(collections).toHaveLength(2);
    expect(collections.map((c) => c.role).sort()).toEqual(["editor", "owner"]);
  });

  test("no wallet and no subject bails without fetching", async () => {
    const { refreshLibraryData, mocks } = await load({ walletAddress: null });

    await refreshLibraryData();

    expect(mocks.fetchAssetLibrary).not.toHaveBeenCalled();
  });
});

describe("applyWalletGate with a profile subject", () => {
  test("anonymous without a subject shows the sign-in gate", async () => {
    const { applyWalletGate } = await load({ walletAddress: null });

    applyWalletGate(false);

    expect(
      document.getElementById("libraryGate").classList.contains("hidden"),
    ).toBe(false);
    expect(
      document.getElementById("libraryMain").classList.contains("hidden"),
    ).toBe(true);
  });

  test("anonymous with a subject skips the gate and shows the visitor badge", async () => {
    const { setLibrarySubject } = await load({ walletAddress: null });

    setLibrarySubject(SUBJECT); // applies the gate/chrome internally

    expect(
      document.getElementById("libraryGate").classList.contains("hidden"),
    ).toBe(true);
    expect(
      document.getElementById("libraryMain").classList.contains("hidden"),
    ).toBe(false);
    expect(document.getElementById("libraryCreateCollectionBtn").hidden).toBe(
      true,
    );
    expect(document.getElementById("libraryUploadBtn").hidden).toBe(true);
    const badge = document.getElementById("libraryVisitorBadge");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("Read-only · public library");
  });

  test("connected wallet different from the subject stays visitor mode", async () => {
    const { setLibrarySubject, applyWalletGate, isLibraryVisitor } =
      await load({ walletAddress: OTHER_WALLET });

    setLibrarySubject(SUBJECT);
    applyWalletGate(true);

    expect(isLibraryVisitor()).toBe(true);
    expect(document.getElementById("libraryCreateCollectionBtn").hidden).toBe(
      true,
    );
    expect(document.getElementById("libraryUploadBtn").hidden).toBe(true);
    expect(document.getElementById("libraryVisitorBadge").hidden).toBe(false);
  });

  test("connected wallet equal to the subject resumes owner mode", async () => {
    const { setLibrarySubject, applyWalletGate, isLibraryVisitor } =
      await load({ walletAddress: SUBJECT });

    setLibrarySubject(SUBJECT);
    applyWalletGate(true);

    expect(isLibraryVisitor()).toBe(false);
    expect(document.getElementById("libraryCreateCollectionBtn").hidden).toBe(
      false,
    );
    expect(document.getElementById("libraryUploadBtn").hidden).toBe(false);
    expect(document.getElementById("libraryVisitorBadge").hidden).toBe(true);
  });
});

describe("setLibrarySubject", () => {
  test("resets collection/selection/assets when the subject changes", async () => {
    const { libraryState, setLibrarySubject } = await load({
      walletAddress: null,
    });

    libraryState.set({
      currentCollectionTokenId: "5",
      selectedIds: ["collection-5"],
      assets: [{ id: "asset-5-root" }],
      collections: [{ id: "collection-5", tokenId: "5" }],
    });

    expect(setLibrarySubject(SUBJECT)).toBe(true);
    const state = libraryState.get();
    expect(state.subjectAddress).toBe(SUBJECT);
    expect(state.currentCollectionTokenId).toBeNull();
    expect(state.selectedIds).toEqual([]);
    expect(state.assets).toEqual([]);
    expect(state.collections).toEqual([]);
  });

  test("same subject again is a no-op (no reset)", async () => {
    const { libraryState, setLibrarySubject } = await load({
      walletAddress: null,
    });

    setLibrarySubject(SUBJECT);
    libraryState.set({
      currentCollectionTokenId: "5",
      selectedIds: ["collection-5"],
    });

    expect(setLibrarySubject(SUBJECT.toUpperCase().replace("0X", "0x"))).toBe(
      false,
    );
    expect(libraryState.get().currentCollectionTokenId).toBe("5");
    expect(libraryState.get().selectedIds).toEqual(["collection-5"]);
  });

  test("clearing the subject back to null counts as a change", async () => {
    const { libraryState, setLibrarySubject } = await load({
      walletAddress: null,
    });

    setLibrarySubject(SUBJECT);
    expect(setLibrarySubject(null)).toBe(true);
    expect(libraryState.get().subjectAddress).toBeNull();
  });
});

describe("subject chain resolution", () => {
  const HARDHAT = 31415822; // CHAIN_IDS.HARDHAT_LOCAL
  const BASE_SEPOLIA = 84532; // CHAIN_IDS.BASE_TESTNET (DEPLOYMENT_BLOCKS > 0)

  function calledChains(mock) {
    return mock.mock.calls.map((c) => c[2]?.chainId);
  }

  test("anonymous: resolves to the indexer-backed chain that has tokens", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({
        walletAddress: null,
        tokensByChain: { [BASE_SEPOLIA]: ["10", "11"] },
      });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    expect(libraryState.get().subjectChainId).toBe(BASE_SEPOLIA);
    // Probe hit on the first candidate, then the real fetch — Hardhat local
    // is never touched (no 127.0.0.1:8545 connection-refused storm).
    expect(calledChains(mocks.fetchAssetLibrary)).toEqual([
      BASE_SEPOLIA,
      BASE_SEPOLIA,
    ]);
    expect(libraryState.get().collections).toHaveLength(2);
    // Collection metadata reads honor the resolved chain too.
    expect(mocks.getReadableContract).toHaveBeenCalledWith(BASE_SEPOLIA);
  });

  test("selector display syncs to the resolved profile chain", async () => {
    const { setLibrarySubject, refreshLibraryData } = await load({
      walletAddress: null,
      tokensByChain: { [BASE_SEPOLIA]: ["10"] },
    });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    const netSel = document.getElementById("headerbarNetworkSelect");
    expect(netSel.value).toBe("baseSepolia");
  });

  test("connected viewer on a different chain still finds the subject's chain", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({
        walletAddress: OTHER_WALLET,
        walletChainId: HARDHAT,
        tokensByChain: { [BASE_SEPOLIA]: ["7"] },
      });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    // Real networks probe first: the indexer chain hits before the wallet's
    // local chain is ever tried (probe + fetch, both on 84532).
    expect(calledChains(mocks.fetchAssetLibrary)).toEqual([
      BASE_SEPOLIA,
      BASE_SEPOLIA,
    ]);
    expect(libraryState.get().subjectChainId).toBe(BASE_SEPOLIA);
    expect(libraryState.get().collections).toHaveLength(1);
    expect(libraryState.get().collections[0].tokenId).toBe("7");
  });

  test("wallet chain is probed after real networks but before local", async () => {
    const walletChain = 31337; // neither indexer-backed nor Hardhat local
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({
        walletAddress: OTHER_WALLET,
        walletChainId: walletChain,
        tokensByChain: { [walletChain]: ["9"] },
      });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    // 84532 (real, empty) → 31337 (wallet, hit) → local never probed.
    expect(calledChains(mocks.fetchAssetLibrary)).toEqual([
      BASE_SEPOLIA,
      walletChain,
      walletChain,
    ]);
    expect(libraryState.get().subjectChainId).toBe(walletChain);
    expect(libraryState.get().collections).toHaveLength(1);
  });

  test("RPC failure on one candidate falls through to the next", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({
        walletAddress: null,
        tokensByChain: { [HARDHAT]: ["3"] },
        failOnChains: [BASE_SEPOLIA],
      });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    expect(calledChains(mocks.fetchAssetLibrary).slice(0, 2)).toEqual([
      BASE_SEPOLIA,
      HARDHAT,
    ]);
    expect(libraryState.get().subjectChainId).toBe(HARDHAT);
    expect(libraryState.get().collections).toHaveLength(1);
  });

  test("no tokens anywhere: renders empty on the first REAL network, not local", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData } = await load({
      walletAddress: null,
      tokensByChain: {},
    });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    expect(libraryState.get().subjectChainId).toBe(BASE_SEPOLIA);
    expect(libraryState.get().collections).toEqual([]);
    expect(libraryState.get().isLoading).toBe(false);
  });

  test("empty-everywhere with a connected local wallet still defaults to the real network", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData } = await load({
      walletAddress: OTHER_WALLET,
      walletChainId: HARDHAT,
      tokensByChain: {},
    });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    expect(libraryState.get().subjectChainId).toBe(BASE_SEPOLIA);
    expect(libraryState.get().collections).toEqual([]);
  });

  test("owner on their own profile URL finds local tokens past the real-network probe", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData, mocks } =
      await load({
        walletAddress: SUBJECT,
        walletChainId: HARDHAT,
        tokensByChain: { [HARDHAT]: ["5"] },
      });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    // 84532 (real, empty) falls through to the wallet/local chain (hit).
    expect(calledChains(mocks.fetchAssetLibrary)).toEqual([
      BASE_SEPOLIA,
      HARDHAT,
      HARDHAT,
    ]);
    expect(libraryState.get().subjectChainId).toBe(HARDHAT);
    expect(libraryState.get().collections).toHaveLength(1);
  });
  // NOTE: keep LAST — the constants/chains.js mock it registers leaks across
  // jest.resetModules() into later imports in this file.
  test("no real network configured at all falls back to Hardhat local", async () => {
    const { libraryState, setLibrarySubject, refreshLibraryData } = await load({
      walletAddress: null,
      tokensByChain: {},
      noRealNetworks: true,
    });

    setLibrarySubject(SUBJECT);
    await refreshLibraryData();

    expect(libraryState.get().subjectChainId).toBe(HARDHAT);
    expect(libraryState.get().collections).toEqual([]);
  });

});

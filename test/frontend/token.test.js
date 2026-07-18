/** @jest-environment jsdom */
import { jest } from "@jest/globals";

const CID = "bafyTokenCid";
const OWNER = "0x0000000000000000000000000000000000000001";
const TOKEN_ID = 42;

function makeContract(overrides = {}) {
  const calls = {
    tokenURI: jest.fn(async () => CID),
    ownerOf: jest.fn(async () => OWNER),
    ...overrides,
  };
  return {
    methods: {
      tokenURI: (id) => ({ call: async () => calls.tokenURI(id) }),
      ownerOf: (id) => ({ call: async () => calls.ownerOf(id) }),
    },
    _calls: calls,
  };
}

async function loadModule({ contract = null, walletStateValue = null, remoteIPFS = null } = {}) {
  jest.resetModules();

  const walletModule = {
    contract,
    getActiveContract: () => contract ?? walletStateValue?.contract ?? null,
  };
  const walletStateModule = {
    walletState: {
      get: jest.fn(() => walletStateValue ?? {}),
    },
  };
  const remoteIPFSModule = {
    getFromRemoteIPFS: remoteIPFS ?? jest.fn(async () => ({ name: "Mock Asset", assets: {} })),
  };

  jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
    __esModule: true,
    ...walletModule,
  }));
  jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.js", () => ({
    __esModule: true,
    ...walletStateModule,
  }));
  jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    __esModule: true,
    ...remoteIPFSModule,
  }));

  const mod = await import("../../frontend/src/js/services/token.js");
  return { mod, walletStateModule, remoteIPFSModule };
}

describe("token service", () => {
  describe("getTokenURI", () => {
    it("returns the tokenURI CID from the contract", async () => {
      const c = makeContract();
      const { mod } = await loadModule({ contract: c });
      const cid = await mod.getTokenURI(TOKEN_ID);
      expect(cid).toBe(CID);
      expect(c._calls.tokenURI).toHaveBeenCalledWith(String(TOKEN_ID));
    });

    it("returns null when no contract is available", async () => {
      const { mod } = await loadModule({ contract: null, walletStateValue: {} });
      const cid = await mod.getTokenURI(TOKEN_ID);
      expect(cid).toBeNull();
    });
  });

  describe("getOwnerOf", () => {
    it("returns the token owner", async () => {
      const c = makeContract();
      const { mod } = await loadModule({ contract: c });
      const owner = await mod.getOwnerOf(TOKEN_ID);
      expect(owner).toBe(OWNER);
      expect(c._calls.ownerOf).toHaveBeenCalledWith(String(TOKEN_ID));
    });

    it("returns null when the token does not exist (contract throws)", async () => {
      const c = makeContract({
        ownerOf: jest.fn(async () => {
          throw new Error("ERC721NonexistentToken");
        }),
      });
      const { mod } = await loadModule({ contract: c });
      const owner = await mod.getOwnerOf(999);
      expect(owner).toBeNull();
    });
  });

  describe("tokenExists", () => {
    it("returns true when the token has an owner", async () => {
      const { mod } = await loadModule({ contract: makeContract() });
      expect(await mod.tokenExists(TOKEN_ID)).toBe(true);
    });

    it("returns false when the token has no owner", async () => {
      const c = makeContract({
        ownerOf: jest.fn(async () => {
          throw new Error("ERC721NonexistentToken");
        }),
      });
      const { mod } = await loadModule({ contract: c });
      expect(await mod.tokenExists(999)).toBe(false);
    });
  });

  describe("getAssetName", () => {
    it("resolves the asset name from the tokenURI manifest", async () => {
      const remoteIPFS = jest.fn(async () => ({ name: "Hero Sword" }));
      const { mod } = await loadModule({ contract: makeContract(), remoteIPFS });
      const name = await mod.getAssetName(TOKEN_ID);
      expect(name).toBe("Hero Sword");
      expect(remoteIPFS).toHaveBeenCalledWith(CID);
    });

    it("returns null when resolving the manifest fails", async () => {
      const remoteIPFS = jest.fn(async () => {
        throw new Error("IPFS unavailable");
      });
      const { mod } = await loadModule({ contract: makeContract(), remoteIPFS });
      const name = await mod.getAssetName(TOKEN_ID);
      expect(name).toBeNull();
    });
  });

  describe("getCollectionManifest", () => {
    it("returns the manifest object for the token", async () => {
      const manifest = { type: "collection", assets: { a: "bafyA" } };
      const remoteIPFS = jest.fn(async () => manifest);
      const { mod } = await loadModule({ contract: makeContract(), remoteIPFS });
      const result = await mod.getCollectionManifest(TOKEN_ID);
      expect(result).toEqual(manifest);
      expect(remoteIPFS).toHaveBeenCalledWith(CID);
    });
  });
});

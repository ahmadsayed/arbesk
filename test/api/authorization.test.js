/**
 * @jest-environment node
 */

import { jest } from "@jest/globals";

const mockValidateSession = jest.fn();
const mockGetContractAddress = jest.fn();
const mockGetWeb3 = jest.fn();
const mockMakeLeaf = jest.fn();
const mockVerifyProof = jest.fn();

jest.unstable_mockModule("../../src/api/sessions.js", () => ({
  validateSession: mockValidateSession,
}));

jest.unstable_mockModule("../../src/config.js", () => ({
  getContractAddress: mockGetContractAddress,
  getWeb3: mockGetWeb3,
}));

jest.unstable_mockModule("../../src/api/merkle-editors-node.js", () => ({
  makeLeaf: mockMakeLeaf,
  verifyProof: mockVerifyProof,
}));

const {
  checkAssetAccess,
  authorizeAssetAccess,
  getTokenUri,
} = await import("../../src/api/authorization.js");

describe("authorization", () => {
  const CONTRACT = "0xContractAddress0000000000000000000000000001";
  const OWNER = "0xOwner000000000000000000000000000000000001";
  const EDITOR = "0xEditor00000000000000000000000000000000001";
  const STRANGER = "0xStranger000000000000000000000000000000001";
  const CHAIN_ID = 31415822;
  const ZERO_ROOT =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const REAL_ROOT =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

  let contractCallState;

  function fakeContract() {
    const makeMethod = (key) => (tokenId) => ({
      call: async () => {
        if (!Object.prototype.hasOwnProperty.call(contractCallState, key)) {
          throw new Error(`Unexpected contract call: ${key}(${tokenId})`);
        }
        return contractCallState[key];
      },
    });
    return {
      methods: {
        ownerOf: makeMethod("ownerOf"),
        editorRoot: makeMethod("editorRoot"),
        editorSetVersion: makeMethod("editorSetVersion"),
        tokenURI: makeMethod("tokenURI"),
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    contractCallState = {};

    mockGetContractAddress.mockImplementation((chainId) => {
      return chainId === CHAIN_ID ? CONTRACT : null;
    });

    mockGetWeb3.mockImplementation(() => ({
      eth: { Contract: jest.fn(() => fakeContract()) },
    }));

    mockMakeLeaf.mockImplementation(
      (address, role, tokenId) => `leaf:${address}:${role}:${tokenId}`,
    );
    mockVerifyProof.mockReturnValue(false);
  });

  describe("checkAssetAccess", () => {
    it("allows owner access with role 2", async () => {
      contractCallState.ownerOf = OWNER;

      const result = await checkAssetAccess(1, CHAIN_ID, OWNER);

      expect(result).toEqual({
        allowed: true,
        assetId: `${CHAIN_ID}:${CONTRACT}:1`,
        chainId: CHAIN_ID,
        isOwner: true,
        role: 2,
      });
    });

    it("allows non-owner with valid Merkle proof", async () => {
      contractCallState.ownerOf = OWNER;
      contractCallState.editorRoot = REAL_ROOT;
      contractCallState.editorSetVersion = 7;
      mockVerifyProof.mockReturnValue(true);

      const result = await checkAssetAccess(42, CHAIN_ID, EDITOR, {
        proof: ["0xabc"],
        requiredRole: 2,
      });

      expect(result).toEqual({
        allowed: true,
        assetId: `${CHAIN_ID}:${CONTRACT}:42`,
        chainId: CHAIN_ID,
        isOwner: false,
        role: 2,
      });
      expect(mockMakeLeaf).toHaveBeenCalledWith(
        EDITOR.toLowerCase(),
        2,
        "42",
        "7",
      );
      expect(mockVerifyProof).toHaveBeenCalledWith(
        REAL_ROOT,
        `leaf:${EDITOR.toLowerCase()}:2:42`,
        ["0xabc"],
      );
    });

    it("denies non-owner with invalid proof", async () => {
      contractCallState.ownerOf = OWNER;
      contractCallState.editorRoot = REAL_ROOT;
      contractCallState.editorSetVersion = 1;
      mockVerifyProof.mockReturnValue(false);

      const result = await checkAssetAccess(3, CHAIN_ID, STRANGER, {
        proof: ["0xbad"],
        requiredRole: 1,
      });

      expect(result).toEqual({
        allowed: false,
        assetId: `${CHAIN_ID}:${CONTRACT}:3`,
        chainId: CHAIN_ID,
        isOwner: false,
        role: 0,
      });
    });

    it("denies non-owner when editorRoot is zero bytes", async () => {
      contractCallState.ownerOf = OWNER;
      contractCallState.editorRoot = ZERO_ROOT;
      contractCallState.editorSetVersion = 1;

      const result = await checkAssetAccess(5, CHAIN_ID, EDITOR, {
        proof: ["0xabc"],
        requiredRole: 2,
      });

      expect(result.allowed).toBe(false);
      expect(result.isOwner).toBe(false);
      expect(result.role).toBe(0);
      expect(mockVerifyProof).not.toHaveBeenCalled();
    });

    it("throws when contract address is missing for chainId", async () => {
      mockGetContractAddress.mockReturnValue(null);

      await expect(checkAssetAccess(1, 999, OWNER)).rejects.toThrow(
        "No contract address for chain 999",
      );
    });

    it("throws for non-numeric tokenId", async () => {
      await expect(checkAssetAccess("not-a-number", CHAIN_ID, OWNER)).rejects.toThrow(
        "Invalid tokenId",
      );
    });

    it("throws for negative tokenId", async () => {
      await expect(checkAssetAccess(-1, CHAIN_ID, OWNER)).rejects.toThrow(
        "Invalid tokenId",
      );
    });

    it("uses the contractAddress override instead of the chain default", async () => {
      const OVERRIDE = "0xOverride0000000000000000000000000000000001";
      contractCallState.ownerOf = OWNER;

      const result = await checkAssetAccess(1, CHAIN_ID, OWNER, {
        contractAddress: OVERRIDE,
      });

      expect(result.allowed).toBe(true);
      expect(result.assetId).toBe(`${CHAIN_ID}:${OVERRIDE}:1`);
    });

    it("override wins even when the chain has no configured contract", async () => {
      const OVERRIDE = "0xOverride0000000000000000000000000000000001";
      mockGetContractAddress.mockReturnValue(null);
      contractCallState.ownerOf = OWNER;

      const result = await checkAssetAccess(1, 999, OWNER, {
        contractAddress: OVERRIDE,
      });

      expect(result.allowed).toBe(true);
      expect(result.isOwner).toBe(true);
    });
  });

  describe("getTokenUri", () => {
    it("returns the tokenURI from the chain contract", async () => {
      contractCallState.tokenURI = "bafyCollection";

      const uri = await getTokenUri(1, CHAIN_ID);

      expect(uri).toBe("bafyCollection");
    });

    it("honors the contractAddress override", async () => {
      const OVERRIDE = "0xOverride0000000000000000000000000000000001";
      mockGetContractAddress.mockReturnValue(null);
      contractCallState.tokenURI = "bafyOverrideCollection";

      const uri = await getTokenUri(1, 999, { contractAddress: OVERRIDE });

      expect(uri).toBe("bafyOverrideCollection");
    });

    it("throws when no contract can be resolved", async () => {
      mockGetContractAddress.mockReturnValue(null);

      await expect(getTokenUri(1, 999)).rejects.toThrow(
        "No contract address for chain 999",
      );
    });
  });

  describe("authorizeAssetAccess", () => {
    it("returns null for invalid session token", async () => {
      mockValidateSession.mockReturnValue(null);

      const result = await authorizeAssetAccess("bad-token", 1, CHAIN_ID);

      expect(result).toBeNull();
      expect(mockValidateSession).toHaveBeenCalledWith("bad-token");
    });

    it("returns address plus access result for valid session", async () => {
      contractCallState.ownerOf = OWNER;
      mockValidateSession.mockReturnValue(OWNER);

      const result = await authorizeAssetAccess("valid-token", 1, CHAIN_ID);

      expect(result).toEqual({
        allowed: true,
        assetId: `${CHAIN_ID}:${CONTRACT}:1`,
        chainId: CHAIN_ID,
        address: OWNER,
        isOwner: true,
        role: 2,
      });
    });
  });
});

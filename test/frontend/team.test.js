/** @jest-environment jsdom */
import { jest } from "@jest/globals";

const contractMock = {
  methods: {
    editorListURI: jest.fn(() => ({ call: jest.fn() })),
    ownerOf: jest.fn(() => ({ call: jest.fn() })),
    editorSetVersion: jest.fn(() => ({ call: jest.fn() })),
  },
};

const updateEditorsMock = jest.fn();
const getFromRemoteIPFSMock = jest.fn();
const writeJSONToIPFSMock = jest.fn();
const computeRootMock = jest.fn();
const getProofMock = jest.fn();
const requireWalletMock = jest.fn();
const walletStateGetMock = jest.fn(() => ({ walletAddress: "0xOwnerAddress" }));

jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
  contract: contractMock,
  getActiveContract: () => contractMock ?? walletStateGetMock()?.contract ?? null,
  updateEditors: updateEditorsMock,
  CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
}));

jest.unstable_mockModule("../../frontend/src/js/state/wallet-state.js", () => ({
  walletState: { get: walletStateGetMock },
}));

jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: getFromRemoteIPFSMock,
}));

jest.unstable_mockModule("../../frontend/src/js/ipfs/write-to-ipfs.js", () => ({
  writeJSONToIPFS: writeJSONToIPFSMock,
}));

jest.unstable_mockModule("../../frontend/src/js/gltf/merkle-editors.js", () => ({
  computeRoot: computeRootMock,
  getProof: getProofMock,
  MAX_EDITORS_PER_TOKEN: 5000,
}));

jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-guard.js", () => ({
  requireWallet: requireWalletMock,
}));

const team = await import("../../frontend/src/js/services/team.js");

describe("team service", () => {
  const editorList = [
    { address: "0xOwnerAddress", role: 2 },
    { address: "0xEditorAddress", role: 2 },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    contractMock.methods.editorListURI.mockReturnValue({
      call: jest.fn().mockResolvedValue("bafyEditors"),
    });
    contractMock.methods.ownerOf.mockReturnValue({
      call: jest.fn().mockResolvedValue("0xOwnerAddress"),
    });
    contractMock.methods.editorSetVersion.mockReturnValue({
      call: jest.fn().mockResolvedValue("5"),
    });
    getFromRemoteIPFSMock.mockResolvedValue(editorList);
    writeJSONToIPFSMock.mockResolvedValue("bafyNewEditors");
    updateEditorsMock.mockResolvedValue("0xTxHash");
    computeRootMock.mockReturnValue("0xNewRoot");
    getProofMock.mockReturnValue({ role: 2, proof: ["0xabc"] });
    requireWalletMock.mockReturnValue({ walletAddress: "0xOwnerAddress" });
    walletStateGetMock.mockReturnValue({ walletAddress: "0xOwnerAddress" });
  });

  describe("fetchEditors", () => {
    it("returns an empty array when tokenId is missing", async () => {
      expect(await team.fetchEditors("")).toEqual([]);
      expect(contractMock.methods.editorListURI).not.toHaveBeenCalled();
    });

    it("loads the editor list from chain + IPFS and caches it locally", async () => {
      const result = await team.fetchEditors("42");
      expect(result).toEqual(editorList);
      expect(contractMock.methods.editorListURI).toHaveBeenCalledWith("42");
      expect(getFromRemoteIPFSMock).toHaveBeenCalledWith("bafyEditors");
      const stored = JSON.parse(localStorage.getItem("arbesk_editor_list_42"));
      expect(stored.list).toEqual(editorList);
      expect(stored.cid).toBe("bafyEditors");
    });

    it("falls back to localStorage when chain/IPFS fails", async () => {
      contractMock.methods.editorListURI.mockImplementation(() => {
        throw new Error("chain down");
      });
      getFromRemoteIPFSMock.mockRejectedValue(new Error("ipfs down"));
      localStorage.setItem(
        "arbesk_editor_list_42",
        JSON.stringify({ list: editorList, cid: "bafyOld" }),
      );

      const result = await team.fetchEditors("42");
      expect(result).toEqual(editorList);
    });

    it("falls back to the cached list when the IPFS CID is stale", async () => {
      getFromRemoteIPFSMock.mockRejectedValue(new Error("ipfs down"));
      localStorage.setItem(
        "arbesk_editor_list_42",
        JSON.stringify({ list: editorList, cid: "bafyStale" }),
      );

      const result = await team.fetchEditors("42");
      expect(result).toEqual(editorList);
    });

    it("returns an empty array when everything fails", async () => {
      contractMock.methods.editorListURI.mockImplementation(() => {
        throw new Error("chain down");
      });
      getFromRemoteIPFSMock.mockRejectedValue(new Error("ipfs down"));
      expect(await team.fetchEditors("42")).toEqual([]);
    });

    it("uses walletState contract when the module-level contract is null", async () => {
      const methods = {
        editorListURI: jest.fn(() => ({ call: jest.fn().mockResolvedValue("bafyFromState") })),
      };
      jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
        contract: null,
        getActiveContract: () => walletStateGetMock()?.contract ?? null,
        updateEditors: updateEditorsMock,
        CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
      }));
      walletStateGetMock.mockReturnValue({ contract: { methods }, walletAddress: "0xOwnerAddress" });
      getFromRemoteIPFSMock.mockResolvedValue(editorList);

      jest.resetModules();
      const fresh = await import("../../frontend/src/js/services/team.js");
      const result = await fresh.fetchEditors("42");
      expect(result).toEqual(editorList);
      expect(methods.editorListURI).toHaveBeenCalledWith("42");
    });
  });

  describe("isOwner", () => {
    it("returns true when the connected wallet owns the token", async () => {
      expect(await team.isOwner("42")).toBe(true);
    });

    it("returns false when the owner address differs", async () => {
      contractMock.methods.ownerOf.mockReturnValue({
        call: jest.fn().mockResolvedValue("0xOtherAddress"),
      });
      expect(await team.isOwner("42")).toBe(false);
    });

    it("returns false when there is no connected wallet", async () => {
      walletStateGetMock.mockReturnValue({ walletAddress: null });
      expect(await team.isOwner("42")).toBe(false);
    });

    it("returns false when ownerOf throws", async () => {
      contractMock.methods.ownerOf.mockImplementation(() => {
        throw new Error("revert");
      });
      expect(await team.isOwner("42")).toBe(false);
    });
  });

  describe("saveEditorListLocally", () => {
    it("caches the editor list and CID", () => {
      team.saveEditorListLocally("42", editorList, "bafyCid");
      const stored = JSON.parse(localStorage.getItem("arbesk_editor_list_42"));
      expect(stored.list).toEqual(editorList);
      expect(stored.cid).toBe("bafyCid");
    });

    it("does not throw when localStorage is unavailable", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const original = localStorage.setItem;
      localStorage.setItem = jest.fn(() => {
        throw new Error("quota exceeded");
      });

      expect(() =>
        team.saveEditorListLocally("42", editorList, "bafyCid"),
      ).not.toThrow();

      localStorage.setItem = original;
      warnSpy.mockRestore();
    });
  });

  describe("addTeamMember", () => {
    it("adds a new editor and updates the Merkle root", async () => {
      const txHash = await team.addTeamMember("42", "0xNewEditor");
      expect(txHash).toBe("0xTxHash");
      expect(updateEditorsMock).toHaveBeenCalledWith(
        "42",
        "0xNewRoot",
        "bafyNewEditors",
        2,
        ["0xabc"],
      );
    });

    it("throws when the address is invalid", async () => {
      await expect(team.addTeamMember("42", "not-an-address")).rejects.toThrow(
        "Invalid Ethereum address",
      );
    });

    it("throws when the address is already an editor", async () => {
      await expect(
        team.addTeamMember("42", "0xEditorAddress"),
      ).rejects.toThrow("already an editor");
    });

    it("throws when the editor list is already at the cap", async () => {
      const fullList = Array.from({ length: 5000 }, (_, i) => ({
        address: `0x${String(i + 1).padStart(40, "0")}`,
        role: 2,
      }));
      getFromRemoteIPFSMock.mockResolvedValue(fullList);

      await expect(team.addTeamMember("42", "0xNewEditor")).rejects.toThrow(
        "Editor limit reached",
      );
      expect(updateEditorsMock).not.toHaveBeenCalled();
      expect(writeJSONToIPFSMock).not.toHaveBeenCalled();
    });

    it("throws when the current wallet is not an editor", async () => {
      getProofMock.mockReturnValue(null);
      await expect(team.addTeamMember("42", "0xNewEditor")).rejects.toThrow(
        "not an editor",
      );
    });

    it("throws when the on-chain update returns no tx hash", async () => {
      updateEditorsMock.mockResolvedValue(null);
      await expect(team.addTeamMember("42", "0xNewEditor")).rejects.toThrow(
        "transaction failed",
      );
    });
  });

  describe("removeTeamMember", () => {
    it("removes an editor and updates the Merkle root", async () => {
      const txHash = await team.removeTeamMember("42", "0xEditorAddress");
      expect(txHash).toBe("0xTxHash");
      expect(updateEditorsMock).toHaveBeenCalled();
    });

    it("throws when the address is not an editor", async () => {
      await expect(
        team.removeTeamMember("42", "0xNotAnEditor"),
      ).rejects.toThrow("not an editor");
    });

    it("throws when removing the last editor", async () => {
      getFromRemoteIPFSMock.mockResolvedValue([
        { address: "0xOwnerAddress", role: 2 },
      ]);
      await expect(
        team.removeTeamMember("42", "0xOwnerAddress"),
      ).rejects.toThrow("last editor");
    });
  });

  describe("changeTeamMemberRole", () => {
    it("changes the role of an existing collaborator", async () => {
      const txHash = await team.changeTeamMemberRole(
        "42",
        "0xEditorAddress",
        1,
      );
      expect(txHash).toBe("0xTxHash");
      expect(updateEditorsMock).toHaveBeenCalled();
    });

    it("throws when the address is not a collaborator", async () => {
      await expect(
        team.changeTeamMemberRole("42", "0xNotAnEditor", 1),
      ).rejects.toThrow("not a collaborator");
    });
  });

  describe("getEditorSetVersion", () => {
    it("returns the on-chain editor set version", async () => {
      expect(await team.getEditorSetVersion("42")).toBe(5);
    });

    it("falls back to version 1 when the call fails", async () => {
      contractMock.methods.editorSetVersion.mockImplementation(() => {
        throw new Error("revert");
      });
      expect(await team.getEditorSetVersion("42")).toBe(1);
    });
  });
});

/**
 * @jest-environment jsdom
 */
import { jest, expect, test, beforeAll, beforeEach, describe } from "@jest/globals";

const soliditySha3 = jest.fn((...args) => {
  const payload = args.map((a) => JSON.stringify(a)).join("");
  const hex = Array.from(payload)
    .reduce((acc, c, i) => acc + ((c.charCodeAt(0) + i) % 16).toString(16), "")
    .slice(0, 64)
    .padStart(64, "0");
  return "0x" + hex;
});

class FakeSimpleMerkleTree {
  constructor(leaves) {
    this._leaves = leaves;
    this.root =
      leaves.length > 0
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  getProof() {
    return ["0x2222222222222222222222222222222222222222222222222222222222222222"];
  }
  static of(leaves) {
    return new FakeSimpleMerkleTree(leaves);
  }
  static verify(root, _leaf, proof) {
    if (!root || root === "0x".padEnd(66, "0")) return false;
    return Array.isArray(proof) && proof.length > 0 && proof[0].startsWith("0x");
  }
}

jest.unstable_mockModule("@openzeppelin/merkle-tree", () => ({
  SimpleMerkleTree: FakeSimpleMerkleTree,
}));

jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
  getActiveContract: jest.fn(),
  CollaboratorRole: { None: 0, Viewer: 1, Editor: 2 },
}));

jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: jest.fn(),
}));

let editors;

beforeAll(async () => {
  global.window.Web3 = { utils: { soliditySha3 } };
  editors = await import("../../frontend/src/js/domain/editors.js");
});

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("cache", () => {
  test("saveEditorList / loadEditorList round-trip via localStorage", async () => {
    const list = [{ address: "0xA", role: 2 }];
    editors.saveEditorList("42", list, "bafyCid");
    const loaded = await editors.loadEditorList("42");
    expect(loaded).toEqual(list);
  });

  test("clearEditorCache removes the stored list", async () => {
    editors.saveEditorList("42", [{ address: "0xA", role: 2 }], "bafyCid");
    editors.clearEditorCache("42");
    const loaded = await editors.loadEditorList("42");
    expect(loaded).toEqual([]);
  });
});

describe("buildEditorProof", () => {
  test("returns proof for a listed editor", async () => {
    const { getActiveContract } = await import(
      "../../frontend/src/js/blockchain/wallet.js"
    );
    const { getFromRemoteIPFS } = await import(
      "../../frontend/src/js/ipfs/remote-ipfs.js"
    );
    getActiveContract.mockReturnValue({
      methods: {
        editorListURI: () => ({ call: () => Promise.resolve("bafyEditors") }),
        editorSetVersion: () => ({ call: () => Promise.resolve("3") }),
      },
    });
    getFromRemoteIPFS.mockResolvedValue([
      { address: "0xA", role: 2 },
      { address: "0xB", role: 2 },
    ]);

    const result = await editors.buildEditorProof("42", "0xA");
    expect(result).toEqual({
      proof: [
        "0x2222222222222222222222222222222222222222222222222222222222222222",
      ],
      role: 2,
    });
  });
});

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

let editors;
let initRuntime;
let _resetRuntimeForTesting;

// Port seams (previously: window.Web3 + mocked blockchain/wallet + ipfs/remote-ipfs).
const getEditorListURI = jest.fn(async () => null);
const getEditorListVersion = jest.fn(async () => 1);
const ipfsGetJSON = jest.fn(async () => ({}));

beforeAll(async () => {
  ({ initRuntime, _resetRuntimeForTesting } = await import(
    "@arbesk/asset-core/runtime.js"
  ));
  editors = await import("@arbesk/asset-core/domain/editors.js");
});

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  getEditorListURI.mockResolvedValue(null);
  getEditorListVersion.mockResolvedValue(1);
  ipfsGetJSON.mockResolvedValue({});
  _resetRuntimeForTesting();
  initRuntime({
    ipfsRead: { getJSON: ipfsGetJSON },
    ipfsWrite: { write: async () => "", writeJSON: async () => "" },
    hash: { soliditySha3, keccak256: () => "0x" },
    storage: {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
    },
    chain: { getEditorListURI, getEditorListVersion },
  });
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
    getEditorListURI.mockResolvedValue("bafyEditors");
    getEditorListVersion.mockResolvedValue(3);
    ipfsGetJSON.mockResolvedValue([
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

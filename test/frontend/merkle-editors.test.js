/**
 * @jest-environment jsdom
 */

import { jest } from "@jest/globals";

const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const FAKE_ROOT =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const FAKE_PROOF = [
  "0x2222222222222222222222222222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333333333333333333333333333",
];

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
    this.root = leaves.length > 0 ? FAKE_ROOT : ZERO_ROOT;
  }

  getProof() {
    return FAKE_PROOF;
  }

  static of(leaves) {
    return new FakeSimpleMerkleTree(leaves);
  }

  static verify(root, _leaf, proof) {
    if (!root || root === ZERO_ROOT) return false;
    if (!Array.isArray(proof) || proof.length === 0) return false;
    return proof.every((p) => typeof p === "string" && p.startsWith("0x"));
  }
}

jest.unstable_mockModule("@openzeppelin/merkle-tree", () => ({
  SimpleMerkleTree: FakeSimpleMerkleTree,
}));

let merkleEditors;

describe("merkle-editors", () => {
  beforeAll(async () => {
    global.window.Web3 = { utils: { soliditySha3 } };
    merkleEditors = await import("../../frontend/src/js/gltf/merkle-editors.js");
  });

  beforeEach(() => {
    soliditySha3.mockClear();
  });

  test("makeLeaf returns a 0x-prefixed 64-char hex string", () => {
    const leaf = merkleEditors.makeLeaf(
      "0x1234567890abcdef1234567890abcdef12345678",
      2,
      1,
      1
    );
    expect(leaf).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(soliditySha3).toHaveBeenCalledWith(
      { type: "address", value: "0x1234567890abcdef1234567890abcdef12345678" },
      { type: "uint8", value: 2 },
      { type: "uint256", value: 1 },
      { type: "uint256", value: 1 }
    );
  });

  test("computeRoot returns zero bytes for empty list", () => {
    const root = merkleEditors.computeRoot([], 1, 1);
    expect(root).toBe(ZERO_ROOT);
  });

  test("computeRoot returns non-zero root for non-empty list", () => {
    const editors = [{ address: "0x1111111111111111111111111111111111111111", role: 2 }];
    const root = merkleEditors.computeRoot(editors, 1, 1);
    expect(root).not.toBe(ZERO_ROOT);
    expect(root).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  test("computeRoot accepts exactly MAX_EDITORS_PER_TOKEN members", () => {
    const editors = Array.from(
      { length: merkleEditors.MAX_EDITORS_PER_TOKEN },
      (_, i) => ({
        address: `0x${String(i + 1).padStart(40, "0")}`,
        role: 2,
      })
    );
    expect(merkleEditors.computeRoot(editors, 1, 1)).toBe(FAKE_ROOT);
  });

  test("computeRoot throws above MAX_EDITORS_PER_TOKEN members", () => {
    const editors = Array.from(
      { length: merkleEditors.MAX_EDITORS_PER_TOKEN + 1 },
      (_, i) => ({
        address: `0x${String(i + 1).padStart(40, "0")}`,
        role: 2,
      })
    );
    expect(() => merkleEditors.computeRoot(editors, 1, 1)).toThrow(
      /maximum is 5000/
    );
  });

  test("getProof returns proof+role for listed editor", () => {
    const editors = [
      { address: "0x1111111111111111111111111111111111111111", role: 1 },
      { address: "0x2222222222222222222222222222222222222222", role: 2 },
    ];
    const result = merkleEditors.getProof(editors, "0x2222222222222222222222222222222222222222", 1, 1);
    expect(result).toEqual({ proof: FAKE_PROOF, role: 2 });
  });

  test("getProof returns null for missing editor", () => {
    const editors = [{ address: "0x1111111111111111111111111111111111111111", role: 1 }];
    const result = merkleEditors.getProof(editors, "0x9999999999999999999999999999999999999999", 1, 1);
    expect(result).toBeNull();
  });

  test("getProof returns null for empty list", () => {
    const result = merkleEditors.getProof([], "0x1111111111111111111111111111111111111111", 1, 1);
    expect(result).toBeNull();
  });

  test("verifyProof true for valid root/leaf/proof", () => {
    const leaf = merkleEditors.makeLeaf("0x1111111111111111111111111111111111111111", 2, 1, 1);
    const ok = merkleEditors.verifyProof(FAKE_ROOT, leaf, FAKE_PROOF);
    expect(ok).toBe(true);
  });

  test("verifyProof false for zero root or invalid proof", () => {
    const leaf = merkleEditors.makeLeaf("0x1111111111111111111111111111111111111111", 2, 1, 1);
    expect(merkleEditors.verifyProof(ZERO_ROOT, leaf, FAKE_PROOF)).toBe(false);
    expect(merkleEditors.verifyProof(FAKE_ROOT, leaf, [])).toBe(false);
    expect(merkleEditors.verifyProof(FAKE_ROOT, leaf, ["not-a-hex"])).toBe(false);
  });
});

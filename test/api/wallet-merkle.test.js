import {
  makeLeaf,
  computeRoot,
  getProof,
  verifyEditorProof,
} from "@arbesk/wallet/merkle.js";

const ZERO_ROOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

describe("wallet merkle primitives", () => {
  const tokenId = 42;
  const setVersion = 3;
  const editors = [
    { address: "0x1111111111111111111111111111111111111111", role: 2 },
    { address: "0x2222222222222222222222222222222222222222", role: 2 },
    { address: "0x3333333333333333333333333333333333333333", role: 1 },
    { address: "0x4444444444444444444444444444444444444444", role: 2 },
  ];

  it("makeLeaf returns a bytes32 hex string", () => {
    const leaf = makeLeaf(editors[0].address, editors[0].role, tokenId, setVersion);
    expect(leaf).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("computeRoot returns zero root for empty list", () => {
    expect(computeRoot([], tokenId, setVersion)).toBe(ZERO_ROOT);
  });

  it("computeRoot returns a stable bytes32 root", () => {
    const root = computeRoot(editors, tokenId, setVersion);
    expect(root).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(computeRoot(editors, tokenId, setVersion)).toBe(root);
  });

  it("getProof returns a valid proof for an editor", () => {
    const root = computeRoot(editors, tokenId, setVersion);
    const result = getProof(editors, editors[1].address, tokenId, setVersion);
    expect(result).not.toBeNull();
    expect(result.proof.length).toBeGreaterThan(0);
    const leaf = makeLeaf(editors[1].address, editors[1].role, tokenId, setVersion);
    expect(verifyEditorProof(root, leaf, result.proof)).toBe(true);
  });

  it("getProof returns null for a non-editor address", () => {
    const result = getProof(editors, "0x0000000000000000000000000000000000000000", tokenId, setVersion);
    expect(result).toBeNull();
  });

  it("verifyEditorProof rejects a tampered proof", () => {
    const root = computeRoot(editors, tokenId, setVersion);
    const leaf = makeLeaf(editors[0].address, editors[0].role, tokenId, setVersion);
    const badProof = ["0x0000000000000000000000000000000000000000000000000000000000000001"];
    expect(verifyEditorProof(root, leaf, badProof)).toBe(false);
  });

  it("proofs verify for every editor in the list", () => {
    const root = computeRoot(editors, tokenId, setVersion);
    for (const editor of editors) {
      const result = getProof(editors, editor.address, tokenId, setVersion);
      const leaf = makeLeaf(editor.address, editor.role, tokenId, setVersion);
      expect(verifyEditorProof(root, leaf, result.proof)).toBe(true);
    }
  });
});

/**
 * @jest-environment jsdom
 *
 * Merkle parity: @arbesk/wallet (canonical — matches ArbeskAssetBase._requireEditor)
 * and @arbesk/asset-core (HashPort-backed) MUST stay byte-identical for leaf, root,
 * proof, and verify, or on-chain editor proofs silently break. This is the lockstep
 * guard for the intentional duplication documented in packages/AGENTS.md.
 */
import { jest } from "@jest/globals";

// Keep the frontend adapter import graph out of the test — same pattern as
// asset-core-hash-port.test.js.
jest.unstable_mockModule("../frontend/src/js/blockchain/wallet.js", () => ({
  getActiveContract: jest.fn(() => null),
}));
jest.unstable_mockModule("../frontend/src/js/services/api.js", () => ({
  resolveUserEmail: jest.fn(),
}));

const { initRuntime, _resetRuntimeForTesting } = await import(
  "@arbesk/asset-core/runtime.js"
);
const { createBrowserHashPort } = await import(
  "../frontend/src/js/blockchain/asset-core-adapter.ts"
);
const assetCore = await import("@arbesk/asset-core/domain/editors.js");
const wallet = await import("@arbesk/wallet/merkle.js");

const ipfsStubs = () => ({
  ipfsRead: { getJSON: jest.fn(), getBytes: jest.fn(), getRawBytes: jest.fn() },
  ipfsWrite: { write: jest.fn(), writeJSON: jest.fn() },
});

// tokenId is a uint256 decimal string (production passes strings to avoid
// Number.MAX_SAFE_INTEGER loss). The large tokenId below is a real Base Sepolia
// collection token id.
const FIXTURES = [
  {
    tokenId: "1",
    version: 1,
    editors: [
      { address: "0x407EDfCFd16a5623012BbB778BD47A2bf861ed40", role: 2 },
      { address: "0x1234567890abcdef1234567890abcdef12345678", role: 1 },
    ],
    targetIndex: 1,
  },
  {
    tokenId: "3686032941916943517726017886905728088601606997393009360447657659814039032178",
    version: 3,
    editors: [
      { address: "0x0000000000000000000000000000000000000001", role: 2 },
      { address: "0x0000000000000000000000000000000000000002", role: 1 },
      { address: "0x0000000000000000000000000000000000000003", role: 2 },
    ],
    targetIndex: 2,
  },
];

beforeEach(() => {
  initRuntime({ ...ipfsStubs(), hash: createBrowserHashPort() });
});

afterEach(() => _resetRuntimeForTesting());

describe("merkle parity: wallet vs asset-core", () => {
  test("MAX_EDITORS_PER_TOKEN agrees", () => {
    expect(assetCore.MAX_EDITORS_PER_TOKEN).toBe(wallet.MAX_EDITORS_PER_TOKEN);
  });

  test("makeLeaf is byte-identical", () => {
    for (const f of FIXTURES) {
      for (const e of f.editors) {
        expect(assetCore.makeLeaf(e.address, e.role, f.tokenId, f.version)).toBe(
          wallet.makeLeaf(e.address, e.role, f.tokenId, f.version)
        );
      }
    }
  });

  test("computeRoot is byte-identical (including empty list)", () => {
    for (const f of FIXTURES) {
      expect(assetCore.computeRoot(f.editors, f.tokenId, f.version)).toBe(
        wallet.computeRoot(f.editors, f.tokenId, f.version)
      );
    }
    expect(assetCore.computeRoot([], "1", 1)).toBe(wallet.computeRoot([], "1", 1));
    expect(assetCore.computeRoot([], "1", 1)).toBe(wallet.ZERO_HASH);
  });

  test("getProof is byte-identical", () => {
    for (const f of FIXTURES) {
      const target = f.editors[f.targetIndex].address;
      const a = assetCore.getProof(f.editors, target, f.tokenId, f.version);
      const w = wallet.getProof(f.editors, target, f.tokenId, f.version);
      expect(a).not.toBeNull();
      expect(w).not.toBeNull();
      expect(a.role).toBe(w.role);
      expect(a.proof).toEqual(w.proof);
    }
    expect(assetCore.getProof([], "0x0000000000000000000000000000000000000001", "1", 1)).toBeNull();
    expect(wallet.getProof([], "0x0000000000000000000000000000000000000001", "1", 1)).toBeNull();
  });

  test("verify agrees in both directions", () => {
    for (const f of FIXTURES) {
      const target = f.editors[f.targetIndex].address;
      const role = f.editors[f.targetIndex].role;
      const root = wallet.computeRoot(f.editors, f.tokenId, f.version);
      const leaf = wallet.makeLeaf(target, role, f.tokenId, f.version);
      const { proof } = wallet.getProof(f.editors, target, f.tokenId, f.version);

      expect(assetCore.verifyProof(root, leaf, proof)).toBe(true);
      expect(wallet.verifyEditorProof(root, leaf, proof)).toBe(true);

      const tampered = ["0x" + "00".repeat(32)];
      expect(assetCore.verifyProof(root, leaf, tampered)).toBe(false);
      expect(wallet.verifyEditorProof(root, leaf, tampered)).toBe(false);
    }
  });
});

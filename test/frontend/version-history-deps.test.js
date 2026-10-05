/**
 * assetCidFromTokenUriManifest: tokenURI may resolve to a collection
 * manifest; the version chain needs the asset manifest CID behind it.
 */

import { beforeAll, describe, expect, mock, test } from "bun:test";

let assetCidFromTokenUriManifest;

beforeAll(async () => {
  // version-history-deps wires engine/wallet/IPFS modules at import time —
  // stub them; only the pure resolver is under test.
  await mock.module("../../frontend/src/js/engine/time-travel.js", () => ({
    walkManifestChain: async () => [],
  }));
  await mock.module("../../frontend/src/js/engine/scene-graph.js", () => ({
    clearScene: async () => {},
    loadAssetManifest: async () => ({}),
  }));
  await mock.module("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
    getFromRemoteIPFS: async () => ({}),
  }));
  await mock.module("../../frontend/src/js/blockchain/wallet.js", () => ({
    getActiveContract: () => null,
  }));
  await mock.module(
    "../../frontend/src/js/blockchain/read-contract.js",
    () => ({ getReadableContract: async () => null })
  );
  ({ assetCidFromTokenUriManifest } = await import(
    "../../frontend/src/js/engine/version-history-deps.js"
  ));
});

describe("assetCidFromTokenUriManifest", () => {
  test("collection manifest resolves to the active asset's CID", () => {
    const manifest = { type: "collection", assets: { a1: "cid-a", a2: "cid-b" } };
    expect(assetCidFromTokenUriManifest(manifest, "cid-collection", "a2")).toBe("cid-b");
  });

  test("non-collection manifests pass the tokenURI CID through", () => {
    expect(
      assetCidFromTokenUriManifest({ type: "asset" }, "cid-asset", "a1")
    ).toBe("cid-asset");
    expect(assetCidFromTokenUriManifest(null, "cid-asset", "a1")).toBe("cid-asset");
  });

  test("missing asset id or missing entry yields null", () => {
    const manifest = { type: "collection", assets: { a1: "cid-a" } };
    expect(assetCidFromTokenUriManifest(manifest, "cid-collection", null)).toBeNull();
    expect(assetCidFromTokenUriManifest(manifest, "cid-collection", "zz")).toBeNull();
  });
});

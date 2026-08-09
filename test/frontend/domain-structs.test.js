/**
 * @jest-environment jsdom
 *
 * Domain structs: AssetRef normalization/keys/resolution and manifest→Node
 * mapping. Pure data, no engine, no network (resolver injected).
 */
import { jest, expect, test, describe } from "@jest/globals";
import {
  normalizeAssetRef,
  assetRefKey,
  assetRefsEqual,
  resolveAssetRef,
} from "../../frontend/src/js/domain/asset-ref.js";
import {
  manifestNodeToNode,
  manifestNodes,
} from "../../frontend/src/js/domain/node.js";

describe("normalizeAssetRef", () => {
  test("normalizes the current collection shape", () => {
    expect(
      normalizeAssetRef({
        collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
        assetID: "asset_1",
      })
    ).toEqual({
      collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
      assetID: "asset_1",
    });
  });

  test("normalizes the self-collection shape", () => {
    expect(normalizeAssetRef({ collection: "self", assetID: "a1" })).toEqual({
      collection: "self",
      assetID: "a1",
    });
  });

  test("normalizes the legacy flat token shape", () => {
    expect(
      normalizeAssetRef({ tokenId: "7", chainId: 31337, contractAddress: "0xABC", resolution: "latest" })
    ).toEqual({
      collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
      assetID: null,
    });
  });

  test("returns null for garbage", () => {
    expect(normalizeAssetRef(null)).toBeNull();
    expect(normalizeAssetRef({})).toBeNull();
    expect(normalizeAssetRef("x")).toBeNull();
  });
});

describe("assetRefKey / assetRefsEqual", () => {
  test("key is chainId:contract:tokenId:assetID with lowercased contract", () => {
    const ref = normalizeAssetRef({
      collection: { chainId: 31337, contractAddress: "0xABC", tokenId: "7" },
      assetID: "asset_1",
    });
    expect(assetRefKey(ref)).toBe("31337:0xabc:7:asset_1");
  });

  test("self refs key as self:<assetID>", () => {
    expect(assetRefKey({ collection: "self", assetID: "a1" })).toBe("self:a1");
  });

  test("equal ignores contract case; nulls only equal nulls", () => {
    const a = normalizeAssetRef({ collection: { chainId: 1, contractAddress: "0xABC", tokenId: "1" }, assetID: "x" });
    const b = normalizeAssetRef({ collection: { chainId: 1, contractAddress: "0xabc", tokenId: "1" }, assetID: "x" });
    expect(assetRefsEqual(a, b)).toBe(true);
    expect(assetRefsEqual(null, null)).toBe(true);
    expect(assetRefsEqual(a, null)).toBe(false);
  });
});

describe("resolveAssetRef", () => {
  test("delegates cross-collection refs with null assets map", async () => {
    const resolve = jest.fn().mockResolvedValue({ resolved: true, manifestCid: "bafyX" });
    const ref = normalizeAssetRef({ collection: { chainId: 1, contractAddress: "0xabc", tokenId: "1" }, assetID: "x" });
    const out = await resolveAssetRef(ref, { resolve });
    expect(resolve).toHaveBeenCalledWith(
      { collection: { chainId: 1, contractAddress: "0xabc", tokenId: "1" }, assetID: "x" },
      null
    );
    expect(out.manifestCid).toBe("bafyX");
  });

  test("passes the self assets map for self refs", async () => {
    const resolve = jest.fn().mockResolvedValue({ resolved: true, manifestCid: "bafyY" });
    const selfAssets = { x: "bafyY" };
    await resolveAssetRef({ collection: "self", assetID: "x" }, { resolve, selfAssets });
    expect(resolve).toHaveBeenCalledWith({ collection: "self", assetID: "x" }, selfAssets);
  });
});

describe("manifestNodeToNode / manifestNodes", () => {
  test("maps a geometry node", () => {
    const node = manifestNodeToNode({
      node_id: "n1",
      transform_matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 5,6,7,1],
      source: { cid: "bafyS", path: "composite.gltf", format: "gltf" },
      post_processor: { scale: { x: 2, y: 2, z: 2 } },
    });
    expect(node.nodeId).toBe("n1");
    expect(node.transformMatrix).toHaveLength(16);
    expect(node.transformMatrix[12]).toBe(5);
    expect(node.source.cid).toBe("bafyS");
    expect(node.ref).toBeNull();
    expect(node.postProcessor.scale.x).toBe(2);
  });

  test("maps a child_ref node to a ref", () => {
    const node = manifestNodeToNode({
      node_id: "n2",
      transform_matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
      child_ref: { collection: "self", assetID: "a1" },
    });
    expect(node.source).toBeNull();
    expect(node.ref).toEqual({ collection: "self", assetID: "a1" });
  });

  test("defaults a missing transform_matrix to identity", () => {
    const node = manifestNodeToNode({ node_id: "n3" });
    expect(node.transformMatrix).toEqual([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  });

  test("manifestNodes returns [] for empty/garbage manifests", () => {
    expect(manifestNodes(null)).toEqual([]);
    expect(manifestNodes({ scene: { nodes: [] } })).toEqual([]);
    expect(manifestNodes({ scene: { nodes: [{ node_id: "a" }, { node_id: "b" }] } }).map((n) => n.nodeId)).toEqual(["a", "b"]);
  });
});

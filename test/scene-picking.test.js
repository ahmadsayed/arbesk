/** @jest-environment jsdom */
import { resolvePickedNodeId } from "../frontend/src/js/engine/scene-picking.js";

describe("resolvePickedNodeId", () => {
  test("resolves a regular node's own nodeId with no parent chain", () => {
    const mesh = { metadata: { nodeId: "n1" }, parent: null };
    expect(resolvePickedNodeId(mesh)).toEqual({
      target: null,
      resolvedNodeId: "n1",
      isChildAssetNode: false,
    });
  });

  test("walks up to the nearest ancestor carrying a nodeId", () => {
    const outer = { metadata: { nodeId: "n2" }, parent: null };
    const mesh = { metadata: {}, parent: outer };
    expect(resolvePickedNodeId(mesh)).toEqual({
      target: null,
      resolvedNodeId: "n2",
      isChildAssetNode: false,
    });
  });

  test("keeps the FIRST nodeId seen (closest to the mesh) and ignores deeper ones", () => {
    const root = { metadata: { nodeId: "root" }, parent: null };
    const mid = { metadata: { nodeId: "mid" }, parent: root };
    const mesh = { metadata: { nodeId: "deep" }, parent: mid };
    expect(resolvePickedNodeId(mesh)).toEqual({
      target: null,
      resolvedNodeId: "deep",
      isChildAssetNode: false,
    });
  });

  test("resolves a childRef boundary to the parent manifest's nodeId", () => {
    const mesh = {
      metadata: { childRef: { tokenId: "1" }, nodeId: "child" },
      parent: { metadata: { nodeId: "outer" }, parent: null },
    };
    const result = resolvePickedNodeId(mesh);
    expect(result.target).toBe(mesh);
    expect(result.resolvedNodeId).toBe("outer");
    expect(result.isChildAssetNode).toBe(true);
  });

  test("falls back to the childRef node's own nodeId for freshly-dropped nodes", () => {
    const mesh = {
      metadata: { childRef: { tokenId: "1" }, nodeId: "child" },
      parent: { metadata: {}, parent: null },
    };
    const result = resolvePickedNodeId(mesh);
    expect(result.target).toBe(mesh);
    expect(result.resolvedNodeId).toBe("child");
    expect(result.isChildAssetNode).toBe(true);
  });

  test("yields no resolved node when a childRef boundary has no identity", () => {
    const mesh = { metadata: { childRef: { tokenId: "1" } }, parent: null };
    expect(resolvePickedNodeId(mesh)).toEqual({
      target: mesh,
      resolvedNodeId: null,
      isChildAssetNode: false,
    });
  });

  test("yields no resolved node when nothing in the chain has a nodeId", () => {
    const mesh = { metadata: {}, parent: null };
    expect(resolvePickedNodeId(mesh)).toEqual({
      target: null,
      resolvedNodeId: null,
      isChildAssetNode: false,
    });
  });
});

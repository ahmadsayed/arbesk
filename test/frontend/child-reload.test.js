/**
 * @jest-environment jsdom
 *
 * child-reload matches ASSET_URI_UPDATED payloads against the scene's
 * child_ref anchors by (chainId, contract, tokenId). Publish events carry the
 * token id in hex ("0x2a") while refs store it decimal ("42") — the match
 * must be numeric, not string equality, or the reload silently never fires.
 * Anchors exist for nested refs too (a grandchild child_ref lives only in
 * the referenced child's manifest), so matching must go through the anchor
 * registry, not the root manifest.
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

const reloadChildRefNode = jest.fn();

let bus;
let state;
let initChildReload;

function anchorWith(childRef, extra = {}) {
  return { metadata: { childRef, ...extra } };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();

  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/scene-loader.js",
    () => ({ reloadChildRefNode })
  );

  bus = await import("@arbesk/asset-core/events/bus.js");
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
  ({ initChildReload } = await import(
    "../../frontend/src/js/engine/child-reload.js"
  ));

  state.nodeAnchors.clear();
  state.nodeAnchors.set(
    "child1",
    anchorWith({
      collection: { chainId: 31415822, contractAddress: "0xABC", tokenId: "42" },
      assetID: "bafy-child-1",
    })
  );
  // A grandchild: referenced inside child1's manifest, anchored at depth 2.
  state.nodeAnchors.set(
    "grandchild1",
    anchorWith(
      {
        collection: { chainId: 31415822, contractAddress: "0xABC", tokenId: "77" },
        assetID: "bafy-grandchild-1",
      },
      { depth: 2 }
    )
  );
  // Same-collection "self" ref — resolved in-memory, never token-matched.
  state.nodeAnchors.set(
    "selfRef",
    anchorWith({ collection: "self", assetID: "bafy-self" })
  );
  // Plain mesh node — no childRef at all.
  state.nodeAnchors.set("plain", { metadata: { nodeId: "plain" } });

  reloadChildRefNode.mockReturnValue(Promise.resolve());
});

describe("initChildReload", () => {
  test("reloads a decimal child_ref when the update payload carries hex", () => {
    initChildReload();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xabc",
      tokenId: "0x2a",
      source: "remote",
    });
    expect(reloadChildRefNode).toHaveBeenCalledTimes(1);
    expect(reloadChildRefNode).toHaveBeenCalledWith("child1");
  });

  test("reloads a nested (grandchild) child_ref anchor", () => {
    initChildReload();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xabc",
      tokenId: "0x4d", // 77
      source: "remote",
    });
    expect(reloadChildRefNode).toHaveBeenCalledTimes(1);
    expect(reloadChildRefNode).toHaveBeenCalledWith("grandchild1");
  });

  test("ignores updates for other tokens, contracts, and self refs", () => {
    initChildReload();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xabc",
      tokenId: "0x2b",
      source: "remote",
    });
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xdef",
      tokenId: "42",
      source: "remote",
    });
    expect(reloadChildRefNode).not.toHaveBeenCalled();
  });

  test("matches when the payload carries no contractAddress", () => {
    initChildReload();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      tokenId: "42",
      source: "local",
    });
    expect(reloadChildRefNode).toHaveBeenCalledWith("child1");
  });

  test("skips nodes an already-matching ancestor reloads recursively", () => {
    // A second ref to the SAME token nested under child1: reloading child1
    // re-resolves it, so it must not be reloaded on its own.
    const child1Anchor = state.nodeAnchors.get("child1");
    child1Anchor.metadata.nodeId = "child1";
    const innerAnchor = { metadata: { nodeId: "child1" }, parent: child1Anchor };
    state.nodeAnchors.set("nestedSameToken", {
      parent: innerAnchor,
      metadata: {
        nodeId: "nestedSameToken",
        childRef: {
          collection: { chainId: 31415822, contractAddress: "0xABC", tokenId: "42" },
          assetID: "bafy-nested",
        },
      },
    });

    initChildReload();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xabc",
      tokenId: "42",
      source: "remote",
    });
    expect(reloadChildRefNode).toHaveBeenCalledTimes(1);
    expect(reloadChildRefNode).toHaveBeenCalledWith("child1");
  });

  test("asset-precise matching: only the changed assetID reloads", () => {
    // A second ref into the SAME collection token but a different asset.
    state.nodeAnchors.set("child2", {
      metadata: {
        childRef: {
          collection: { chainId: 31415822, contractAddress: "0xABC", tokenId: "42" },
          assetID: "bafy-child-2",
        },
      },
    });

    initChildReload();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xabc",
      tokenId: "42",
      assetId: "bafy-child-2",
      source: "remote",
    });
    expect(reloadChildRefNode).toHaveBeenCalledTimes(1);
    expect(reloadChildRefNode).toHaveBeenCalledWith("child2");

    // Notices without an assetId fall back to collection-wide reload.
    reloadChildRefNode.mockClear();
    bus.emit(bus.EVENTS.ASSET_URI_UPDATED, {
      chainId: 31415822,
      contractAddress: "0xabc",
      tokenId: "42",
      assetId: null,
      source: "remote",
    });
    const reloaded = reloadChildRefNode.mock.calls.map((c) => c[0]);
    expect(reloaded).toContain("child1");
    expect(reloaded).toContain("child2");
  });
});

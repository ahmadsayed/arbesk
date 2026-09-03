/**
 * @jest-environment jsdom
 *
 * Live-updates token-collection guard: the relay event's #token tag is
 * "<chainId>:<contract>:<tokenId>" (see @arbesk/nostr tokenTag, lower-cased
 * contract), so collectTokens must carry contractAddress and key on tokenTag
 * for the onevent match to ever succeed.
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { tokenTag } from "@arbesk/nostr";

const getCurrentManifest = jest.fn();
const getManifestNodes = jest.fn();

async function loadCollectTokens() {
  jest.resetModules();

  await jest.unstable_mockModule("@arbesk/asset-core/domain/asset.js", () => ({
    getCurrentManifest,
  }));
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/transforms.js",
    () => ({ getManifestNodes })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/services/nostr-browser.js",
    () => ({
      getNostrFacade: jest.fn(),
      getOrCreateBinding: jest.fn(),
      getTokenOwner: jest.fn(),
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/network-config.js",
    () => ({ getContractAddress: jest.fn() })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/token-resolver.js",
    () => ({ invalidateResolution: jest.fn() })
  );

  const mod = await import("../../frontend/src/js/services/live-updates.js");
  return mod.collectTokens;
}

function setNodes(nodes) {
  getCurrentManifest.mockReturnValue({ scene: { nodes } });
  getManifestNodes.mockImplementation((m) => m?.scene?.nodes || []);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("collectTokens", () => {
  test("carries contractAddress and keys on the publisher tokenTag", async () => {
    const collectTokens = await loadCollectTokens();
    setNodes([
      {
        node_id: "child1",
        child_ref: {
          collection: { chainId: 11155111, contractAddress: "0xABC", tokenId: "42" },
          assetID: "bafy-child-1",
        },
      },
    ]);

    const tokens = collectTokens();

    expect(tokens).toEqual([
      { chainId: 11155111, contractAddress: "0xABC", tokenId: "42" },
    ]);
    expect(
      tokenTag(tokens[0].chainId, tokens[0].contractAddress, tokens[0].tokenId)
    ).toBe("11155111:0xabc:42");
    // Matches the publisher's #token tag format exactly.
    expect(tokenTag(11155111, "0xABC", "42")).toBe("11155111:0xabc:42");
  });

  test("dedups on tokenTag and reads legacy flat contractAddress", async () => {
    const collectTokens = await loadCollectTokens();
    setNodes([
      {
        node_id: "child1",
        child_ref: {
          collection: { chainId: 31337, contractAddress: "0x1", tokenId: "7" },
          assetID: "bafy-child-1",
        },
      },
      // Same token referenced twice under different assetIDs — deduped.
      {
        node_id: "child2",
        child_ref: {
          collection: { chainId: 31337, contractAddress: "0x1", tokenId: "7" },
          assetID: "bafy-child-2",
        },
      },
      // Legacy flat child_ref (no collection envelope).
      {
        node_id: "legacy",
        child_ref: { chainId: 31337, contractAddress: "0x2", tokenId: "9" },
      },
    ]);

    const tokens = collectTokens();

    expect(tokens).toEqual([
      { chainId: 31337, contractAddress: "0x1", tokenId: "7" },
      { chainId: 31337, contractAddress: "0x2", tokenId: "9" },
    ]);
  });
});

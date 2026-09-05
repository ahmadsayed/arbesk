import { describe, it, expect } from "@jest/globals";
import { verifyEvent, getPublicKey } from "nostr-tools";
import { buildAssetUpdateEvent, KIND_ASSET_UPDATE, TAG_TOKEN } from "../src/api/nostr-relay.ts";

const TEST_PRIVKEY = "a0".repeat(32);
const TEST_PUBKEY = getPublicKey(new Uint8Array(32).fill(0xa0));

describe("buildAssetUpdateEvent", () => {
  it("builds a signed, verifiable KIND_ASSET_UPDATE event", () => {
    const event = buildAssetUpdateEvent(TEST_PRIVKEY, {
      chainId: 31415822,
      contractAddress: "0xABC",
      tokenId: "42",
      newAssetURI: "bafy-new",
    });
    expect(event.kind).toBe(KIND_ASSET_UPDATE);
    expect(event.pubkey).toBe(TEST_PUBKEY);
    expect(event.tags).toContainEqual([TAG_TOKEN, "31415822:0xabc:42"]);
    expect(JSON.parse(event.content)).toEqual({
      chainId: 31415822,
      contractAddress: "0xABC",
      tokenId: "42",
      newAssetURI: "bafy-new",
      assetId: null,
    });
    expect(verifyEvent(event)).toBe(true);
  });

  it("carries the changed assetId in the event content", () => {
    const event = buildAssetUpdateEvent(TEST_PRIVKEY, {
      chainId: 31415822,
      contractAddress: "0xABC",
      tokenId: "42",
      newAssetURI: "bafy-new",
      assetId: "asset_7",
    });
    expect(JSON.parse(event.content).assetId).toBe("asset_7");
  });

  it("canonicalizes a hex token id in the #token tag", () => {
    const event = buildAssetUpdateEvent(TEST_PRIVKEY, {
      chainId: 31415822,
      contractAddress: "0xABC",
      tokenId: "0x2a",
      newAssetURI: "bafy-new",
    });
    expect(event.tags).toContainEqual([TAG_TOKEN, "31415822:0xabc:42"]);
  });
});
import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildBinding } from "@arbesk/nostr/identity.js";
import { signAssetUpdate, tokenTag } from "@arbesk/nostr/events.js";
import { KIND_ASSET_UPDATE, TAG_TOKEN } from "@arbesk/nostr/kinds.js";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("events", () => {
  it("signs an update event with the derived key", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const payload = { chainId: 31415822, tokenId: "42", newAssetURI: "bafyexample" };
    const event = signAssetUpdate(binding, payload, CONTRACT);
    expect(event.kind).toBe(KIND_ASSET_UPDATE);
    expect(event.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(event.tags).toContainEqual([TAG_TOKEN, tokenTag(payload.chainId, CONTRACT, payload.tokenId)]);
    expect(JSON.parse(event.content)).toMatchObject({ chainId: payload.chainId, tokenId: "42", newAssetURI: "bafyexample" });
  });

  it("builds a lowercase token tag", () => {
    expect(tokenTag(84532, CONTRACT, "7")).toBe(`84532:${CONTRACT.toLowerCase()}:7`);
  });
});

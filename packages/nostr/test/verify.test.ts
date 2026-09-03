import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { NostrEvent } from "nostr-tools";
import { buildBinding } from "@arbesk/nostr/identity.js";
import { signAssetUpdate } from "@arbesk/nostr/events.js";
import { publishAssetUpdate } from "@arbesk/nostr/publish.js";
import { verifyAssetUpdate } from "@arbesk/nostr/verify.js";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("publish + verify", () => {
  it("publishes the signed event through the relay", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    let captured: NostrEvent | null = null;
    const relay = { publish: async (e: NostrEvent) => { captured = e; } };
    const payload = { chainId: 31415822, tokenId: "9", newAssetURI: "bafy" };
    const out = await publishAssetUpdate(binding, payload, CONTRACT, relay);
    expect(captured).toBe(out);
    expect(captured!.kind).toBe(20001);
  });

  it("accepts a valid update from the token author", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const payload = { chainId: 31415822, tokenId: "9", newAssetURI: "bafy" };
    const event = signAssetUpdate(binding, payload, CONTRACT);
    const chain = { isTokenAuthor: async () => true };
    await expect(verifyAssetUpdate(event, binding, payload, chain)).resolves.toBe(true);
  });

  it("rejects when the signer is not the token author", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    const payload = { chainId: 31415822, tokenId: "9", newAssetURI: "bafy" };
    const event = signAssetUpdate(binding, payload, CONTRACT);
    const chain = { isTokenAuthor: async () => false };
    await expect(verifyAssetUpdate(event, binding, payload, chain)).resolves.toBe(false);
  });
});

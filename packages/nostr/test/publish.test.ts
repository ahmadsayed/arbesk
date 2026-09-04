import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { NostrEvent } from "nostr-tools";
import { buildBinding } from "@arbesk/nostr/identity.js";
import { publishAssetUpdate } from "@arbesk/nostr/publish.js";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("publish", () => {
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
});

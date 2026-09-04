import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createNostrFacade } from "@arbesk/nostr";

describe("facade", () => {
  it("creates a signer, signs, and publishes an update", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    let published = false;
    const facade = createNostrFacade({
      signer: { signMessage: (m) => account.signMessage({ message: m }) },
      relay: { publish: async () => { published = true; } },
    });
    const binding = await facade.createIdentity();
    expect(binding.signature).toMatch(/^0x/);
    const event = facade.signAssetUpdate(binding, { chainId: 1, tokenId: "1", newAssetURI: "a" }, "0x" + "11".repeat(20));
    expect(event.kind).toBe(20001);
    await facade.publishAssetUpdate(binding, { chainId: 1, tokenId: "1", newAssetURI: "a" }, "0x" + "11".repeat(20));
    expect(published).toBe(true);
  });
});

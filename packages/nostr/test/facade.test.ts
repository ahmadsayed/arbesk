import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createNostrFacade } from "@arbesk/nostr";

describe("facade", () => {
  it("round-trips identity and verification", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const facade = createNostrFacade({
      signer: { signMessage: (m) => account.signMessage({ message: m }) },
      relay: { publish: async () => {} },
      chain: { isTokenAuthor: async () => true },
    });
    const binding = await facade.createIdentity();
    await expect(facade.verifyBinding(binding)).resolves.toBe(true);
    const event = facade.signAssetUpdate(binding, { chainId: 1, tokenId: "1", newAssetURI: "a" }, "0x" + "11".repeat(20));
    await expect(facade.verifyAssetUpdate(event, binding, { chainId: 1, tokenId: "1", newAssetURI: "a" })).resolves.toBe(true);
  });
});

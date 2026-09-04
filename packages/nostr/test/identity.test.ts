import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import { buildBinding, deriveSecretKey } from "@arbesk/nostr/identity.js";
import { IDENTITY_MESSAGE } from "@arbesk/nostr/kinds.js";

describe("identity build", () => {
  it("derives the secret key as keccak256 of the signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const sig = await account.signMessage({ message: IDENTITY_MESSAGE });
    expect(deriveSecretKey(sig)).toBe(keccak256(sig).slice(2));
  });

  it("builds signing key material from a wallet signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = { signMessage: (m: string) => account.signMessage({ message: m }) };
    const binding = await buildBinding(signer);
    expect(binding.signature).toMatch(/^0x/);
  });
});

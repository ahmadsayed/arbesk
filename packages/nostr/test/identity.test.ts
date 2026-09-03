import { describe, it, expect } from "@jest/globals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getPublicKey } from "nostr-tools";
import { hexToBytes, keccak256 } from "viem";
import { buildBinding, deriveSecretKey, derivePubkey, verifyBinding } from "@arbesk/nostr/identity.js";
import { IDENTITY_MESSAGE } from "@arbesk/nostr/kinds.js";

describe("identity build", () => {
  it("derives the secret key as keccak256 of the signature", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const sig = await account.signMessage({ message: IDENTITY_MESSAGE });
    expect(deriveSecretKey(sig)).toBe(keccak256(sig).slice(2));
    expect(derivePubkey(sig)).toBe(getPublicKey(hexToBytes(`0x${deriveSecretKey(sig)}` as `0x${string}`)));
  });

  it("builds a binding whose address matches the signer", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = { signMessage: (m: string) => account.signMessage({ message: m }) };
    const binding = await buildBinding(signer);
    expect(binding.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(binding.pubkey).toBe(getPublicKey(hexToBytes(`0x${deriveSecretKey(binding.signature)}` as `0x${string}`)));
    expect(binding.signature).toMatch(/^0x/);
  });
});

describe("identity verify", () => {
  it("accepts a valid binding", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    await expect(verifyBinding(binding)).resolves.toBe(true);
  });

  it("rejects a binding with a mismatched address", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    await expect(verifyBinding({ ...binding, address: other.address })).resolves.toBe(false);
  });

  it("rejects a binding with a forged pubkey", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const binding = await buildBinding({ signMessage: (m) => account.signMessage({ message: m }) });
    await expect(verifyBinding({ ...binding, pubkey: "00".repeat(32) })).resolves.toBe(false);
  });
});

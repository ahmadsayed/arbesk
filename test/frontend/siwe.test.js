/** @jest-environment jsdom */

import { SiweMessage } from "siwe";
import {
  buildSiweMessage,
  generateNonce,
} from "../../frontend/src/js/blockchain/siwe.ts";

describe("frontend SIWE builder", () => {
  it("emits a message the official siwe parser round-trips, with an EIP-55 address", () => {
    const message = buildSiweMessage(
      window.location.origin,
      "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae", // lowercase on purpose
      "testNonce123",
      31337,
    );

    // Throws on a malformed message or a non-checksummed address.
    const parsed = new SiweMessage(message);
    expect(parsed.address).toBe("0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe");
    expect(parsed.chainId).toBe(31337);
    expect(parsed.nonce).toBe("testNonce123");
    expect(parsed.statement).toBe("Sign in to Arbesk Studio");
    expect(parsed.version).toBe("1");
    expect(parsed.issuedAt).toBeTruthy();
  });

  it("honors a custom statement", () => {
    const message = buildSiweMessage(
      window.location.origin,
      "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe",
      "testNonce456",
      31337,
      "Custom statement",
    );
    expect(new SiweMessage(message).statement).toBe("Custom statement");
  });

  it("generates unique nonces of at least 8 characters", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});

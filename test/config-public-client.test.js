/**
 * src/config.ts chain clients: one cached viem PublicClient per chain id,
 * built on the configured RPC URL. (Replaces the old web3 keep-alive test —
 * viem's http transport uses undici fetch, which keeps connections alive by
 * default; the behavior this suite now pins is per-chain caching.)
 */
const { getPublicClient } = await import("../src/config.ts");

describe("getPublicClient", () => {
  test("returns a cached instance per chain id", () => {
    const a = getPublicClient(31337);
    expect(getPublicClient(31337)).toBe(a);
  });

  test("different chain ids get different clients", () => {
    expect(getPublicClient(31337)).not.toBe(getPublicClient(84532));
  });

  test("omitting chainId uses the default chain", () => {
    expect(getPublicClient()).toBe(
      getPublicClient(Number(process.env.DEFAULT_CHAIN_ID || 84532)),
    );
  });
});

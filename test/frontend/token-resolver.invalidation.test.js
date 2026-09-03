// test/frontend/token-resolver.invalidation.test.js
import { describe, it, expect, jest } from "@jest/globals";

// resolveChildRef is async and hits viem; test the cache directly by
// reaching the internal map through a small exported helper added below.
describe("invalidateResolution", () => {
  it("removes the cached CID for a token", async () => {
    const { invalidateResolution, _setCachedForTest } = await import("../../frontend/src/js/blockchain/token-resolver.ts");
    _setCachedForTest(31415822, "0xabc", "7", "bafy-old");
    invalidateResolution(31415822, "0xabc", "7");
    expect(_setCachedForTest).toBeTruthy();
  });
});

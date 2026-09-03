// test/frontend/token-resolver.invalidation.test.js
import { describe, it, expect } from "@jest/globals";
import {
  invalidateResolution,
  _setCachedForTest,
  _getCachedForTest,
} from "../../frontend/src/js/blockchain/token-resolver.ts";

describe("invalidateResolution", () => {
  it("removes the cached CID for a token", () => {
    const chainId = 31415822;
    const contractAddress = "0xabc";
    const tokenId = "7";

    _setCachedForTest(chainId, contractAddress, tokenId, "bafy-old");
    expect(_getCachedForTest(chainId, contractAddress, tokenId)).toBe("bafy-old");

    invalidateResolution(chainId, contractAddress, tokenId);

    expect(_getCachedForTest(chainId, contractAddress, tokenId)).toBeNull();
  });
});

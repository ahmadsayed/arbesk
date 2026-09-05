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

  it("invalidates across token id formats (cache stored decimal, event hex)", () => {
    const chainId = 31415822;
    const contractAddress = "0xabc";

    _setCachedForTest(chainId, contractAddress, "42", "bafy-old");
    invalidateResolution(chainId, contractAddress, "0x2a");

    expect(_getCachedForTest(chainId, contractAddress, "42")).toBeNull();
    expect(_getCachedForTest(chainId, contractAddress, "0x2a")).toBeNull();
  });
});

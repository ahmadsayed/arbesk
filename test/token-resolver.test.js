/**
 * Token Resolver Unit Tests
 *
 * normalizeTokenURI is a pure helper, so test the real module
 * (frontend/src/js/blockchain/uri-utils.ts) rather than an inline copy.
 */

import { describe, expect, it } from "bun:test";
import { normalizeTokenURI } from "../frontend/src/js/blockchain/uri-utils.ts";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("Token Resolver - normalizeTokenURI", () => {
  it("returns an empty string for empty or non-string input", () => {
    expect(normalizeTokenURI("")).toBe("");
    expect(normalizeTokenURI(null)).toBe("");
    expect(normalizeTokenURI(undefined)).toBe("");
  });

  it("normalizes IPFS prefixes, gateways, paths and query strings to a bare CID", () => {
    const cases = [
      CID,
      `ipfs://${CID}`,
      `ipfs://${CID}/manifest.json`,
      `ipfs://${CID}/`,
      `http://127.0.0.1:8080/ipfs/${CID}`,
      `https://ipfs.io/ipfs/${CID}`,
      `  ${CID}  `,
      `${CID}?filename=test.glb`,
    ];
    for (const input of cases) {
      expect(normalizeTokenURI(input)).toBe(CID);
    }
  });

  it("passes through values that are not IPFS CIDs", () => {
    const dataUri = "data:application/json;base64,eyJrZXkiOiJ2YWx1ZSJ9";
    expect(normalizeTokenURI(dataUri)).toBe(dataUri);
    expect(normalizeTokenURI("short")).toBe("short");
  });
});

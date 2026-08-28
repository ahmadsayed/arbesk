/**
 * besk collection creation tests (P4b) — token-ID derivation byte-identity.
 */
import { encodePacked, keccak256 } from "viem/utils";
import { deriveNamedCollectionTokenId } from "../packages/besk/src/collections.ts";

describe("besk collection token IDs", () => {
  const address = "0x407EDfCFd16a5623012BbB778BD47A2bf861ed40";

  test("derives the same decimal token id as the Studio (keccak256(address,string))", () => {
    const expectedHex = keccak256(
      encodePacked(["address", "string"], [address.toLowerCase(), "test"]),
    );
    const expected = BigInt(expectedHex).toString();

    const got = deriveNamedCollectionTokenId(address, "test");

    expect(got).toBe(expected);
    // token IDs are uint256 decimal strings, not hex.
    expect(got).toMatch(/^\d+$/);
  });

  test("is deterministic for the same wallet+name, case-insensitive address", () => {
    const lower = deriveNamedCollectionTokenId(address.toLowerCase(), "Studio Room");
    const mixed = deriveNamedCollectionTokenId(address, "Studio Room");
    expect(lower).toBe(mixed);
  });

  test("differs across names (no collision for distinct names)", () => {
    const a = deriveNamedCollectionTokenId(address, "living room");
    const b = deriveNamedCollectionTokenId(address, "bedroom");
    expect(a).not.toBe(b);
  });
});
/**
 * Named-collection token-ID parity: the CLI derives IDs through the canonical
 * asset-core helper (HashPort-backed). This pins that derivation against raw
 * viem (the contract's expectation) so the two can never drift apart.
 */
import { jest } from "@jest/globals";
import { encodePacked, keccak256 } from "viem/utils";
import { createHashPort } from "../packages/besk/src/adapters.ts";

const { initRuntime, _resetRuntimeForTesting } = await import(
  "@arbesk/asset-core/runtime.js"
);
const { deriveNamedCollectionId } = await import(
  "@arbesk/asset-core/utils/collections.js"
);

const ipfsStubs = () => ({
  ipfsRead: { getJSON: jest.fn(), getBytes: jest.fn(), getRawBytes: jest.fn() },
  ipfsWrite: { write: jest.fn(), writeJSON: jest.fn() },
});

beforeEach(() => {
  initRuntime({ ...ipfsStubs(), hash: createHashPort() });
});

afterEach(() => _resetRuntimeForTesting());

describe("named-collection token IDs (canonical path)", () => {
  const address = "0x407EDfCFd16a5623012BbB778BD47A2bf861ed40";

  test("matches the contract's keccak256(abi.encodePacked(address, string))", () => {
    const expectedHex = keccak256(
      encodePacked(["address", "string"], [address.toLowerCase(), "test"])
    );
    const hex = deriveNamedCollectionId(address, "test");
    expect(hex).toBe(expectedHex);
    // token IDs are handled as uint256 decimal strings, not hex.
    expect(BigInt(hex).toString()).toMatch(/^\d+$/);
  });

  test("is case-insensitive on the address (checksum-exempt, like Web3.soliditySha3)", () => {
    const lower = deriveNamedCollectionId(address.toLowerCase(), "Studio Room");
    const mixed = deriveNamedCollectionId(address, "Studio Room");
    expect(lower).toBe(mixed);
  });

  test("differs across names (no collision for distinct names)", () => {
    const a = deriveNamedCollectionId(address, "living room");
    const b = deriveNamedCollectionId(address, "bedroom");
    expect(a).not.toBe(b);
  });
});

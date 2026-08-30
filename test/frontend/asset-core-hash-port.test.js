/**
 * @jest-environment jsdom
 *
 * Hash-port equivalence: the viem-backed browser HashPort must produce
 * byte-identical output to Web3's soliditySha3 for the editor Merkle leaf
 * argument shape ({type, value} pairs), or on-chain proof verification
 * breaks.
 */
import { jest } from "@jest/globals";

jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet.js", () => ({
  getActiveContract: jest.fn(() => null),
}));
jest.unstable_mockModule("../../frontend/src/js/services/backend-client.js", () => ({
  resolveUserEmail: jest.fn(),
}));

const { soliditySha3: web3SoliditySha3 } = await import("web3-utils");
const { createBrowserHashPort } = await import(
  "../../frontend/src/js/blockchain/asset-core-adapter.ts"
);

const hash = createBrowserHashPort();

describe("createBrowserHashPort", () => {
  test("soliditySha3 matches Web3 for the makeLeaf argument shape", () => {
    const args = [
      { type: "address", value: "0x1234567890abcdef1234567890abcdef12345678" },
      { type: "uint8", value: 2 },
      { type: "uint256", value: 1 },
      { type: "uint256", value: 1 },
    ];
    const expected = web3SoliditySha3(...args);
    const actual = hash.soliditySha3(...args);
    expect(expected).toMatch(/^0x[0-9a-f]{64}$/);
    expect(actual).toBe(expected);
  });

  test("soliditySha3 matches Web3 across varied leaf inputs", () => {
    const cases = [
      ["0x0000000000000000000000000000000000000000", 0, 0, 0],
      ["0xdeadbeef00000000000000000000000000000001", 1, 42, 7],
      ["0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF", 255, 999999, 12345],
    ];
    for (const [address, role, tokenId, setVersion] of cases) {
      const args = [
        { type: "address", value: address },
        { type: "uint8", value: role },
        { type: "uint256", value: tokenId },
        { type: "uint256", value: setVersion },
      ];
      expect(hash.soliditySha3(...args)).toBe(web3SoliditySha3(...args));
    }
  });
});

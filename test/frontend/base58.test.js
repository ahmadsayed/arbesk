/**
 * @jest-environment jsdom
 */
import { describe, expect, test } from "@jest/globals";
import {
  addressToBase58,
  base58ToAddress,
} from "../../frontend/src/js/utils/base58.js";

const KNOWN_ADDRESS = "0xccC626354A2Ea985d4aBDC1173597a46aFC63595";
const KNOWN_BASE58 = "3rTyYaQADATmQkvr5vkTteihpSHz";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("addressToBase58", () => {
  test("encodes the known vector", () => {
    expect(addressToBase58(KNOWN_ADDRESS)).toBe(KNOWN_BASE58);
  });

  test("accepts any hex case and produces the same output", () => {
    expect(addressToBase58(KNOWN_ADDRESS.toLowerCase())).toBe(KNOWN_BASE58);
    expect(addressToBase58(KNOWN_ADDRESS.toUpperCase().replace("0X", "0x"))).toBe(
      KNOWN_BASE58,
    );
  });

  test("encodes the zero address as all 1s", () => {
    expect(addressToBase58(ZERO_ADDRESS)).toBe("1".repeat(20));
  });

  test("throws on invalid input", () => {
    for (const bad of [
      "",
      "0x",
      "0x123",
      "ccC626354A2Ea985d4aBDC1173597a46aFC6359", // 38 hex chars
      "0xccC626354A2Ea985d4aBDC1173597a46aFC6359500", // 42 hex chars
      "0xzzC626354A2Ea985d4aBDC1173597a46aFC63595", // non-hex
      "not-an-address",
    ]) {
      expect(() => addressToBase58(bad)).toThrow();
    }
  });
});

describe("base58ToAddress", () => {
  test("decodes the known vector to a lowercase address", () => {
    expect(base58ToAddress(KNOWN_BASE58)).toBe(KNOWN_ADDRESS.toLowerCase());
  });

  test("decodes the zero address", () => {
    expect(base58ToAddress("1".repeat(20))).toBe(ZERO_ADDRESS);
  });

  test("round-trips arbitrary addresses", () => {
    const addresses = [
      KNOWN_ADDRESS,
      ZERO_ADDRESS,
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "0x0000000000000000000000000000000000000001",
      "0x00dead000000000000000000000000000000beef",
      "0xffffffffffffffffffffffffffffffffffffffff",
    ];
    for (const address of addresses) {
      expect(base58ToAddress(addressToBase58(address))).toBe(
        address.toLowerCase(),
      );
    }
  });

  test("returns null for invalid characters", () => {
    // 0, O, I, l are outside the Bitcoin alphabet.
    for (const bad of ["0", "O", "I", "l", `${KNOWN_BASE58}0`, "!!!"]) {
      expect(base58ToAddress(bad)).toBeNull();
    }
  });

  test("returns null for empty input", () => {
    expect(base58ToAddress("")).toBeNull();
  });

  test("returns null when the payload is not 20 bytes", () => {
    expect(base58ToAddress("1")).toBeNull(); // 1 zero byte
    expect(base58ToAddress("2")).toBeNull(); // 1 non-zero byte
    expect(base58ToAddress("1".repeat(19))).toBeNull(); // 19 bytes
    expect(base58ToAddress("1".repeat(21))).toBeNull(); // 21 bytes
    // 21-byte non-zero payload: 20-byte max (0xff…ff) encoded, times 58.
    expect(base58ToAddress("JEKNVnkbo3jma2nCDAUDZh7YeRyJq")).toBeNull();
  });
});

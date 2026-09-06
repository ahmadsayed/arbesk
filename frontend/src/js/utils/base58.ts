/**
 * Base58 (Bitcoin alphabet) encoding for EVM addresses.
 * @remarks Hand-rolled (no dependency): an address is a fixed 20-byte payload,
 *   so a BigInt round-trip with leading-zero-byte handling is sufficient.
 *   Powers public profile URLs (`/library/<base58>`).
 */

const ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = 58n;
const ADDRESS_BYTES = 20;

/**
 * Encode an EVM address as base58.
 * @param address - `0x`-prefixed 40-hex-character address (any case)
 * @returns base58 string preserving leading zero bytes as `1`s
 * @throws when the input is not a 20-byte hex address
 */
export function addressToBase58(address: string): string {
  const hex =
    address.startsWith("0x") || address.startsWith("0X")
      ? address.slice(2)
      : address;
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) {
    throw new Error(`Invalid EVM address: ${address}`);
  }

  let leadingZeros = 0;
  while (
    leadingZeros < ADDRESS_BYTES &&
    hex.slice(leadingZeros * 2, leadingZeros * 2 + 2) === "00"
  ) {
    leadingZeros++;
  }

  let num = BigInt(`0x${hex}`);
  let encoded = "";
  while (num > 0n) {
    encoded = ALPHABET[Number(num % BASE)] + encoded;
    num = num / BASE;
  }
  return "1".repeat(leadingZeros) + encoded;
}

/**
 * Decode a base58 profile id back into an EVM address.
 * @param id - base58 string from a profile URL
 * @returns lowercase `0x`-prefixed address when the payload is exactly 20
 *   bytes, otherwise null (bad character, wrong length, empty input)
 */
export function base58ToAddress(id: string): string | null {
  if (!id) return null;

  let num = 0n;
  for (const ch of id) {
    const digit = ALPHABET.indexOf(ch);
    if (digit === -1) return null;
    num = num * BASE + BigInt(digit);
  }

  let leadingZeros = 0;
  while (leadingZeros < id.length && id[leadingZeros] === "1") {
    leadingZeros++;
  }

  let hex = num === 0n ? "" : num.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  if (hex.length / 2 + leadingZeros !== ADDRESS_BYTES) return null;

  return `0x${"00".repeat(leadingZeros)}${hex}`;
}

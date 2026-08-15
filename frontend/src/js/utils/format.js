/**
 * Shorten an address for display: `0x1234…abcd`. Passes "system" through.
 * @param {string|null|undefined} addr
 * @returns {string}
 */
export function truncateAddress(addr) {
  if (!addr || addr === "system") return addr || "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Shorten a CID for display.
 * @param {string|null|undefined} cid
 * @returns {string}
 */
export function truncateCid(cid) {
  if (!cid) return "-";
  return `${cid.slice(0, 8)}…${cid.slice(-6)}`;
}

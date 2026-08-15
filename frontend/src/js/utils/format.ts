/**
 * Shorten an address for display: `0x1234…abcd`. Passes "system" through.
 */
export function truncateAddress(addr: string | null | undefined): string {
  if (!addr || addr === "system") return addr || "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Shorten a CID for display.
 */
export function truncateCid(cid: string | null | undefined): string {
  if (!cid) return "-";
  return `${cid.slice(0, 8)}…${cid.slice(-6)}`;
}

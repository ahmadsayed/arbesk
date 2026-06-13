export function truncateAddress(addr) {
  if (!addr || addr === "system") return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function truncateCid(cid) {
  if (!cid) return "—";
  return `${cid.slice(0, 8)}…${cid.slice(-6)}`;
}

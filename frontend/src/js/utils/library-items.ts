/**
 * Filter library items by a case-insensitive substring of the name.
 */
export function filterItems<T extends { name: string }>(items: T[], searchQuery: string): T[] {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

/**
 * Compute the inclusive id range between an anchor and a target item.
 */
export function computeRangeSelection(items: Array<{ id: any }>, anchorId: any, targetId: any): any[] {
  const ids = items.map((i) => i.id);
  const anchorIndex = ids.indexOf(anchorId);
  const targetIndex = ids.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) return [targetId];
  const [start, end] =
    anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
  return ids.slice(start, end + 1);
}

/**
 * Format a byte count for display.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Trim a token ID for display: `#1234…abcd`.
 */
export function trimTokenId(tokenId: any): string {
  const s = String(tokenId);
  if (s.length <= 8) return `#${s}`;
  return `#${s.slice(0, 4)}…${s.slice(-4)}`;
}

// @ts-nocheck
export function filterItems(items, searchQuery) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

export function computeRangeSelection(items, anchorId, targetId) {
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

export function formatBytes(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function trimTokenId(tokenId) {
  const s = String(tokenId);
  if (s.length <= 8) return `#${s}`;
  return `#${s.slice(0, 4)}…${s.slice(-4)}`;
}

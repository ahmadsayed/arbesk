const SUPPORTED_EXTENSIONS = [".glb", ".gltf"];

export function isSupportedFile(filename) {
  const lower = String(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getChildItems(state, folderId) {
  const folders = state.folders
    .filter((f) => f.parentId === folderId)
    .map((f) => ({
      id: f.id,
      type: "folder",
      name: f.name,
      status: f.status,
      dateModified: null,
      sizeBytes: null,
    }));
  const files = state.files
    .filter((f) => f.parentId === folderId)
    .map((f) => ({
      id: f.id,
      type: "file",
      name: f.name,
      status: f.status,
      dateModified: f.dateModified,
      sizeBytes: f.sizeBytes,
    }));
  return [...folders, ...files];
}

export function filterItems(items, searchQuery) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}

export function sortItems(items, sortBy) {
  const sorted = [...items];
  if (sortBy === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "date") {
    sorted.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
  } else if (sortBy === "status") {
    const rank = { uploading: 0, wip: 1, besked: 2 };
    sorted.sort((a, b) => (rank[a.status] ?? -1) - (rank[b.status] ?? -1));
  }
  const folders = sorted.filter((i) => i.type === "folder");
  const files = sorted.filter((i) => i.type === "file");
  return [...folders, ...files];
}

export function buildBreadcrumb(folders, currentFolderId) {
  const path = [];
  let id = currentFolderId;
  while (id !== null) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    path.unshift({ id: folder.id, name: folder.name });
    id = folder.parentId;
  }
  return [{ id: null, name: "Home" }, ...path];
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
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

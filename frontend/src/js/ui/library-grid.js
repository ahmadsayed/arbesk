import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { getChildItems, filterItems, sortItems, isSupportedFile, formatBytes } from "../utils/library-items.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toasts.js";
import { computeRangeSelection } from "../utils/library-items.js";
import { showConfirmDialog } from "./dialog.js";

export function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function renderGridStatus(item) {
  if (item.type !== "file") return "";
  if (item.status === "uploading") {
    return `<span class="status-badge status-uploading">Uploading…</span>`;
  }
  if (item.status === "besked") {
    return `<span class="status-check" title="Besked"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`;
  }
  return `<span class="status-flag" title="Work in Progress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4M4 4h14l-2.5 4L18 12H4"/></svg></span>`;
}

function renderListStatus(item) {
  if (item.type !== "file") return "—";
  if (item.status === "uploading") return `<span class="status-badge status-uploading">Uploading…</span>`;
  if (item.status === "besked") return `<span class="status-badge status-besked">Besked</span>`;
  return `<span class="status-badge status-wip">Work in Progress</span>`;
}

export function createItemElement(item, viewMode) {
  const icon = item.type === "folder" ? "📁" : "🗎";

  if (viewMode === "list") {
    const el = document.createElement("tr");
    el.className = "library-row";
    el.dataset.id = item.id;
    el.dataset.type = item.type;
    el.tabIndex = 0;
    el.setAttribute("role", "row");
    el.setAttribute("aria-selected", "false");
    el.innerHTML = `
      <td class="library-row-name"><span>${icon}</span><span class="library-item-name">${escapeHtml(item.name)}</span></td>
      <td>${renderListStatus(item)}</td>
      <td>${item.dateModified ? new Date(item.dateModified).toLocaleDateString() : "—"}</td>
      <td>${item.sizeBytes ? formatBytes(item.sizeBytes) : "—"}</td>
    `;
    return el;
  }

  const el = document.createElement("div");
  el.className = "library-item";
  el.dataset.id = item.id;
  el.dataset.type = item.type;
  el.tabIndex = 0;
  el.setAttribute("role", "gridcell");
  el.setAttribute("aria-selected", "false");
  el.innerHTML = `
    <div class="library-item-thumbnail">${icon}${renderGridStatus(item)}</div>
    <span class="library-item-name">${escapeHtml(item.name)}</span>
  `;
  return el;
}

function buildEmptyState(searchQuery) {
  const el = document.createElement("div");
  el.className = "empty-state";
  if (searchQuery) {
    el.innerHTML = `
      <p class="empty-state-title">No files match your search</p>
      <p class="empty-state-sub">Try a different name.</p>
    `;
  } else {
    el.innerHTML = `
      <p class="empty-state-title">Drag files here to get started</p>
      <p class="empty-state-sub">.glb and .gltf files are supported.</p>
    `;
  }
  return el;
}

export function renderItems(container, items, viewMode) {
  container.innerHTML = "";

  if (items.length === 0) {
    container.appendChild(buildEmptyState(libraryState.get().searchQuery));
    return;
  }

  if (viewMode === "list") {
    const table = document.createElement("table");
    table.className = "library-list-table";
    table.innerHTML = `<thead><tr><th>Name</th><th>Status</th><th>Date modified</th><th>Size</th></tr></thead>`;
    const tbody = document.createElement("tbody");
    items.forEach((item) => tbody.appendChild(createItemElement(item, viewMode)));
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    items.forEach((item) => container.appendChild(createItemElement(item, viewMode)));
  }
}

function currentItems() {
  const state = libraryState.get();
  const items = getChildItems(state, state.currentFolderId);
  return sortItems(filterItems(items, state.searchQuery), state.sortBy);
}

function applySelection(container, selectedIds) {
  container.querySelectorAll("[data-id]").forEach((el) => {
    const selected = selectedIds.includes(el.dataset.id);
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-selected", String(selected));
  });
}

function render() {
  const container = document.getElementById("libraryItems");
  if (!container) return;
  const state = libraryState.get();
  const items = currentItems();
  renderItems(container, items, state.viewMode);
  applySelection(container, state.selectedIds);

  const countEl = document.getElementById("libraryItemCount");
  if (countEl) countEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
}

let lastClickedId = null;

export function openInStudio(fileId) {
  window.location.href = `/studio.html?libraryFile=${fileId}`;
}

export function requestDelete(ids) {
  return showConfirmDialog(
    ids.length === 1 ? "Delete item?" : `Delete ${ids.length} items?`,
    "This cannot be undone.",
    [
      { text: "Cancel", value: "cancel", className: "btn btn-secondary" },
      { text: "Delete", value: "confirm", className: "btn btn-danger" },
    ]
  ).then((value) => {
    if (value !== "confirm") return;
    const state = libraryState.get();
    libraryState.set({
      folders: state.folders.filter((f) => !ids.includes(f.id)),
      files: state.files.filter((f) => !ids.includes(f.id)),
      selectedIds: [],
    });
    announce(`${ids.length} item${ids.length === 1 ? "" : "s"} deleted`);
  });
}

function handleItemClick(e) {
  const container = document.getElementById("libraryItems");
  const el = e.target.closest("[data-id]");

  if (!el) {
    if (e.target === container) libraryState.set({ selectedIds: [] });
    return;
  }

  const id = el.dataset.id;
  const state = libraryState.get();
  let selectedIds;

  if (e.shiftKey && lastClickedId) {
    selectedIds = computeRangeSelection(currentItems(), lastClickedId, id);
  } else if (e.ctrlKey || e.metaKey) {
    selectedIds = state.selectedIds.includes(id)
      ? state.selectedIds.filter((sid) => sid !== id)
      : [...state.selectedIds, id];
  } else {
    selectedIds = [id];
  }

  lastClickedId = id;
  libraryState.set({ selectedIds });
  announce(`${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} selected`);
}

function handleItemDblClick(e) {
  const el = e.target.closest("[data-id]");
  if (!el) return;
  if (el.dataset.type === "folder") {
    libraryState.set({ currentFolderId: el.dataset.id, selectedIds: [] });
  } else {
    openInStudio(el.dataset.id);
  }
}

function isEditingText() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

function handleKeydown(e) {
  if (isEditingText()) return;
  const state = libraryState.get();

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    const selectedIds = currentItems().map((i) => i.id);
    libraryState.set({ selectedIds });
    announce(`${selectedIds.length} items selected`);
    return;
  }

  if (e.key === "Escape") {
    libraryState.set({ selectedIds: [] });
    return;
  }

  if ((e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) && state.currentFolderId !== null) {
    e.preventDefault();
    const parent = state.folders.find((f) => f.id === state.currentFolderId);
    libraryState.set({ currentFolderId: parent ? parent.parentId : null, selectedIds: [] });
    return;
  }

  if (e.key === "Enter" && state.selectedIds.length === 1) {
    const id = state.selectedIds[0];
    const isFolder = state.folders.some((f) => f.id === id);
    if (isFolder) {
      libraryState.set({ currentFolderId: id, selectedIds: [] });
    } else {
      openInStudio(id);
    }
    return;
  }

  if (e.key === "Delete" && state.selectedIds.length > 0) {
    requestDelete(state.selectedIds);
    return;
  }

  if (e.key === "F2" && state.selectedIds.length === 1) {
    import("./library-context-menu.js").then(({ requestRename }) => requestRename(state.selectedIds[0]));
  }
}

export function addFiles(fileList) {
  const files = Array.from(fileList);
  const supported = files.filter((f) => isSupportedFile(f.name));
  const rejected = files.length - supported.length;

  if (rejected > 0) {
    showToast({
      type: "warning",
      title: "Unsupported file type",
      message: "Only .glb and .gltf files are supported.",
    });
  }
  if (supported.length === 0) return;

  const currentFolderId = libraryState.get().currentFolderId;
  const newFiles = supported.map((f) => ({
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: f.name,
    parentId: currentFolderId,
    status: "uploading",
    sizeBytes: f.size,
    dateModified: Date.now(),
  }));

  libraryState.set({ files: [...libraryState.get().files, ...newFiles] });
  announce(`${newFiles.length} file${newFiles.length === 1 ? "" : "s"} uploading`);

  newFiles.forEach((nf) => {
    setTimeout(() => {
      const files = libraryState.get().files.map((f) => (f.id === nf.id ? { ...f, status: "wip" } : f));
      libraryState.set({ files });
      announce(`${nf.name} added`);
    }, 600);
  });
}

function initDropzone() {
  const content = document.getElementById("libraryContent");
  const overlay = document.getElementById("libraryDropOverlay");
  if (!content) return;

  content.addEventListener("dragover", (e) => {
    e.preventDefault();
    overlay?.classList.add("active");
  });
  content.addEventListener("dragleave", () => overlay?.classList.remove("active"));
  content.addEventListener("drop", (e) => {
    e.preventDefault();
    overlay?.classList.remove("active");
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
}

export function initLibraryGrid() {
  initDropzone();

  const container = document.getElementById("libraryItems");
  container?.addEventListener("click", handleItemClick);
  container?.addEventListener("dblclick", handleItemDblClick);
  document.addEventListener("keydown", handleKeydown);

  on(EVENTS.LIBRARY_STATE_CHANGED, render);
  render();
}

import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { getChildItems, filterItems, sortItems, isSupportedFile, formatBytes } from "../utils/library-items.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toasts.js";

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

function render() {
  const container = document.getElementById("libraryItems");
  if (!container) return;
  const state = libraryState.get();
  const items = currentItems();
  renderItems(container, items, state.viewMode);

  const countEl = document.getElementById("libraryItemCount");
  if (countEl) countEl.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
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
  on(EVENTS.LIBRARY_STATE_CHANGED, render);
  render();
}

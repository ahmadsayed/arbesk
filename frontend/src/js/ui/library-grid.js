import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { escapeHtml } from "../utils/html.js";
import { getBlobFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import {
  computeRangeSelection,
  filterItems,
  formatBytes,
} from "../utils/library-items.js";

export function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function renderStatus(item, viewMode = "grid") {
  const isGrid = viewMode === "grid";
  if (item.status === "besked") {
    return isGrid
      ? `<span class="status-check" title="Besked"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`
      : `<span class="status-badge status-besked">Besked</span>`;
  }
  return isGrid
    ? `<span class="status-flag" title="Work in Progress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4M4 4h14l-2.5 4L18 12H4"/></svg></span>`
    : `<span class="status-badge status-wip">Work in Progress</span>`;
}

function defaultIcon(type) {
  if (type === "collection") {
    return `<svg class="library-item-icon collection-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  }
  return `<svg class="library-item-icon asset-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
}

export function createItemElement(item, viewMode) {
  if (viewMode === "list") {
    const el = document.createElement("tr");
    el.className = "library-row";
    el.dataset.id = item.id;
    el.dataset.type = item.type;
    el.draggable = true;
    el.tabIndex = 0;
    el.setAttribute("role", "row");
    el.setAttribute("aria-selected", "false");
    el.innerHTML = `
      <td class="library-row-name"><span class="library-item-icon">${defaultIcon(
        item.type
      )}</span><span class="library-item-name">${escapeHtml(
      item.name
    )}</span></td>
      <td>${renderStatus(item, "list")}</td>
      <td>${
        item.dateModified
          ? new Date(item.dateModified).toLocaleDateString()
          : "—"
      }</td>
      <td>${item.sizeBytes ? formatBytes(item.sizeBytes) : "—"}</td>
    `;
    return el;
  }

  const el = document.createElement("div");
  el.className = "library-item";
  el.dataset.id = item.id;
  el.dataset.type = item.type;
  el.draggable = true;
  el.tabIndex = 0;
  el.setAttribute("role", "option");
  el.setAttribute("aria-selected", "false");
  el.innerHTML = `
    <div class="library-item-thumbnail" data-thumbnail-cid="${escapeHtml(
      item.thumbnailCid || ""
    )}">${defaultIcon(item.type)}${renderStatus(item)}</div>
    <span class="library-item-name">${escapeHtml(item.name)}</span>
  `;
  return el;
}

function extractThumbnailCid(thumbnail) {
  if (!thumbnail) return "";
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || "";
}

async function loadItemThumbnail(el, cid, name) {
  if (!cid || !el) return;
  try {
    const blob = await getBlobFromRemoteIPFS(cid);
    const objectUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.alt = `${name || "Item"} thumbnail`;
    img.loading = "lazy";
    img.src = objectUrl;
    img.addEventListener("load", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    img.addEventListener("error", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    el.textContent = "";
    el.appendChild(img);
  } catch (err) {
    console.warn("Failed to load library thumbnail", cid, err);
  }
}

function loadVisibleThumbnails(container) {
  container?.querySelectorAll("[data-thumbnail-cid]").forEach((el) => {
    const cid = el.dataset.thumbnailCid;
    if (!cid) return;
    const name = el
      .closest("[data-id]")
      ?.querySelector(".library-item-name")?.textContent;
    loadItemThumbnail(el, cid, name);
  });
}

function buildEmptyState(searchQuery) {
  const el = document.createElement("div");
  el.className = "empty-state";
  if (searchQuery) {
    el.innerHTML = `
      <h2 class="empty-state-title">No items match your search</h2>
      <p class="empty-state-sub">Try a different name.</p>
    `;
  } else {
    const inCollection = libraryState.get().currentCollectionTokenId !== null;
    el.innerHTML = `
      <h2 class="empty-state-title">${
        inCollection ? "No assets in this collection" : "No collections yet"
      }</h2>
      <p class="empty-state-sub">${
        inCollection
          ? "Assets you publish to this collection will appear here."
          : "Connect your wallet and publish your first asset to see collections."
      }</p>
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
    items.forEach((item) =>
      tbody.appendChild(createItemElement(item, viewMode))
    );
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    items.forEach((item) =>
      container.appendChild(createItemElement(item, viewMode))
    );
    loadVisibleThumbnails(container);
  }
}

function sortItems(items, sortBy) {
  const sorted = [...items];
  if (sortBy === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "date") {
    sorted.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
  } else if (sortBy === "status") {
    const rank = { uploading: 0, wip: 1, besked: 2 };
    sorted.sort((a, b) => (rank[a.status] ?? -1) - (rank[b.status] ?? -1));
  }
  const collections = sorted.filter((i) => i.type === "collection");
  const assets = sorted.filter((i) => i.type === "asset");
  return [...collections, ...assets];
}

function currentItems() {
  const state = libraryState.get();
  const source =
    state.currentCollectionTokenId === null ? state.collections : state.assets;
  return sortItems(filterItems(source, state.searchQuery), state.sortBy);
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

  const countEl = document.getElementById("libraryItemCount");
  if (state.isLoading) {
    container.innerHTML = `
      <div class="library-loading">
        <div class="library-spinner" aria-hidden="true"></div>
        <span>Loading collections…</span>
      </div>`;
    if (countEl) countEl.textContent = "Loading…";
    announce("Loading collections");
    return;
  }

  const items = currentItems();
  renderItems(container, items, state.viewMode);
  applySelection(container, state.selectedIds);

  if (countEl)
    countEl.textContent = `${items.length} item${
      items.length === 1 ? "" : "s"
    }`;
}

let lastClickedId = null;
let lastClickTime = 0;
const DOUBLE_CLICK_MS = 400;

export function openInStudio(tokenId, assetId) {
  const params = new URLSearchParams();
  params.set("asset", tokenId);
  if (assetId) params.set("assetId", assetId);
  window.location.href = `/studio.html?${params.toString()}`;
}

function openItem(id) {
  const state = libraryState.get();
  const collection = state.collections.find((c) => c.id === id);
  if (collection) {
    libraryState.set({
      currentCollectionTokenId: collection.tokenId,
      selectedIds: [],
    });
    announce(`Opened collection ${collection.name}`);
    return;
  }
  const asset = state.assets.find((a) => a.id === id);
  if (asset) {
    openInStudio(asset.tokenId, asset.assetId);
  }
}

function handleItemClick(e) {
  const container = document.getElementById("libraryItems");
  const el = e.target.closest("[data-id]");

  if (!el) {
    if (e.target === container) libraryState.set({ selectedIds: [] });
    return;
  }

  const id = el.dataset.id;
  const now = Date.now();
  const isDoubleClick =
    id === lastClickedId &&
    now - lastClickTime < DOUBLE_CLICK_MS &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey;
  lastClickTime = now;

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
  announce(
    `${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} selected`
  );

  if (isDoubleClick) openItem(id);
}

function isEditingText() {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
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

  if (
    (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) &&
    state.currentCollectionTokenId !== null
  ) {
    e.preventDefault();
    libraryState.set({
      currentCollectionTokenId: null,
      selectedIds: [],
    });
    announce("Returned to collections");
    return;
  }

  if (e.key === "Enter" && state.selectedIds.length === 1) {
    openItem(state.selectedIds[0]);
    return;
  }

  if (e.key === "Delete" && state.selectedIds.length > 0) {
    import("./library-context-menu.js").then(({ requestDeleteSelected }) =>
      requestDeleteSelected(state.selectedIds)
    );
    return;
  }

  if (e.key === "F2" && state.selectedIds.length === 1) {
    import("./library-context-menu.js").then(({ requestRename }) =>
      requestRename(state.selectedIds[0])
    );
  }
}

function rectsIntersect(a, b) {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

function initRubberBand() {
  const content = document.getElementById("libraryContent");
  if (!content) return;

  let band = null;
  let startX = 0;
  let startY = 0;
  let endX = 0;
  let endY = 0;

  content.addEventListener("mousedown", (e) => {
    if (e.target.closest("[data-id]")) return;
    if (e.button !== 0) return;

    startX = e.clientX;
    startY = e.clientY;
    endX = e.clientX;
    endY = e.clientY;
    band = document.createElement("div");
    band.className = "library-rubber-band";
    document.body.appendChild(band);
    positionBand(band, startX, startY, startX, startY);
  });

  document.addEventListener("mousemove", (e) => {
    if (!band) return;
    endX = e.clientX;
    endY = e.clientY;
    positionBand(band, startX, startY, endX, endY);
  });

  document.addEventListener("mouseup", () => {
    if (!band) return;
    const boxRect = {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      right: Math.max(startX, endX),
      bottom: Math.max(startY, endY),
    };
    band.remove();
    band = null;

    const container = document.getElementById("libraryItems");
    const selectedIds = [];
    container?.querySelectorAll("[data-id]").forEach((el) => {
      if (rectsIntersect(boxRect, el.getBoundingClientRect()))
        selectedIds.push(el.dataset.id);
    });
    if (selectedIds.length > 0) {
      libraryState.set({ selectedIds });
      announce(
        `${selectedIds.length} item${
          selectedIds.length === 1 ? "" : "s"
        } selected`
      );
    }
  });
}

function positionBand(band, x1, y1, x2, y2) {
  band.style.left = `${Math.min(x1, x2)}px`;
  band.style.top = `${Math.min(y1, y2)}px`;
  band.style.width = `${Math.abs(x2 - x1)}px`;
  band.style.height = `${Math.abs(y2 - y1)}px`;
}

export function initLibraryGrid() {
  initRubberBand();

  const container = document.getElementById("libraryItems");
  container?.addEventListener("click", handleItemClick);
  document.addEventListener("keydown", handleKeydown);

  on(EVENTS.LIBRARY_STATE_CHANGED, render);
  render();
}

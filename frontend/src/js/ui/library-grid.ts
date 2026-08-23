import { libraryState } from "../state/library-state.ts";
import type { LibraryItem } from "../state/library-state.ts";
import { on, EVENTS } from "../asset-core/events/bus.ts";
import { escapeHtml } from "../utils/html.ts";
import { loadThumbnailInto } from "../utils/thumbnail.ts";
import {
  computeRangeSelection,
  filterItems,
  formatBytes,
} from "../utils/library-items.ts";

export function announce(text: string): void {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function renderStatus(item: any, viewMode: string = "grid"): string {
  const isGrid = viewMode === "grid";
  if (item.status === "minting") {
    return isGrid
      ? `<span class="status-minting" role="status" title="Minting…" aria-label="Minting"><span class="status-minting-ring" aria-hidden="true"></span></span>`
      : `<span class="status-badge status-pending">Minting…</span>`;
  }
  if (item.status === "besked") {
    return isGrid
      ? `<span class="status-check" title="Besked"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><use href="/icons.svg#check"/></svg></span>`
      : `<span class="status-badge status-besked">Besked</span>`;
  }
  return isGrid
    ? `<span class="status-flag" title="Work in Progress"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="/icons.svg#flag"/></svg></span>`
    : `<span class="status-badge status-wip">Work in Progress</span>`;
}

function defaultIcon(type: string): string {
  if (type === "collection") {
    return `<svg class="library-item-icon collection-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#folder"/></svg>`;
  }
  return `<svg class="library-item-icon asset-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#file-text"/></svg>`;
}

export function createItemElement(item: any, viewMode: string): HTMLElement {
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
          : "-"
      }</td>
      <td>${item.sizeBytes ? formatBytes(item.sizeBytes) : "-"}</td>
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

function loadVisibleThumbnails(container: HTMLElement): void {
  container?.querySelectorAll("[data-thumbnail-cid]").forEach((el) => {
    const itemEl = el as HTMLElement;
    const cid = itemEl.dataset.thumbnailCid;
    if (!cid) return;
    const name = itemEl
      .closest("[data-id]")
      ?.querySelector(".library-item-name")?.textContent;
    loadThumbnailInto(itemEl, cid, name || "Item");
  });
}

function buildEmptyState(searchQuery: string): HTMLDivElement {
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
          : "Sign in and publish your first asset to see collections."
      }</p>
    `;
  }
  return el;
}

export function renderItems(
  container: HTMLElement,
  items: any[],
  viewMode: string
): void {
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

function sortItems(items: any[], sortBy: string): any[] {
  const sorted = [...items];
  if (sortBy === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "date") {
    sorted.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
  } else if (sortBy === "status") {
    const rank: Record<string, number> = { uploading: 0, minting: 1, wip: 2, besked: 3 };
    sorted.sort((a, b) => (rank[a.status] ?? -1) - (rank[b.status] ?? -1));
  }
  const collections = sorted.filter((i) => i.type === "collection");
  const assets = sorted.filter((i) => i.type === "asset");
  return [...collections, ...assets];
}

function currentItems(): any[] {
  const state = libraryState.get();
  const source = (
    state.currentCollectionTokenId === null ? state.collections : state.assets
  ) as LibraryItem[];
  return sortItems(filterItems(source, state.searchQuery), state.sortBy);
}

function applySelection(
  container: HTMLElement,
  selectedIds: Array<string | number>
): void {
  container.querySelectorAll("[data-id]").forEach((el) => {
    const selected = selectedIds.includes(
      (el as HTMLElement).dataset.id ?? ""
    );
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-selected", String(selected));
  });
}

function render(): void {
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

let lastClickedId: string | number | null = null;
let lastClickTime = 0;
const DOUBLE_CLICK_MS = 400;

export function openInStudio(tokenId: string | number, assetId?: string | number): void {
  const params = new URLSearchParams();
  params.set("asset", String(tokenId));
  if (assetId) params.set("assetId", String(assetId));
  // SPA in-app transition — no full reload, so the wallet/session stay alive.
  // The router activates the Studio view and calls loadFromParams() to open the
  // asset the query string points at.
  import("../app/router.ts")
    .then(({ navigate }) => navigate(`/studio?${params.toString()}`))
    .catch((err) => console.error("[LIBRARY] open-in-studio failed:", err));
}

export function openItem(id: string | number): void {
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

function handleItemClick(e: MouseEvent): void {
  const container = document.getElementById("libraryItems");
  const target = e.target as HTMLElement;
  const el = target.closest("[data-id]");

  if (!el) {
    if (target === container) libraryState.set({ selectedIds: [] });
    return;
  }

  // [data-id] elements always carry the attribute.
  const id = (el as HTMLElement).dataset.id as string;
  const now = Date.now();
  const isDoubleClick =
    id === lastClickedId &&
    now - lastClickTime < DOUBLE_CLICK_MS &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey;
  lastClickTime = now;

  const state = libraryState.get();
  let selectedIds: Array<string | number>;

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

function isEditingText(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable
  );
}

function handleKeydown(e: KeyboardEvent): void {
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
    import("./library-context-menu.ts").then(({ requestDeleteSelected }) =>
      // Grid selection ids always originate from dataset strings.
      requestDeleteSelected(state.selectedIds as string[])
    );
    return;
  }

  if (e.key === "F2" && state.selectedIds.length === 1) {
    import("./library-context-menu.ts").then(({ requestRename }) =>
      requestRename(state.selectedIds[0] as string)
    );
  }
}

interface RectEdges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectsIntersect(a: RectEdges, b: RectEdges): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

function initRubberBand(): void {
  const content = document.getElementById("libraryContent");
  if (!content) return;

  let band: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let endX = 0;
  let endY = 0;

  content.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("[data-id]")) return;
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
    const selectedIds: Array<string | number> = [];
    container?.querySelectorAll("[data-id]").forEach((el) => {
      const itemEl = el as HTMLElement;
      if (
        itemEl.dataset.id !== undefined &&
        rectsIntersect(boxRect, itemEl.getBoundingClientRect())
      )
        selectedIds.push(itemEl.dataset.id);
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

function positionBand(
  band: HTMLElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  band.style.left = `${Math.min(x1, x2)}px`;
  band.style.top = `${Math.min(y1, y2)}px`;
  band.style.width = `${Math.abs(x2 - x1)}px`;
  band.style.height = `${Math.abs(y2 - y1)}px`;
}

export function initLibraryGrid(): void {
  initRubberBand();

  const container = document.getElementById("libraryItems");
  container?.addEventListener("click", handleItemClick);
  document.addEventListener("keydown", handleKeydown);

  on(EVENTS.LIBRARY_STATE_CHANGED, render);
  render();
}

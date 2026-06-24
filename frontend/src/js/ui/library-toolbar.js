import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { escapeHtml } from "../utils/html.js";

export function buildBreadcrumb(collections, currentCollectionTokenId) {
  const path = [{ tokenId: null, name: "Home" }];
  if (currentCollectionTokenId) {
    const collection = collections.find(
      (c) => String(c.tokenId) === String(currentCollectionTokenId)
    );
    if (collection) {
      path.push({
        tokenId: collection.tokenId,
        name: collection.name || `Collection #${collection.tokenId}`,
      });
    }
  }
  return path;
}

export function renderBreadcrumb(container, collections, currentCollectionTokenId) {
  const path = buildBreadcrumb(collections, currentCollectionTokenId);
  container.innerHTML = path
    .map((segment, i) => {
      const isLast = i === path.length - 1;
      const label = escapeHtml(segment.name);
      if (isLast) {
        return `<span class="pathbar-current">${label}</span>`;
      }
      return `<button type="button" class="pathbar-segment" data-collection-token-id="${segment.tokenId ?? ""}">${label}</button><span class="pathbar-separator">›</span>`;
    })
    .join("");
}

function renderToolbar() {
  const state = libraryState.get();
  const breadcrumb = document.getElementById("libraryBreadcrumb");
  if (breadcrumb)
    renderBreadcrumb(breadcrumb, state.collections, state.currentCollectionTokenId);

  const upBtn = document.getElementById("libraryUpBtn");
  if (upBtn) upBtn.hidden = state.currentCollectionTokenId === null;

  const gridBtn = document.getElementById("libraryGridViewBtn");
  const listBtn = document.getElementById("libraryListViewBtn");
  gridBtn?.classList.toggle("active", state.viewMode === "grid");
  listBtn?.classList.toggle("active", state.viewMode === "list");
}

export function initLibraryToolbar() {
  document.getElementById("libraryUpBtn")?.addEventListener("click", () => {
    libraryState.set({ currentCollectionTokenId: null, selectedIds: [] });
    announce("Returned to collections");
  });

  document.getElementById("libraryBreadcrumb")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-collection-token-id]");
    if (!btn) return;
    const tokenId = btn.dataset.collectionTokenId || null;
    libraryState.set({ currentCollectionTokenId: tokenId, selectedIds: [] });
  });

  document.getElementById("librarySearchInput")?.addEventListener("input", (e) => {
    libraryState.set({ searchQuery: e.target.value });
  });

  document.getElementById("librarySortSelect")?.addEventListener("change", (e) => {
    libraryState.set({ sortBy: e.target.value });
  });

  document.getElementById("libraryGridViewBtn")?.addEventListener("click", () =>
    libraryState.set({ viewMode: "grid" })
  );
  document.getElementById("libraryListViewBtn")?.addEventListener("click", () =>
    libraryState.set({ viewMode: "list" })
  );

  on(EVENTS.LIBRARY_STATE_CHANGED, renderToolbar);
  renderToolbar();
}

function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

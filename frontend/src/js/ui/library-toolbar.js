// @ts-nocheck
import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toasts.js";
import { uploadFileToCollection } from "../services/library-ops.js";
import { createCollectionFlow } from "./library-create.js";

async function refreshLibraryData() {
  const { refreshLibraryData: doRefresh } = await import("../library-init.js");
  return doRefresh();
}

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

  const createBtn = document.getElementById("libraryCreateCollectionBtn");
  if (createBtn) {
    createBtn.disabled = state.currentCollectionTokenId !== null;
    createBtn.title =
      state.currentCollectionTokenId !== null
        ? "Return to collections to create a new collection"
        : "";
  }
}

async function handleCreateCollection() {
  if (libraryState.get().currentCollectionTokenId !== null) {
    showToast({
      type: "warning",
      title: "Cannot Create Collection",
      message: "Return to the collections list to create a new collection.",
    });
    return;
  }

  const btn = document.getElementById("libraryCreateCollectionBtn");
  if (btn) {
    btn.disabled = true;
    btn.title = "Creating…";
  }

  try {
    // Optimistic: shows the card and kicks off the mint in the background.
    // Returns once the dialog is handled, not when the transaction settles.
    await createCollectionFlow();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.title = "";
    }
  }
}

async function handleUploadFile(file) {
  const state = libraryState.get();
  const collectionTokenId = state.currentCollectionTokenId;
  if (!collectionTokenId) {
    showToast({
      type: "warning",
      title: "No Collection Open",
      message: "Open or create a collection first to upload a file into it.",
    });
    return;
  }

  const btn = document.getElementById("libraryUploadBtn");
  if (btn) {
    btn.disabled = true;
    btn.title = "Uploading…";
  }

  try {
    const { assetId } = await uploadFileToCollection(file, collectionTokenId);
    await refreshLibraryData();
    libraryState.set({ selectedIds: [`asset-${collectionTokenId}-${assetId}`] });
    announce(`Uploaded ${file.name}`);
    showToast({
      type: "success",
      title: "Upload Complete",
      message: `"${file.name}" was added to the collection.`,
    });
  } catch (err) {
    console.error("[LIBRARY-TOOLBAR] upload failed:", err);
    showToast({
      type: "error",
      title: "Upload Failed",
      message: err.message || "Could not upload the file.",
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.title = "";
    }
    // Reset the input so the same file can be selected again
    const input = document.getElementById("libraryUploadInput");
    if (input) input.value = "";
  }
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

  document
    .getElementById("libraryCreateCollectionBtn")
    ?.addEventListener("click", handleCreateCollection);

  document
    .getElementById("libraryUploadBtn")
    ?.addEventListener("click", () => {
      if (!libraryState.get().currentCollectionTokenId) {
        showToast({
          type: "warning",
          title: "No Collection Open",
          message: "Open or create a collection first to upload a file into it.",
        });
        return;
      }
      document.getElementById("libraryUploadInput")?.click();
    });

  document
    .getElementById("libraryUploadInput")
    ?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleUploadFile(file);
    });

  on(EVENTS.LIBRARY_STATE_CHANGED, renderToolbar);
  renderToolbar();
}

function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

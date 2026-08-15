import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toasts.js";
import { uploadFileToCollection } from "../services/library-ops.js";
import { createCollectionFlow } from "./library-create.js";

async function refreshLibraryData() {
  const { refreshLibraryData: doRefresh } = await import("./library-controller.js");
  return doRefresh();
}

/**
 * @param {any[]} collections
 * @param {string|number|null} currentCollectionTokenId
 */
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

/**
 * @param {HTMLElement} container
 * @param {any[]} collections
 * @param {string|number|null} currentCollectionTokenId
 */
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

  const createBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("libraryCreateCollectionBtn")
  );
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

  const btn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("libraryCreateCollectionBtn")
  );
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

/** @param {File} file */
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

  const btn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById("libraryUploadBtn")
  );
  if (btn) {
    btn.disabled = true;
    btn.title = "Uploading…";
  }

  const { startTaskProgress, setTaskProgress, finishTaskProgress, failTaskProgress } =
    await import("./task-progress.js");
  const PROGRESS_ROOT = "libraryProgress";
  startTaskProgress(`Uploading ${file.name}…`, 0.02, PROGRESS_ROOT);

  try {
    const { assetId } = await uploadFileToCollection(file, collectionTokenId, {
      onStage: (fraction, label) => setTaskProgress(fraction, label, PROGRESS_ROOT),
    });
    finishTaskProgress(`Uploaded ${file.name}.`, PROGRESS_ROOT);
    await refreshLibraryData();
    libraryState.set({ selectedIds: [`asset-${collectionTokenId}-${assetId}`] });
    announce(`Uploaded ${file.name}`);
    showToast({
      type: "success",
      title: "Upload Complete",
      message: `"${file.name}" was added to the collection.`,
    });
  } catch (err) {
    failTaskProgress(`Failed to upload ${file.name}.`, PROGRESS_ROOT);
    console.error("[LIBRARY-TOOLBAR] upload failed:", err);
    showToast({
      type: "error",
      title: "Upload Failed",
      message: /** @type {Error} */ (err).message || "Could not upload the file.",
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.title = "";
    }
    // Reset the input so the same file can be selected again
    const input = /** @type {HTMLInputElement|null} */ (
      document.getElementById("libraryUploadInput")
    );
    if (input) input.value = "";
  }
}

/**
 * OS file drop onto the Library view. Dropping a .glb/.gltf/.3mf runs the
 * exact upload-button flow (validate → IPFS → decompose → asset named after
 * the file → add to the open collection). The overlay mirrors the viewport
 * drop indicator; its label flips to the no-collection hint when the upload
 * would be rejected, so the affordance is honest during the drag.
 */
function initLibraryDropZone() {
  const view = document.getElementById("libraryView");
  const overlay = document.getElementById("libraryDropOverlay");
  const label = document.getElementById("libraryDropText");
  if (!view || !overlay) return;

  // Nested children each fire dragenter/dragleave — track depth so the
  // overlay only hides when the pointer truly leaves the view.
  let dragDepth = 0;
  const isFileDrag = (/** @type {DragEvent} */ e) =>
    e.dataTransfer?.types?.includes("Files");

  const syncLabel = () => {
    if (!label) return;
    label.textContent = libraryState.get().currentCollectionTokenId
      ? "Drop to upload to this collection"
      : "Open a collection to upload files";
  };

  view.addEventListener("dragenter", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    syncLabel();
    overlay.classList.add("active");
  });
  view.addEventListener("dragover", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    (/** @type {DataTransfer} */ (e.dataTransfer)).dropEffect = "copy";
  });
  view.addEventListener("dragleave", (e) => {
    if (!isFileDrag(e)) return;
    dragDepth--;
    if (dragDepth <= 0) {
      dragDepth = 0;
      overlay.classList.remove("active");
    }
  });
  view.addEventListener("drop", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    overlay.classList.remove("active");
    const file = (/** @type {DataTransfer} */ (e.dataTransfer)).files?.[0];
    if (file) handleUploadFile(file);
  });
}

export function initLibraryToolbar() {
  document.getElementById("libraryUpBtn")?.addEventListener("click", () => {
    libraryState.set({ currentCollectionTokenId: null, selectedIds: [] });
    announce("Returned to collections");
  });

  document.getElementById("libraryBreadcrumb")?.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement|null} */ (
      /** @type {HTMLElement} */ (e.target).closest("[data-collection-token-id]")
    );
    if (!btn) return;
    const tokenId = btn.dataset.collectionTokenId || null;
    libraryState.set({ currentCollectionTokenId: tokenId, selectedIds: [] });
  });

  document.getElementById("librarySearchInput")?.addEventListener("input", (e) => {
    libraryState.set({ searchQuery: /** @type {HTMLInputElement} */ (e.target).value });
  });

  document.getElementById("librarySortSelect")?.addEventListener("change", (e) => {
    libraryState.set({ sortBy: /** @type {HTMLSelectElement} */ (e.target).value });
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
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (file) handleUploadFile(file);
    });

  initLibraryDropZone();

  on(EVENTS.LIBRARY_STATE_CHANGED, renderToolbar);
  renderToolbar();
}

/** @param {string} text */
function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

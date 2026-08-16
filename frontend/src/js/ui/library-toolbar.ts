import { libraryState } from "../state/library-state.ts";
import type { LibraryCollectionItem } from "../state/library-state.ts";
import { on, EVENTS } from "../events/bus.ts";
import { escapeHtml } from "../utils/html.ts";
import { showToast } from "./toasts.ts";
import { uploadFileToCollection } from "../services/library-ops.ts";
import { createCollectionFlow } from "./library-create.ts";

async function refreshLibraryData(): Promise<void> {
  const { refreshLibraryData: doRefresh } = await import("./library-controller.ts");
  return doRefresh();
}

interface BreadcrumbSegment {
  tokenId: string | number | null;
  name: string;
}

export function buildBreadcrumb(
  collections: LibraryCollectionItem[],
  currentCollectionTokenId: string | number | null
): BreadcrumbSegment[] {
  const path: BreadcrumbSegment[] = [{ tokenId: null, name: "Home" }];
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

export function renderBreadcrumb(
  container: HTMLElement,
  collections: LibraryCollectionItem[],
  currentCollectionTokenId: string | number | null
): void {
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

function renderToolbar(): void {
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

  const createBtn = document.getElementById(
    "libraryCreateCollectionBtn"
  ) as HTMLButtonElement | null;
  if (createBtn) {
    createBtn.disabled = state.currentCollectionTokenId !== null;
    createBtn.title =
      state.currentCollectionTokenId !== null
        ? "Return to collections to create a new collection"
        : "";
  }
}

async function handleCreateCollection(): Promise<void> {
  if (libraryState.get().currentCollectionTokenId !== null) {
    showToast({
      type: "warning",
      title: "Cannot Create Collection",
      message: "Return to the collections list to create a new collection.",
    });
    return;
  }

  const btn = document.getElementById(
    "libraryCreateCollectionBtn"
  ) as HTMLButtonElement | null;
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

async function handleUploadFile(file: File): Promise<void> {
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

  const btn = document.getElementById(
    "libraryUploadBtn"
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.title = "Uploading…";
  }

  const { startTaskProgress, setTaskProgress, finishTaskProgress, failTaskProgress } =
    await import("./task-progress.ts");
  const PROGRESS_ROOT = "libraryProgress";
  startTaskProgress(`Uploading ${file.name}…`, 0.02, PROGRESS_ROOT);

  try {
    const { assetId } = await uploadFileToCollection(file, collectionTokenId, {
      onStage: (fraction: number, label: string) => setTaskProgress(fraction, label, PROGRESS_ROOT),
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
      message: (err as Error).message || "Could not upload the file.",
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.title = "";
    }
    // Reset the input so the same file can be selected again
    const input = document.getElementById(
      "libraryUploadInput"
    ) as HTMLInputElement | null;
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
function initLibraryDropZone(): void {
  const view = document.getElementById("libraryView");
  const overlay = document.getElementById("libraryDropOverlay");
  const label = document.getElementById("libraryDropText");
  if (!view || !overlay) return;

  // Nested children each fire dragenter/dragleave — track depth so the
  // overlay only hides when the pointer truly leaves the view.
  let dragDepth = 0;
  const isFileDrag = (e: DragEvent) =>
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
    (e.dataTransfer as DataTransfer).dropEffect = "copy";
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
    const file = (e.dataTransfer as DataTransfer).files?.[0];
    if (file) handleUploadFile(file);
  });
}

export function initLibraryToolbar(): void {
  document.getElementById("libraryUpBtn")?.addEventListener("click", () => {
    libraryState.set({ currentCollectionTokenId: null, selectedIds: [] });
    announce("Returned to collections");
  });

  document.getElementById("libraryBreadcrumb")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(
      "[data-collection-token-id]"
    ) as HTMLElement | null;
    if (!btn) return;
    const tokenId = btn.dataset.collectionTokenId || null;
    libraryState.set({ currentCollectionTokenId: tokenId, selectedIds: [] });
  });

  document.getElementById("librarySearchInput")?.addEventListener("input", (e) => {
    libraryState.set({ searchQuery: (e.target as HTMLInputElement).value });
  });

  document.getElementById("librarySortSelect")?.addEventListener("change", (e) => {
    libraryState.set({ sortBy: (e.target as HTMLSelectElement).value });
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
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleUploadFile(file);
    });

  initLibraryDropZone();

  on(EVENTS.LIBRARY_STATE_CHANGED, renderToolbar);
  renderToolbar();
}

function announce(text: string): void {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

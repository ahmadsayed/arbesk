import { libraryState } from "../state/library-state.js";
import { on, EVENTS } from "../events/bus.js";
import { buildBreadcrumb } from "../utils/library-items.js";
import { escapeHtml } from "../utils/html.js";
import { showDialog } from "./dialog.js";
import { addFiles } from "./library-grid.js";

export function renderBreadcrumb(container, folders, currentFolderId) {
  const path = buildBreadcrumb(folders, currentFolderId);
  container.innerHTML = path
    .map((segment, i) => {
      const isLast = i === path.length - 1;
      const label = escapeHtml(segment.name);
      if (isLast) {
        return `<span class="pathbar-current">${label}</span>`;
      }
      return `<button type="button" class="pathbar-segment" data-folder-id="${segment.id ?? ""}">${label}</button><span class="pathbar-separator">›</span>`;
    })
    .join("");
}

export function requestNewFolder() {
  return showDialog("New Folder", "Folder name", "New Folder").then((name) => {
    if (!name) return;
    const folder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      parentId: libraryState.get().currentFolderId,
    };
    libraryState.set({ folders: [...libraryState.get().folders, folder] });
  });
}

function renderToolbar() {
  const state = libraryState.get();
  const breadcrumb = document.getElementById("libraryBreadcrumb");
  if (breadcrumb) renderBreadcrumb(breadcrumb, state.folders, state.currentFolderId);

  const upBtn = document.getElementById("libraryUpBtn");
  if (upBtn) upBtn.hidden = state.currentFolderId === null;

  const gridBtn = document.getElementById("libraryGridViewBtn");
  const listBtn = document.getElementById("libraryListViewBtn");
  gridBtn?.classList.toggle("active", state.viewMode === "grid");
  listBtn?.classList.toggle("active", state.viewMode === "list");
}

export function initLibraryToolbar() {
  document.getElementById("libraryUpBtn")?.addEventListener("click", () => {
    const state = libraryState.get();
    const parent = state.folders.find((f) => f.id === state.currentFolderId);
    libraryState.set({ currentFolderId: parent ? parent.parentId : null, selectedIds: [] });
  });

  document.getElementById("libraryBreadcrumb")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-folder-id]");
    if (!btn) return;
    const id = btn.dataset.folderId || null;
    libraryState.set({ currentFolderId: id, selectedIds: [] });
  });

  document.getElementById("librarySearchInput")?.addEventListener("input", (e) => {
    libraryState.set({ searchQuery: e.target.value });
  });

  document.getElementById("librarySortSelect")?.addEventListener("change", (e) => {
    libraryState.set({ sortBy: e.target.value });
  });

  document.getElementById("libraryNewFolderBtn")?.addEventListener("click", requestNewFolder);

  const fileInput = document.getElementById("libraryFileInput");
  document.getElementById("libraryUploadBtn")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  });

  document.getElementById("libraryGridViewBtn")?.addEventListener("click", () => libraryState.set({ viewMode: "grid" }));
  document.getElementById("libraryListViewBtn")?.addEventListener("click", () => libraryState.set({ viewMode: "list" }));

  on(EVENTS.LIBRARY_STATE_CHANGED, renderToolbar);
  renderToolbar();
}

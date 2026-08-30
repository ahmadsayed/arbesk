import { libraryState } from "../state/library-state.ts";
import type {
  LibraryAssetItem,
  LibraryCollectionItem,
  LibraryItem,
} from "../state/library-state.ts";
import {
  showBurnCollectionDialog,
  showConfirmDialog,
  showCustomDialog,
  showDialog,
} from "./dialog.ts";
import { escapeHtml } from "../utils/html.ts";
import { showToast } from "./toasts.ts";
import { createCollectionFlow } from "./library-create.ts";
import { openInStudio } from "./library-open.ts";

// Blockchain/IPFS operations are loaded lazily so that unit tests for this
// module can run in jsdom without pulling in the full Studio dependency tree.
const assetDeleteOps = () => import("../services/asset-delete.ts");
const ipfsOps = () => import("../ipfs/remote-ipfs.ts");
const ipfsWriteOps = () => import("../ipfs/write-to-ipfs.ts");
const libraryInitOps = () => import("./library-controller.ts");
const collaboratorsPanelOps = () => import("./collaborators-panel.ts");

let menuEl: HTMLElement | null = null;

export function closeContextMenu(): void {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function announce(text: string): void {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function getItem(id: string): LibraryItem | null {
  const state = libraryState.get();
  return (
    state.collections.find((c) => c.id === id) ||
    state.assets.find((a) => a.id === id) ||
    null
  );
}

function isCollection(id: string): boolean {
  return libraryState.get().collections.some((c) => c.id === id);
}

interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

function singleItemMenuItems(ids: string[]): ContextMenuItem[] {
  const id = ids[0];
  if (isCollection(id)) {
    const collection = getItem(id);
    if (!collection) return [];
    return [
      { label: "Open", action: () => openCollection(id) },
      {
        label: "Open in Studio",
        action: async () => {
          openInStudio(collection.tokenId);
        },
      },
      { label: "Rename", action: () => requestRename(id) },
      {
        label: "Manage Collaborators",
        action: () => requestManageCollaborators(id),
      },
      {
        label: "Burn Collection",
        action: () => requestBurnCollection(id),
        danger: true,
      },
    ];
  }
  return [
    { label: "Open in Studio", action: () => openSelectedAssetInStudio([id]) },
    { label: "Send to Collection…", action: () => requestSendToCollection(id) },
    { label: "Rename", action: () => requestRename(id) },
    {
      label: "Delete",
      action: () => requestDeleteSelected(ids),
      danger: true,
    },
  ];
}

function multiSelectionMenuItems(ids: string[]): ContextMenuItem[] {
  return [
    { label: "Open first in Studio", action: () => openSelectedAssetInStudio(ids) },
    { label: "Delete", action: () => requestDeleteSelected(ids), danger: true },
  ];
}

function emptySpaceMenuItems(): ContextMenuItem[] {
  const inCollection = libraryState.get().currentCollectionTokenId !== null;
  const items = [
    { label: "Upload File…", action: () => requestUploadFile() },
    { label: "Refresh", action: () => refreshLibrary() },
  ];
  if (!inCollection) {
    items.unshift({ label: "New Collection", action: () => requestCreateCollection() });
  }
  return items;
}

async function refreshLibrary(): Promise<void> {
  const { refreshLibraryData } = await libraryInitOps();
  refreshLibraryData();
}

async function requestCreateCollection(): Promise<void> {
  await createCollectionFlow();
}

function requestUploadFile(): void {
  const input = document.getElementById("libraryUploadInput");
  if (!input) return;
  if (!libraryState.get().currentCollectionTokenId) {
    showToast({
      type: "warning",
      title: "No Collection Open",
      message: "Open or create a collection first to upload a file into it.",
    });
    return;
  }
  input.click();
}

function openCollection(id: string): void {
  const collection = libraryState.get().collections.find((c) => c.id === id);
  if (!collection) return;
  libraryState.set({
    currentCollectionTokenId: collection.tokenId,
    selectedIds: [],
  });
  announce(`Opened collection ${collection.name}`);
}

async function openSelectedAssetInStudio(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const asset = libraryState.get().assets.find((a) => a.id === ids[0]);
  if (!asset) return;
  openInStudio(asset.tokenId, asset.assetId);
}

async function requestManageCollaborators(id: string): Promise<void> {
  const collection = getItem(id);
  if (!collection) return;

  const { initCollaboratorPanel } = await collaboratorsPanelOps();
  const container = document.createElement("div");
  const panel = initCollaboratorPanel(container, collection.tokenId, {
    editable: true,
  });

  await showCustomDialog("Manage Collaborators", container);
  panel.destroy();
}

async function requestBurnCollection(id: string): Promise<void> {
  const collection = getItem(id);
  if (!collection) return;

  const confirmed = await showBurnCollectionDialog(collection.name);
  if (confirmed !== "burn") return;

  try {
    const { burnCollection } = await assetDeleteOps();
    const txHash = await burnCollection(collection.tokenId);
    if (!txHash) throw new Error("Burn transaction failed");

    // Remove the burned collection from local state instead of triggering a full refresh.
    libraryState.set({
      collections: libraryState.get().collections.filter((c) => c.id !== id),
      selectedIds: [],
    });
    announce(`Burned collection ${collection.name}`);
    showToast({
      type: "info",
      title: "Collection Burned",
      message: `"${collection.name}" and its assets have been burned.`,
    });
  } catch (err) {
    console.error("[LIBRARY-CONTEXT-MENU] burn collection failed:", err);
    showToast({
      type: "error",
      title: "Burn Failed",
      message: (err as Error).message || "Could not burn the collection.",
    });
  }
}

export async function requestRename(id: string): Promise<void> {
  const item = getItem(id);
  if (!item) return;

  const current = item.name || `Item #${id}`;
  const name = await showDialog("Rename", "New name", current);
  if (!name) return;

  try {
    const { updateCollectionManifest } = await assetDeleteOps();
    if (isCollection(id)) {
      await updateCollectionManifest(
        item.tokenId,
        (col: any) => {
          col.name = name;
          return col;
        },
        { label: "rename collection" }
      );
      libraryState.set({
        collections: libraryState.get().collections.map((c) =>
          c.id === id ? { ...c, name } : c
        ),
      });
    } else {
      const asset = item as LibraryAssetItem;
      const { getFromRemoteIPFS } = await ipfsOps();
      const { writeJSONToIPFS } = await ipfsWriteOps();
      const manifest = await getFromRemoteIPFS(asset.manifestCid);
      const updated = { ...manifest, name };
      const newCid = await writeJSONToIPFS(updated, null, {
        type: "asset",
        assetId: asset.assetId,
      });
      await updateCollectionManifest(
        asset.tokenId,
        (col: any) => {
          col.assets = { ...col.assets };
          col.assets[asset.assetId] = newCid;
          return col;
        },
        { label: "rename asset" }
      );
      libraryState.set({
        assets: libraryState.get().assets.map((a) =>
          a.id === id ? { ...a, name, manifestCid: newCid } : a
        ),
      });
    }
    announce(`Renamed to ${name}`);
  } catch (err) {
    console.error("Rename failed:", err);
    showToast({
      type: "error",
      title: "Rename Failed",
      message: (err as Error).message || "Could not rename item.",
    });
  }
}

export async function requestDeleteSelected(ids: string[]): Promise<void> {
  const assets = ids
    .map((id) => libraryState.get().assets.find((a) => a.id === id))
    .filter((a) => a !== undefined);
  if (assets.length === 0) return;

  const { deleteAssetFromCollection } = await assetDeleteOps();
  for (const asset of assets) {
    try {
      const newCid = await deleteAssetFromCollection({
        tokenId: asset.tokenId,
        assetId: asset.assetId,
        assetName: asset.name,
      });
      // A null CID means the user cancelled the service-level confirmation dialog.
      if (newCid === null) return;
    } catch (err) {
      console.error("Delete asset failed:", err);
      showToast({
        type: "error",
        title: "Delete Failed",
        message: (err as Error).message || "Could not delete asset.",
      });
      return;
    }
  }

  const state = libraryState.get();
  libraryState.set({
    assets: state.assets.filter((a) => !ids.includes(a.id)),
    selectedIds: [],
  });
  announce(`${assets.length} asset${assets.length === 1 ? "" : "s"} deleted`);
}

export async function requestSendToCollection(assetId: string): Promise<void> {
  const asset = libraryState.get().assets.find((a) => a.id === assetId);
  if (!asset) return;

  const state = libraryState.get();
  const otherCollections = state.collections.filter(
    (c) => String(c.tokenId) !== String(asset.tokenId)
  );
  if (otherCollections.length === 0) {
    showToast({
      type: "warning",
      title: "No Target Collection",
      message: "Create or own another collection first.",
    });
    return;
  }

  const targetTokenId = await showTargetCollectionDialog(otherCollections);
  if (!targetTokenId) return;

  const mode = await showConfirmDialog(
    "Link Asset",
    `How would you like to include "${asset.name || asset.assetId}" in the target collection?`,
    [
      { text: "Fork (copy)", value: "fork", className: "btn btn-secondary" },
      { text: "Live reference", value: "live-ref", className: "btn btn-primary" },
    ]
  );
  if (!mode || (mode !== "fork" && mode !== "live-ref")) return;

  try {
    const { sendAssetToCollection } = await assetDeleteOps();
    await sendAssetToCollection({
      sourceTokenId: asset.tokenId,
      targetTokenId,
      assetId: asset.assetId,
      assetName: asset.name,
      mode,
    });

    // Refresh the current view
    const { refreshLibraryData } = await import("./library-controller.ts");
    await refreshLibraryData();
  } catch (err) {
    console.error("Send to collection failed:", err);
    showToast({
      type: "error",
      title: "Send Failed",
      message: (err as Error).message || "Could not send asset to collection.",
    });
  }
}

/**
 * @returns chosen collection tokenId, or null when cancelled
 */
export function showTargetCollectionDialog(
  collections: LibraryCollectionItem[]
): Promise<string | null> {
  return new Promise((resolve) => {
    import("./dialog.ts").then(() => {
      const options = collections
        .map(
          (c) =>
            `<option value="${escapeHtml(String(c.tokenId))}">${escapeHtml(
              c.name || `Collection #${c.tokenId}`
            )}</option>`
        )
        .join("");

      const dialogId = "target-collection-dialog-" + Date.now();
      const backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";

      const dialog = document.createElement("div");
      dialog.className = "dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", dialogId);
      dialog.innerHTML = `
        <div class="dialog-header"><h2 class="dialog-title" id="${dialogId}">Send to Collection</h2></div>
        <div class="dialog-body">
          <div class="form-group">
            <label class="form-label" for="targetCollectionSelect">Target collection</label>
            <select id="targetCollectionSelect" class="form-select">${options}</select>
          </div>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-secondary dialog-cancel-btn" type="button">Cancel</button>
          <button class="btn btn-primary dialog-confirm-btn" type="button">Continue</button>
        </div>
      `;

      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      let trap: any = null;
      let resolved = false;

      function close(value: string | null): void {
        if (resolved) return;
        resolved = true;
        document.removeEventListener("keydown", onKey);
        try {
          trap?.deactivate();
        } catch {}
        backdrop.remove();
        resolve(value);
      }

      function onKey(e: KeyboardEvent): void {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
        }
      }

      dialog.querySelector(".dialog-cancel-btn")?.addEventListener("click", () => close(null));
      dialog.querySelector(".dialog-confirm-btn")?.addEventListener("click", () => {
        const select = dialog.querySelector("#targetCollectionSelect") as HTMLSelectElement | null;
        close(select ? select.value : null);
      });
      document.addEventListener("keydown", onKey);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close(null);
      });

      const focusTrapLib = (window as any).focusTrap;
      if (focusTrapLib) {
        try {
          trap = focusTrapLib.createFocusTrap(dialog, {
            initialFocus: dialog.querySelector("#targetCollectionSelect"),
            escapeDeactivates: false,
            allowOutsideClick: true,
          });
          trap.activate();
        } catch {}
      }
    });
  });
}

function focusMenuItem(items: HTMLElement[], index: number): void {
  const wrapped = (index + items.length) % items.length;
  items[wrapped].focus();
}

export function openContextMenu(x: number, y: number, targetIds: string[]): void {
  closeContextMenu();

  const items =
    targetIds.length === 0
      ? emptySpaceMenuItems()
      : targetIds.length === 1
      ? singleItemMenuItems(targetIds)
      : multiSelectionMenuItems(targetIds);

  const menu = document.createElement("div");
  menuEl = menu;
  menu.className = "context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Library actions");
  menu.setAttribute("aria-orientation", "vertical");

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "context-menu-item" + (item.danger ? " context-menu-item-danger" : "");
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.label;
    if (item.disabled) btn.disabled = true;
    btn.addEventListener("click", () => {
      if (item.disabled) return;
      closeContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  });

  menu.addEventListener("keydown", (e) => {
    const buttons = [...menu.querySelectorAll(".context-menu-item")] as HTMLElement[];
    const currentIndex = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMenuItem(buttons, currentIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusMenuItem(buttons, currentIndex - 1);
    }
  });

  document.body.appendChild(menu);
  (menu.querySelector(".context-menu-item") as HTMLElement | null)?.focus();
}

export function initLibraryContextMenu(): void {
  const container = document.getElementById("libraryItems");

  container?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null;

    if (!el) {
      openContextMenu(e.clientX, e.clientY, []);
      return;
    }

    // `el` matched [data-id], so the attribute is present.
    const id = el.dataset.id as string;
    const state = libraryState.get();
    const ids = state.selectedIds.includes(id) ? state.selectedIds : [id];
    if (!state.selectedIds.includes(id)) libraryState.set({ selectedIds: ids });
    openContextMenu(e.clientX, e.clientY, ids as string[]);
  });

  document.addEventListener("click", (e) => {
    if (menuEl && !menuEl.contains(e.target as Node | null)) closeContextMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl) closeContextMenu();
  });
}

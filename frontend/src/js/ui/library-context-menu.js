import { libraryState } from "../state/library-state.js";
import { showConfirmDialog, showDialog } from "./dialog.js";
import { escapeHtml } from "../utils/html.js";
import { showToast } from "./toasts.js";
import { createNamedCollection } from "../services/library-ops.js";

// Blockchain/IPFS operations are loaded lazily so that unit tests for this
// module can run in jsdom without pulling in the full Studio dependency tree.
const assetLibraryOps = () => import("./asset-library.js");
const assetDeleteOps = () => import("../services/asset-delete.js");
const ipfsOps = () => import("../ipfs/remote-ipfs.js");
const ipfsWriteOps = () => import("../ipfs/write-to-ipfs.js");
const libraryInitOps = () => import("../library-init.js");

let menuEl = null;

export function closeContextMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function announce(text) {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}

function getItem(id) {
  const state = libraryState.get();
  return (
    state.collections.find((c) => c.id === id) ||
    state.assets.find((a) => a.id === id) ||
    null
  );
}

function isCollection(id) {
  return libraryState.get().collections.some((c) => c.id === id);
}

function singleItemMenuItems(ids) {
  const id = ids[0];
  if (isCollection(id)) {
    const collection = getItem(id);
    return [
      { label: "Open", action: () => openCollection(id) },
      {
        label: "Open in Studio",
        action: () => openAssetByTokenId(collection.tokenId),
      },
      { label: "Rename", action: () => requestRename(id) },
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

function multiSelectionMenuItems(ids) {
  return [
    { label: "Open first in Studio", action: () => openSelectedAssetInStudio(ids) },
    { label: "Delete", action: () => requestDeleteSelected(ids), danger: true },
  ];
}

function emptySpaceMenuItems() {
  return [
    { label: "New Collection", action: () => requestCreateCollection() },
    { label: "Upload File…", action: () => requestUploadFile() },
    { label: "Refresh", action: () => refreshLibrary() },
  ];
}

async function refreshLibrary() {
  const { refreshLibraryData } = await libraryInitOps();
  refreshLibraryData();
}

async function requestCreateCollection() {
  const name = await showDialog(
    "New Collection",
    "Choose a name for the new collection.",
    ""
  );
  if (!name) return;

  try {
    const { tokenId, isNew } = await createNamedCollection(name);
    const { refreshLibraryData } = await libraryInitOps();
    await refreshLibraryData();
    libraryState.set({
      currentCollectionTokenId: String(tokenId),
      selectedIds: [],
    });
    announce(isNew ? `Created collection ${name}` : `Opened collection ${name}`);
    showToast({
      type: "success",
      title: isNew ? "Collection Created" : "Collection Already Exists",
      message: isNew
        ? `"${name}" has been minted on-chain.`
        : `"${name}" already exists and was opened.`,
    });
  } catch (err) {
    console.error("[LIBRARY-CONTEXT-MENU] create collection failed:", err);
    showToast({
      type: "error",
      title: "Create Collection Failed",
      message: err.message || "Could not create the collection.",
    });
  }
}

function requestUploadFile() {
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

function openCollection(id) {
  const collection = libraryState.get().collections.find((c) => c.id === id);
  if (!collection) return;
  libraryState.set({
    currentCollectionTokenId: collection.tokenId,
    selectedIds: [],
  });
  announce(`Opened collection ${collection.name}`);
}

async function openSelectedAssetInStudio(ids) {
  if (!ids.length) return;
  const asset = libraryState.get().assets.find((a) => a.id === ids[0]);
  if (!asset) return;
  const { openInStudio } = await import("./library-grid.js");
  openInStudio(asset.tokenId, asset.assetId);
}

export async function requestRename(id) {
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
        (col) => {
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
      const { getFromRemoteIPFS } = await ipfsOps();
      const { writeJSONToIPFS } = await ipfsWriteOps();
      const manifest = await getFromRemoteIPFS(item.manifestCid);
      const updated = { ...manifest, name };
      const newCid = await writeJSONToIPFS(updated, null, {
        type: "asset",
        assetId: item.assetId,
      });
      await updateCollectionManifest(
        item.tokenId,
        (col) => {
          col.assets = { ...col.assets };
          col.assets[item.assetId] = newCid;
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
      message: err.message || "Could not rename item.",
    });
  }
}

export async function requestDeleteSelected(ids) {
  const assets = ids
    .map((id) => libraryState.get().assets.find((a) => a.id === id))
    .filter(Boolean);
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
        message: err.message || "Could not delete asset.",
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

export async function requestSendToCollection(assetId) {
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
    "Send Asset",
    `How would you like to send "${asset.name || asset.assetId}" to the target collection?`,
    [
      { text: "Move", value: "move", className: "btn btn-secondary" },
      { text: "Copy", value: "copy", className: "btn btn-primary" },
    ]
  );
  if (!mode || (mode !== "move" && mode !== "copy")) return;

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
    const { refreshLibraryData } = await import("../library-init.js");
    await refreshLibraryData();
  } catch (err) {
    console.error("Send to collection failed:", err);
    showToast({
      type: "error",
      title: "Send Failed",
      message: err.message || "Could not send asset to collection.",
    });
  }
}

function showTargetCollectionDialog(collections) {
  return new Promise((resolve) => {
    import("./dialog.js").then(({ showDialog }) => {
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

      let resolved = false;
      function close(value) {
        if (resolved) return;
        resolved = true;
        backdrop.remove();
        resolve(value);
      }

      dialog.querySelector(".dialog-cancel-btn")?.addEventListener("click", () => close(null));
      dialog.querySelector(".dialog-confirm-btn")?.addEventListener("click", () => {
        const select = dialog.querySelector("#targetCollectionSelect");
        close(select ? select.value : null);
      });
      document.addEventListener("keydown", function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          document.removeEventListener("keydown", onKey);
          close(null);
        }
      });
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close(null);
      });

      if (window.focusTrap) {
        try {
          const trap = window.focusTrap.createFocusTrap(dialog, {
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

function focusMenuItem(items, index) {
  const wrapped = (index + items.length) % items.length;
  items[wrapped].focus();
}

export function openContextMenu(x, y, targetIds) {
  closeContextMenu();

  const items =
    targetIds.length === 0
      ? emptySpaceMenuItems()
      : targetIds.length === 1
      ? singleItemMenuItems(targetIds)
      : multiSelectionMenuItems(targetIds);

  menuEl = document.createElement("div");
  menuEl.className = "context-menu";
  menuEl.style.left = `${x}px`;
  menuEl.style.top = `${y}px`;
  menuEl.setAttribute("role", "menu");

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
    menuEl.appendChild(btn);
  });

  menuEl.addEventListener("keydown", (e) => {
    const buttons = [...menuEl.querySelectorAll(".context-menu-item")];
    const currentIndex = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMenuItem(buttons, currentIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusMenuItem(buttons, currentIndex - 1);
    }
  });

  document.body.appendChild(menuEl);
  menuEl.querySelector(".context-menu-item")?.focus();
}

export function initLibraryContextMenu() {
  const container = document.getElementById("libraryItems");

  container?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = e.target.closest("[data-id]");

    if (!el) {
      openContextMenu(e.clientX, e.clientY, []);
      return;
    }

    const id = el.dataset.id;
    const state = libraryState.get();
    const ids = state.selectedIds.includes(id) ? state.selectedIds : [id];
    if (!state.selectedIds.includes(id)) libraryState.set({ selectedIds: ids });
    openContextMenu(e.clientX, e.clientY, ids);
  });

  document.addEventListener("click", (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuEl) closeContextMenu();
  });
}

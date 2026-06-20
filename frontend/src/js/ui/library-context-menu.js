import { libraryState } from "../state/library-state.js";
import { openInStudio, requestDelete, announce } from "./library-grid.js";
import { requestNewFolder } from "./library-toolbar.js";
import { showDialog } from "./dialog.js";
import { escapeHtml } from "../utils/html.js";

let menuEl = null;

export function closeContextMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
}

function isFolder(id) {
  return libraryState.get().folders.some((f) => f.id === id);
}

function singleItemMenuItems(ids) {
  const id = ids[0];
  if (isFolder(id)) {
    return [
      { label: "Besk it", action: () => requestBeskIt(ids) },
      {
        label: "Open",
        action: () =>
          libraryState.set({ currentFolderId: id, selectedIds: [] }),
      },
      { label: "Rename", action: () => requestRename(id) },
      { label: "Move to folder…", action: () => requestMoveToFolder(ids) },
      { label: "Delete", action: () => requestDelete(ids), danger: true },
    ];
  }
  return [
    { label: "Besk it", action: () => requestBeskIt(ids) },
    { label: "Open in Studio", action: () => openInStudio(id) },
    { label: "Rename", action: () => requestRename(id) },
    { label: "Move to folder…", action: () => requestMoveToFolder(ids) },
    { label: "Delete", action: () => requestDelete(ids), danger: true },
  ];
}

function multiSelectionMenuItems(ids) {
  return [
    { label: "Besk it", action: () => requestBeskIt(ids) },
    // openInStudio navigates via window.location.href, so only the first call
    // takes effect; the remaining ids are dead no-ops. This is a known limitation
    // — you can't open multiple files simultaneously from a single action.
    {
      label: "Open in Studio",
      action: () => ids.forEach((id) => openInStudio(id)),
    },
    { label: "Move to folder…", action: () => requestMoveToFolder(ids) },
    { label: "Delete", action: () => requestDelete(ids), danger: true },
  ];
}

function emptySpaceMenuItems() {
  return [
    { label: "New Folder", action: () => requestNewFolder() },
    {
      label: "Upload",
      action: () => document.getElementById("libraryFileInput")?.click(),
    },
    { label: "Paste", action: () => {}, disabled: true, dataAction: "paste" },
  ];
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
    if (item.dataAction) btn.dataset.action = item.dataAction;
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

export function requestRename(id) {
  const state = libraryState.get();
  const file = state.files.find((f) => f.id === id);
  const folder = state.folders.find((f) => f.id === id);
  const current = file ? file.name : folder.name;

  return showDialog("Rename", "New name", current).then((name) => {
    if (!name) return;
    if (file) {
      libraryState.set({
        files: state.files.map((f) => (f.id === id ? { ...f, name } : f)),
      });
    } else {
      libraryState.set({
        folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      });
    }
    announce(`Renamed to ${name}`);
  });
}

export function requestMoveToFolder(ids) {
  return new Promise((resolve) => {
    const state = libraryState.get();
    const dialogId = "move-dialog-title-" + Date.now();

    // Backdrop — click outside dismisses
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", dialogId);

    const folderButtons = state.folders
      .filter((f) => !ids.includes(f.id))
      .map(
        (f) =>
          `<button type="button" class="context-menu-item" data-move-target="${
            f.id
          }">${escapeHtml(f.name)}</button>`
      )
      .join("");

    dialog.innerHTML = `
      <div class="dialog-header"><h2 class="dialog-title" id="${dialogId}">Move to folder…</h2></div>
      <div class="dialog-body">
        <button type="button" class="context-menu-item" data-move-target="">Home</button>
        ${folderButtons}
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary dialog-cancel-btn" type="button">Cancel</button>
      </div>
    `;

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let resolved = false;
    let removeTrap = () => {};

    function dismiss() {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKey);
      removeTrap();
      backdrop.remove();
      resolve();
    }

    function moveTo(targetId) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKey);
      removeTrap();
      backdrop.remove();
      const next = libraryState.get();
      libraryState.set({
        files: next.files.map((f) =>
          ids.includes(f.id) ? { ...f, parentId: targetId } : f
        ),
        folders: next.folders.map((f) =>
          ids.includes(f.id) ? { ...f, parentId: targetId } : f
        ),
        selectedIds: [],
      });
      announce(`Moved ${ids.length} item${ids.length === 1 ? "" : "s"}`);
      resolve();
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    }

    document.addEventListener("keydown", onKey);

    // Click outside (on backdrop) dismisses
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) dismiss();
    });

    // Cancel button
    dialog
      .querySelector(".dialog-cancel-btn")
      ?.addEventListener("click", dismiss);

    // Folder target buttons
    dialog.querySelectorAll("[data-move-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.moveTarget || null;
        moveTo(targetId);
      });
    });

    // Focus trap
    if (window.focusTrap) {
      const firstBtn =
        dialog.querySelector("[data-move-target]") ||
        dialog.querySelector(".dialog-cancel-btn");
      try {
        const trap = window.focusTrap.createFocusTrap(dialog, {
          initialFocus: firstBtn,
          escapeDeactivates: false,
          allowOutsideClick: true,
        });
        trap.activate();
        removeTrap = () => trap.deactivate();
      } catch (_) {
        // focus-trap unavailable (e.g. test environment) — dialog still works
      }
    }
  });
}

export function requestBeskIt(ids) {
  const state = libraryState.get();
  libraryState.set({
    files: state.files.map((f) =>
      ids.includes(f.id) ? { ...f, status: "besked" } : f
    ),
    folders: state.folders.map((f) =>
      ids.includes(f.id) ? { ...f, status: "besked" } : f
    ),
  });
  announce(`${ids.length} item${ids.length === 1 ? "" : "s"} besked`);
  return Promise.resolve();
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

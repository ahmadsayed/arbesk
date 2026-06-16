/**
 * Arbesk Dialog Utility
 *
 * GNOME HIG-styled modal dialog that replaces browser prompt().
 * Uses the popover surface tokens, backdrop blur, and
 * keyboard-accessible focus trap (Escape to cancel, Enter to confirm).
 *
 * Usage:
 *   import { showDialog } from "./ui/dialog.js";
 *   const result = await showDialog("Name your asset", "Enter a name:", "My Asset");
 *   if (result === null) { /&#42; cancelled &#42;/ }
 */

import { escapeHtml } from "../utils/html.js";

// ── Shared infrastructure ────────────────────────────────────────────────────

function _trapFocus(dialog, initialFocusEl) {
  const trap = window.focusTrap.createFocusTrap(dialog, {
    initialFocus: initialFocusEl,
    escapeDeactivates: false, // Escape is handled by _buildDialog's global keydown
    allowOutsideClick: true,  // lets MetaMask overlays receive clicks without breaking the trap
  });
  trap.activate();
  return () => trap.deactivate();
}

/**
 * Builds the shared dialog scaffold: backdrop, dialog element with title,
 * resolved guard, closeDialog, backdrop-click-to-cancel, and global Escape.
 * Caller appends body/actions to `dialog`, calls _trapFocus, then passes the
 * returned removeTrap to setRemoveTrap.
 */
function _buildDialog(title, resolve) {
  const dialogId = "dialog-title-" + Date.now();

  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", dialogId);
  dialog.innerHTML = `<div class="dialog-header"><h2 class="dialog-title" id="${dialogId}">${escapeHtml(title)}</h2></div>`;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  let resolved = false;
  let removeTrap = () => {};

  function onGlobalKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog(null);
    }
  }

  function closeDialog(value) {
    if (resolved) return;
    resolved = true;
    document.removeEventListener("keydown", onGlobalKey);
    removeTrap();
    backdrop.remove();
    resolve(value);
  }

  document.addEventListener("keydown", onGlobalKey);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeDialog(null);
  });

  return {
    dialog,
    closeDialog,
    setRemoveTrap(fn) {
      removeTrap = fn;
    },
  };
}

// ── Public exports ───────────────────────────────────────────────────────────

/**
 * Create and show a GNOME HIG-styled dialog.
 *
 * @param {string} title    - Dialog heading
 * @param {string} body     - Instructional text above the input
 * @param {string} [defaultValue=""] - Pre-filled input value
 * @returns {Promise<string|null>} User input or null if cancelled
 */
export function showDialog(title, body, defaultValue = "") {
  return new Promise((resolve) => {
    try {
      const { dialog, closeDialog, setRemoveTrap } = _buildDialog(
        title,
        resolve
      );

      const bodyDiv = document.createElement("div");
      bodyDiv.className = "dialog-body";
      bodyDiv.innerHTML = `
        <p style="margin:0 0 var(--size-2)">${escapeHtml(body)}</p>
        <div class="form-group">
          <input type="text" class="form-input dialog-input" value="${escapeHtml(defaultValue)}" autocomplete="off">
        </div>`;

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "dialog-actions";
      actionsDiv.innerHTML = `
        <button class="btn btn-secondary dialog-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary dialog-confirm-btn" type="button">Confirm</button>`;

      dialog.appendChild(bodyDiv);
      dialog.appendChild(actionsDiv);

      const input = dialog.querySelector(".dialog-input");
      const cancelBtn = dialog.querySelector(".dialog-cancel-btn");
      const confirmBtn = dialog.querySelector(".dialog-confirm-btn");

      function confirm() {
        closeDialog(input.value.trim() || null);
      }

      cancelBtn.addEventListener("click", () => closeDialog(null));
      confirmBtn.addEventListener("click", confirm);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeDialog(null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          confirm();
        }
      });

      setRemoveTrap(_trapFocus(dialog, input));
    } catch (err) {
      console.error("[DIALOG] error creating dialog:", err);
      resolve(null);
    }
  });
}

/**
 * Show a confirmation-style dialog with custom buttons.
 *
 * Replaces the input prompt with one or more action buttons.
 *
 * @param {string} title
 * @param {string} body
 * @param {Array<{text: string, value: string, className?: string}>} [buttons=[]]
 * @returns {Promise<string|null>} The `value` of the clicked button, or null if cancelled.
 */
export function showConfirmDialog(title, body, buttons = []) {
  return new Promise((resolve) => {
    try {
      const { dialog, closeDialog, setRemoveTrap } = _buildDialog(
        title,
        resolve
      );

      const normalizedButtons = buttons.length
        ? buttons
        : [
            { text: "Cancel", value: "cancel" },
            { text: "Confirm", value: "confirm" },
          ];

      const bodyDiv = document.createElement("div");
      bodyDiv.className = "dialog-body";
      bodyDiv.innerHTML = `<p style="margin:0">${escapeHtml(body)}</p>`;

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "dialog-actions";
      actionsDiv.innerHTML = normalizedButtons
        .map((btn, idx) => {
          const cls =
            btn.className ||
            (idx === 0 ? "btn btn-secondary" : "btn btn-primary");
          return `<button class="${escapeHtml(cls)} dialog-action-btn" type="button" data-value="${escapeHtml(btn.value)}">${escapeHtml(btn.text)}</button>`;
        })
        .join("");

      dialog.appendChild(bodyDiv);
      dialog.appendChild(actionsDiv);

      dialog.querySelectorAll(".dialog-action-btn").forEach((btn) => {
        btn.addEventListener("click", () =>
          closeDialog(btn.dataset.value || null)
        );
      });

      const firstBtn = dialog.querySelector(".dialog-action-btn");
      setRemoveTrap(_trapFocus(dialog, firstBtn));
    } catch (err) {
      console.error("[DIALOG] error creating confirm dialog:", err);
      resolve(null);
    }
  });
}

/**
 * Show a read-only informational dialog with trusted internal HTML content.
 * Do NOT pass user-supplied strings as bodyHtml — use showConfirmDialog for that.
 *
 * @param {string} title
 * @param {string} bodyHtml  - Trusted HTML string (no user content)
 * @returns {Promise<void>}
 */
export function showInfoDialog(title, bodyHtml) {
  return new Promise((resolve) => {
    try {
      const { dialog, closeDialog, setRemoveTrap } = _buildDialog(title, resolve);

      const bodyDiv = document.createElement("div");
      bodyDiv.className = "dialog-body";
      bodyDiv.innerHTML = bodyHtml;

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "dialog-actions";
      actionsDiv.innerHTML = `<button class="btn btn-primary dialog-close-btn" type="button">Close</button>`;

      dialog.appendChild(bodyDiv);
      dialog.appendChild(actionsDiv);

      const closeBtn = dialog.querySelector(".dialog-close-btn");
      closeBtn.addEventListener("click", () => closeDialog(null));

      setRemoveTrap(_trapFocus(dialog, closeBtn));
    } catch (err) {
      console.error("[DIALOG] error creating info dialog:", err);
      resolve();
    }
  });
}


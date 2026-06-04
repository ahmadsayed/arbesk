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
      // ── Build DOM ───────────────────────────────────────────────────
      const backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";

      const dialog = document.createElement("div");
      dialog.className = "dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "dialog-title-" + Date.now());

      dialog.innerHTML = `
      <div class="dialog-header">
        <h2 class="dialog-title" id="dialog-title-${Date.now()}">${escapeHtml(
        title
      )}</h2>
      </div>
      <div class="dialog-body">
        <p style="margin:0 0 var(--size-2)">${escapeHtml(body)}</p>
        <div class="form-group">
          <input type="text" class="form-input dialog-input" value="${escapeHtml(
            defaultValue
          )}" autocomplete="off">
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary dialog-cancel-btn" type="button">Cancel</button>
        <button class="btn btn-primary dialog-confirm-btn" type="button">Confirm</button>
      </div>
    `;

      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      // ── Element references ──────────────────────────────────────────
      const input = dialog.querySelector(".dialog-input");
      const cancelBtn = dialog.querySelector(".dialog-cancel-btn");
      const confirmBtn = dialog.querySelector(".dialog-confirm-btn");

      // ── Focus ───────────────────────────────────────────────────────
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });

      // ── Helpers ─────────────────────────────────────────────────────
      let resolved = false;

      function cleanup() {
        document.removeEventListener("keydown", globalKey);
      }

      function closeDialog(value) {
        if (resolved) return;
        resolved = true;
        cleanup();
        backdrop.remove();
        resolve(value);
      }

      function confirm() {
        const value = input.value.trim();
        closeDialog(value || null);
      }

      // ── Event listeners ─────────────────────────────────────────────
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

      // Click backdrop to cancel
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeDialog(null);
      });

      // Global Escape (in case input loses focus)
      function globalKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeDialog(null);
        }
      }
      document.addEventListener("keydown", globalKey);
    } catch (err) {
      console.error("[DIALOG] error creating dialog:", err);
      resolve(null);
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

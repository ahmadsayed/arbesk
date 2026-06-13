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

      // ── Focus trap ──────────────────────────────────────────────────
      function trapFocus(dialog) {
        const focusable = dialog.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        function handleTab(e) {
          if (e.key !== "Tab") return;
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
        dialog.addEventListener("keydown", handleTab);

        // Pull focus back if MetaMask or other overlay steals it
        function handleFocusIn(e) {
          if (!dialog.contains(e.target)) {
            e.preventDefault();
            input.focus();
          }
        }
        document.addEventListener("focusin", handleFocusIn);

        return () => {
          dialog.removeEventListener("keydown", handleTab);
          document.removeEventListener("focusin", handleFocusIn);
        };
      }
      const removeTrap = trapFocus(dialog);

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

      // Override cleanup to remove focus trap
      const originalCleanup = cleanup;
      cleanup = function() {
        originalCleanup();
        removeTrap();
      };
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
      const backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";

      const dialog = document.createElement("div");
      dialog.className = "dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "dialog-title-" + Date.now());

      const buttonHtml = (buttons.length ? buttons : [
        { text: "Cancel", value: "cancel" },
        { text: "Confirm", value: "confirm" },
      ])
        .map((btn, idx) => {
          const className =
            btn.className ||
            (idx === 0 ? "btn btn-secondary" : "btn btn-primary");
          return `<button class="${escapeHtml(className)} dialog-action-btn" type="button" data-value="${escapeHtml(
            btn.value
          )}">${escapeHtml(btn.text)}</button>`;
        })
        .join("");

      dialog.innerHTML = `
      <div class="dialog-header">
        <h2 class="dialog-title" id="dialog-title-${Date.now()}">${escapeHtml(
          title
        )}</h2>
      </div>
      <div class="dialog-body">
        <p style="margin:0">${escapeHtml(body)}</p>
      </div>
      <div class="dialog-actions">
        ${buttonHtml}
      </div>
    `;

      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const actionBtns = dialog.querySelectorAll(".dialog-action-btn");
      const firstBtn = actionBtns[0];

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

      requestAnimationFrame(() => {
        firstBtn?.focus();
      });

      function trapFocus(dialog) {
        const focusable = dialog.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        function handleTab(e) {
          if (e.key !== "Tab") return;
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
        dialog.addEventListener("keydown", handleTab);

        function handleFocusIn(e) {
          if (!dialog.contains(e.target)) {
            e.preventDefault();
            first?.focus();
          }
        }
        document.addEventListener("focusin", handleFocusIn);

        return () => {
          dialog.removeEventListener("keydown", handleTab);
          document.removeEventListener("focusin", handleFocusIn);
        };
      }
      const removeTrap = trapFocus(dialog);

      actionBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          closeDialog(btn.dataset.value || null);
        });
      });

      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeDialog(null);
      });

      function globalKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeDialog(null);
        }
      }
      document.addEventListener("keydown", globalKey);

      const originalCleanup = cleanup;
      cleanup = function () {
        originalCleanup();
        removeTrap();
      };
    } catch (err) {
      console.error("[DIALOG] error creating confirm dialog:", err);
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

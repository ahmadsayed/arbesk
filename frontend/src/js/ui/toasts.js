/**
 * Arbesk Toast Notification System — Notyf wrapper
 *
 * Thin adapter over window.Notyf (loaded via CDN in studio.pug).
 * Preserves the same public API as the previous hand-rolled implementation.
 *
 * Usage:
 *   import { showToast, dismissToast, dismissAllToasts } from './ui/toasts.js';
 *   showToast({ type: 'error', title: 'Payment Failed', message: '...', duration: 0 });
 */

import { escapeHtml } from "../utils/html.js";

let _notyf = null;

function getNotyf() {
  if (!_notyf) {
    _notyf = new window.Notyf({
      duration: 6000,
      ripple: false,
      dismissible: true,
      position: { x: "right", y: "top" },
      types: [
        { type: "info",    background: "#3b82f6", icon: false, dismissible: true },
        { type: "warning", background: "#f59e0b", icon: false, dismissible: true },
        { type: "pending", background: "#6b7280", icon: false, dismissible: true },
      ],
    });
  }
  return _notyf;
}

let toastIdCounter = 0;
const activeToasts = new Map(); // id → Notyf notification reference

const MAX_TOASTS = 5;

/**
 * Show a toast notification.
 *
 * @param {Object} opts
 * @param {'info'|'success'|'warning'|'error'|'pending'} opts.type
 * @param {string} opts.title — Short heading (required)
 * @param {string} [opts.message] — Optional body text
 * @param {number} [opts.duration=6000] — ms until auto-dismiss. 0 = persist until manual close.
 * @param {Array<{label:string, onClick:Function}>} [opts.actions] — Inline action buttons
 * @returns {string} toastId
 */
export function showToast({ type = "info", title, message = "", duration = 6000, actions = [] }) {
  const notyf = getNotyf();

  // Enforce max visible toasts — evict oldest
  if (activeToasts.size >= MAX_TOASTS) {
    const oldestId = activeToasts.keys().next().value;
    dismissToast(oldestId);
  }

  const id = `toast-${++toastIdCounter}`;

  // Compose HTML content: bold title, optional message, optional action buttons
  const parts = [`<strong>${escapeHtml(title)}</strong>`];
  if (message) {
    parts.push(`<span>${escapeHtml(message)}</span>`);
  }
  if (actions.length) {
    const btns = actions
      .map((a, i) => `<button class="toast-action" data-action-index="${i}">${escapeHtml(a.label)}</button>`)
      .join("");
    parts.push(`<span class="toast-actions">${btns}</span>`);
  }

  const notification = notyf.open({ type, message: parts.join("<br>"), duration });

  // Wire action button click handlers via the synchronously-created toast element
  if (actions.length) {
    const toastEls = document.querySelectorAll(".notyf__toast");
    const toastEl = toastEls[toastEls.length - 1];
    if (toastEl) {
      toastEl.querySelectorAll(".toast-action").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.actionIndex);
          if (actions[idx]?.onClick) actions[idx].onClick();
          dismissToast(id);
        });
      });
    }
  }

  // Keep the map clean when Notyf auto-dismisses by timer
  notification.on("dismiss", () => activeToasts.delete(id));

  activeToasts.set(id, notification);
  return id;
}

/**
 * Dismiss a toast by ID.
 * @param {string} id
 */
export function dismissToast(id) {
  const notification = activeToasts.get(id);
  if (!notification) return;
  // Delete synchronously so callers (e.g. MAX_TOASTS eviction loop) see the
  // updated size immediately.
  activeToasts.delete(id);
  getNotyf().dismiss(notification);
}

/**
 * Dismiss all active toasts.
 */
export function dismissAllToasts() {
  for (const id of Array.from(activeToasts.keys())) {
    dismissToast(id);
  }
}

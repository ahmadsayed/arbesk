/**
 * Arbesk Toast Notification System
 *
 * Lightweight, accessible toast banners for transaction lifecycle
 * and general app notifications. No external dependencies.
 *
 * Usage:
 *   import { showToast, showTxToast, dismissToast } from './ui/toasts.js';
 *   showToast({ type: 'error', title: 'Payment Failed', message: '...', duration: 0 });
 *   showTxToast({ txHash: '0x...', title: 'Publishing Asset', status: 'confirmed' });
 */

let container = null;
let toastIdCounter = 0;
const activeToasts = new Map(); // id -> { element, timeoutId, startTime, duration }
const MAX_TOASTS = 5;

const ICONS = {
  info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  pending: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>`,
};

function getContainer() {
  if (!container) {
    container = document.getElementById("toastContainer");
  }
  return container;
}

/**
 * Show a toast notification.
 *
 * @param {Object} opts
 * @param {'info'|'success'|'warning'|'error'} opts.type
 * @param {string} opts.title — Short heading (required)
 * @param {string} [opts.message] — Optional body text
 * @param {number} [opts.duration=6000] — ms until auto-dismiss. 0 = persist until manual close.
 * @param {Array<{label:string, onClick:Function}>} [opts.actions] — Inline action buttons
 * @returns {string} toastId
 */
export function showToast({
  type = "info",
  title,
  message = "",
  duration = 6000,
  actions = [],
}) {
  const ctr = getContainer();
  if (!ctr) {
    console.warn("[TOAST] No #toastContainer found in DOM");
    return null;
  }

  // Enforce max toasts — remove oldest
  while (activeToasts.size >= MAX_TOASTS) {
    const oldestId = activeToasts.keys().next().value;
    dismissToast(oldestId);
  }

  const id = `toast-${++toastIdCounter}`;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.id = id;
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");

  // Icon
  const iconHtml = ICONS[type] || ICONS.info;

  // Actions HTML
  const actionsHtml = actions
    .map(
      (a, i) =>
        `<button class="toast-action" data-action-index="${i}">${escapeHtml(a.label)}</button>`
    )
    .join("");

  toast.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ""}
      ${actionsHtml ? `<div class="toast-actions">${actionsHtml}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Dismiss notification">×</button>
    ${duration > 0 ? `<div class="toast-progress"><div class="toast-progress-bar"></div></div>` : ""}
  `;

  ctr.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add("toast-in");
  });

  // Wire close button
  const closeBtn = toast.querySelector(".toast-close");
  closeBtn.addEventListener("click", () => dismissToast(id));

  // Wire actions
  if (actions.length) {
    toast.querySelectorAll(".toast-action").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.target.dataset.actionIndex);
        if (actions[idx]?.onClick) {
          actions[idx].onClick();
        }
        dismissToast(id);
      });
    });
  }

  // Hover pause logic
  let timeoutId = null;
  let remaining = duration;
  let startTime = Date.now();

  function startTimer() {
    if (duration <= 0) return;
    startTime = Date.now();
    const progressBar = toast.querySelector(".toast-progress-bar");
    if (progressBar) {
      progressBar.style.transition = `width ${remaining}ms linear`;
      requestAnimationFrame(() => {
        progressBar.style.width = "0%";
      });
    }
    timeoutId = setTimeout(() => dismissToast(id), remaining);
  }

  function pauseTimer() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      remaining -= Date.now() - startTime;
      const progressBar = toast.querySelector(".toast-progress-bar");
      if (progressBar) {
        progressBar.style.transition = "none";
        const pct = Math.max(0, (remaining / duration) * 100);
        progressBar.style.width = `${pct}%`;
      }
    }
  }

  toast.addEventListener("mouseenter", pauseTimer);
  toast.addEventListener("mouseleave", startTimer);
  toast.addEventListener("focusin", pauseTimer);
  toast.addEventListener("focusout", startTimer);

  activeToasts.set(id, { element: toast, timeoutId, startTimer, pauseTimer });

  // Kick off timer
  startTimer();

  return id;
}

/**
 * Show a transaction-specific toast.
 *
 * @param {Object} opts
 * @param {string} opts.txHash
 * @param {string} opts.title
 * @param {'pending'|'submitting'|'confirmed'|'failed'} opts.status
 * @param {string} [opts.error] — Error message for failed status
 * @param {Function} [opts.onRetry] — Retry callback for failed status
 * @returns {string|null} toastId
 */
export async function showTxToast({ txHash, title, status, error, onRetry }) {
  const chainId = Number(window.chainId || 0);
  let explorerUrl = null;

  // Build explorer link if available
  if (txHash && chainId) {
    const { getTxExplorerUrl } = await import("../blockchain/explorer.js");
    explorerUrl = getTxExplorerUrl(chainId, txHash);
  }

  const typeMap = {
    pending: "info",
    submitting: "info",
    confirmed: "success",
    failed: "error",
  };

  const type = typeMap[status] || "info";

  let message = "";
  const actions = [];

  switch (status) {
    case "pending":
      message = "Confirm this transaction in your wallet.";
      break;
    case "submitting":
      message = txHash
        ? `Submitted. Waiting for block confirmation…`
        : "Submitting to the network…";
      break;
    case "confirmed":
      message = txHash ? `Transaction confirmed.` : "Operation completed.";
      if (explorerUrl) {
        actions.push({
          label: "View on Explorer",
          onClick: () => window.open(explorerUrl, "_blank", "noopener,noreferrer"),
        });
      }
      break;
    case "failed":
      message = error || "Transaction failed.";
      if (onRetry) {
        actions.push({
          label: "Retry",
          onClick: onRetry,
        });
      }
      break;
  }

  const duration = status === "failed" || status === "pending" ? 0 : 8000;

  return showToast({ type, title, message, duration, actions });
}

/**
 * Dismiss a toast by ID.
 * @param {string} id
 */
export function dismissToast(id) {
  const entry = activeToasts.get(id);
  if (!entry) return;

  const { element, timeoutId } = entry;
  if (timeoutId) clearTimeout(timeoutId);

  element.classList.remove("toast-in");
  element.classList.add("toast-out");

  // Remove from DOM after animation
  element.addEventListener(
    "transitionend",
    () => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
      activeToasts.delete(id);
    },
    { once: true }
  );

  // Fallback removal if transition doesn't fire
  setTimeout(() => {
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
    activeToasts.delete(id);
  }, 400);
}

/**
 * Dismiss all active toasts.
 */
export function dismissAllToasts() {
  for (const id of Array.from(activeToasts.keys())) {
    dismissToast(id);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

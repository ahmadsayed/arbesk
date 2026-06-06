/**
 * Wallet Picker Modal
 *
 * GNOME HIG-styled modal that lists discovered EIP-6963 wallets.
 * Uses the existing dialog backdrop pattern and implements focus trapping.
 *
 * Usage:
 *   import { showWalletModal, hideWalletModal } from './ui/wallet-modal.js';
 *   showWalletModal({ onSelect: (provider, source) => { ... } });
 */

import {
  requestWallets,
  onWalletsUpdated,
  getWallets,
} from "../blockchain/wallet-discovery.js";

let backdrop = null;
let modal = null;
let resolvePromise = null;
let rejectPromise = null;
let removeWalletListener = null;
let focusTrapCleanup = null;

/**
 * Show the wallet picker modal.
 * @returns {Promise<{provider: Object, source: string, walletName?: string}>}
 *   Resolves when user selects a wallet.
 *   Rejects when user cancels (Escape, backdrop click, close button).
 */
export function showWalletModal() {
  return new Promise((resolve, reject) => {
    if (backdrop) {
      hideWalletModal();
    }

    resolvePromise = resolve;
    rejectPromise = reject;

    // Request fresh wallet discovery
    requestWallets();

    // Build modal DOM
    backdrop = document.createElement("div");
    backdrop.className = "wallet-modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "wallet-modal-title");

    modal = document.createElement("div");
    modal.className = "wallet-modal";
    modal.innerHTML = `
      <div class="wallet-modal-header">
        <h3 id="wallet-modal-title">Connect Wallet</h3>
        <button class="btn btn-icon btn-sm wallet-modal-close" aria-label="Close" title="Close (Escape)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="wallet-modal-body">
        <p class="wallet-modal-subtitle">Select a wallet to connect to Arbesk Studio.</p>
        <div class="wallet-options-list" id="walletOptionsList">
          <div class="wallet-modal-empty">Detecting wallets…</div>
        </div>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Focus trap
    focusTrapCleanup = setupFocusTrap(modal);

    // Wire close handlers
    const closeBtn = modal.querySelector(".wallet-modal-close");
    closeBtn.addEventListener("click", () => cancelModal());
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cancelModal();
    });

    // Wire Escape key
    document.addEventListener("keydown", handleKeydown);

    // Subscribe to wallet discovery updates
    removeWalletListener = onWalletsUpdated((wallets) => {
      renderWalletOptions(wallets);
    });

    // Initial render
    renderWalletOptions(getWallets());

    // Focus first option
    requestAnimationFrame(() => {
      const firstOption = modal.querySelector(".wallet-option");
      if (firstOption) firstOption.focus();
    });
  });
}

/**
 * Hide the wallet modal and clean up.
 */
export function hideWalletModal() {
  if (focusTrapCleanup) {
    focusTrapCleanup();
    focusTrapCleanup = null;
  }
  if (removeWalletListener) {
    removeWalletListener();
    removeWalletListener = null;
  }
  document.removeEventListener("keydown", handleKeydown);

  if (backdrop) {
    backdrop.remove();
    backdrop = null;
    modal = null;
  }

  resolvePromise = null;
  rejectPromise = null;
}

/**
 * Cancel the modal (user dismissed without selection).
 */
function cancelModal() {
  if (rejectPromise) {
    rejectPromise(new Error("User cancelled wallet selection"));
  }
  hideWalletModal();
}

/**
 * Handle keyboard events (Escape to cancel).
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    cancelModal();
  }
}

/**
 * Render the list of discovered wallet options.
 * @param {EIP6963Wallet[]} wallets
 */
function renderWalletOptions(wallets) {
  const list = modal?.querySelector("#walletOptionsList");
  if (!list) return;

  if (wallets.length === 0) {
    list.innerHTML = `<div class="wallet-modal-empty">No injected wallets detected. Install MetaMask, Rabby, or another EIP-6963 compatible wallet.</div>`;
    return;
  }

  list.innerHTML = "";
  wallets.forEach((wallet) => {
    const btn = document.createElement("button");
    btn.className = "wallet-option";
    btn.setAttribute("aria-label", `Connect with ${wallet.name}`);
    btn.dataset.rdns = wallet.rdns;

    const iconHtml = wallet.icon
      ? `<img src="${wallet.icon}" alt="" aria-hidden="true">`
      : `<div class="wallet-option-icon-placeholder">${(
          wallet.name || "W"
        ).charAt(0)}</div>`;

    btn.innerHTML = `${iconHtml}<span>${escapeHtml(wallet.name)}</span>`;
    btn.addEventListener("click", () => selectInjectedWallet(wallet));
    list.appendChild(btn);
  });
}

/**
 * User selected an injected wallet.
 * @param {EIP6963Wallet} wallet
 */
function selectInjectedWallet(wallet) {
  if (!resolvePromise) return;

  resolvePromise({
    provider: wallet.provider,
    source: "injected",
    walletName: wallet.name,
    walletRdns: wallet.rdns,
  });
  hideWalletModal();
}

/**
 * Setup focus trap within the modal.
 * @param {HTMLElement} container
 * @returns {Function} cleanup function
 */
function setupFocusTrap(container) {
  const focusable = container.querySelectorAll(
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

  container.addEventListener("keydown", handleTab);

  // Pull focus back if it leaves the modal
  function handleFocusIn(e) {
    if (!container.contains(e.target)) {
      e.preventDefault();
      first?.focus();
    }
  }
  document.addEventListener("focusin", handleFocusIn);

  return () => {
    container.removeEventListener("keydown", handleTab);
    document.removeEventListener("focusin", handleFocusIn);
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

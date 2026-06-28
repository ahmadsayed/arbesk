// @ts-nocheck
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
import { escapeHtml } from "../utils/html.js";

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
        <div class="wallet-modal-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <button class="wallet-option wallet-option-google" id="walletGoogleBtn" type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>Sign in with Google</span>
        </button>
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

    // Wire Google sign-in
    const googleBtn = modal.querySelector("#walletGoogleBtn");
    if (googleBtn) {
      googleBtn.addEventListener("click", () => selectGoogleWallet());
    }

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
 * User selected Google sign-in.
 */
async function selectGoogleWallet() {
  if (!resolvePromise) return;

  try {
    const [{ getConfig }, { initThirdwebClient, connectGoogleWallet }] =
      await Promise.all([
        import("../services/api.js"),
        import("../blockchain/wallet-thirdweb.js"),
      ]);

    const config = await getConfig();
    if (!config?.thirdwebClientId) {
      throw new Error("Thirdweb Client ID is not configured.");
    }

    initThirdwebClient(config.thirdwebClientId);
    const { eoaAddress, smartAccountAddress, provider } =
      await connectGoogleWallet();

    resolvePromise({
      provider,
      source: "thirdweb",
      walletAddress: smartAccountAddress,
      eoaAddress,
    });
    hideWalletModal();
  } catch (err) {
    console.error("[WALLET-MODAL] Google sign-in failed:", err);
    const list = modal?.querySelector("#walletOptionsList");
    if (list) {
      list.innerHTML = `<div class="wallet-modal-empty">Google sign-in failed: ${escapeHtml(
        err.message || "Unknown error"
      )}</div>`;
    }
  }
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


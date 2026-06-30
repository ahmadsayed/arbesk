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
        <h3 id="wallet-modal-title">Sign in to Arbesk Studio</h3>
        <button class="btn btn-icon btn-sm wallet-modal-close" aria-label="Close" title="Close (Escape)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="wallet-modal-body">
        <p class="wallet-modal-subtitle">Choose how you want to sign in or create an account.</p>
        <div id="walletEmailSection">
          <p class="wallet-modal-section-label">Email (gasless, Base Sepolia)</p>
          <div id="walletEmailStep" class="wallet-email-step">
            <div class="wallet-email-row">
              <input
                id="walletEmailInput"
                type="email"
                class="wallet-email-input"
                placeholder="you@example.com"
                autocomplete="email"
                aria-label="Email address"
              />
              <button id="walletEmailSendBtn" class="btn btn-primary btn-sm" type="button">
                Send code
              </button>
            </div>
            <div id="walletEmailError" class="wallet-email-error" role="alert" aria-live="polite"></div>
          </div>
          <div id="walletOtpStep" class="wallet-email-step" style="display:none">
            <div class="wallet-email-row">
              <input
                id="walletOtpInput"
                type="text"
                class="wallet-email-input"
                placeholder="6-digit code"
                autocomplete="one-time-code"
                inputmode="numeric"
                maxlength="6"
                aria-label="One-time code"
              />
              <button id="walletOtpVerifyBtn" class="btn btn-primary btn-sm" type="button">
                Verify
              </button>
            </div>
            <div id="walletOtpError" class="wallet-email-error" role="alert" aria-live="polite"></div>
            <button id="walletOtpBackBtn" class="btn btn-link btn-sm wallet-otp-back" type="button">
              &larr; Use a different email
            </button>
          </div>
          <div class="wallet-modal-divider" aria-hidden="true">
            <span>or</span>
          </div>
        </div>
        <p class="wallet-modal-section-label">Web3 wallet</p>
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

    // Wire email OTP flow
    const emailSendBtn = modal.querySelector("#walletEmailSendBtn");
    if (emailSendBtn) {
      emailSendBtn.addEventListener("click", () => selectEmailWallet());
    }
    const emailInput = modal.querySelector("#walletEmailInput");
    if (emailInput) {
      emailInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") selectEmailWallet();
      });
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
 * User clicked "Send code" — start the CDP email OTP flow.
 * Shows the OTP input step and wires the Verify button.
 */
async function selectEmailWallet() {
  if (!resolvePromise) return;

  const emailInput = modal.querySelector("#walletEmailInput");
  const emailError = modal.querySelector("#walletEmailError");
  const sendBtn = modal.querySelector("#walletEmailSendBtn");
  const emailStep = modal.querySelector("#walletEmailStep");
  const otpStep = modal.querySelector("#walletOtpStep");

  const email = emailInput ? emailInput.value.trim() : "";
  if (!email || !email.includes("@")) {
    if (emailError) emailError.textContent = "Please enter a valid email address.";
    if (emailInput) emailInput.focus();
    return;
  }
  if (emailError) emailError.textContent = "";

  // Disable button and show loading state
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
  }

  try {
    // Init CDP client (lazy — get project ID from cached config)
    const { getConfig } = await import("../services/api.js");
    const config = await getConfig();
    if (!config?.cdpProjectId) {
      if (emailError) emailError.textContent = "Email sign-in is not configured. Contact support.";
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send code"; }
      return;
    }

    const { initCdpClient, requestEmailOtp, verifyEmailOtp, autoConnectCdpWallet } = await import("../blockchain/wallet-cdp.js");
    await initCdpClient(config.cdpProjectId);

    const { flowId } = await requestEmailOtp(email);

    // Transition to OTP step
    if (emailStep) emailStep.style.display = "none";
    if (otpStep) otpStep.style.display = "";

    // Wire OTP verify button
    const otpVerifyBtn = modal.querySelector("#walletOtpVerifyBtn");
    const otpInput = modal.querySelector("#walletOtpInput");
    const otpError = modal.querySelector("#walletOtpError");
    const otpBackBtn = modal.querySelector("#walletOtpBackBtn");

    if (otpInput) {
      requestAnimationFrame(() => otpInput.focus());
    }

    // Back button — return to email step
    if (otpBackBtn) {
      otpBackBtn.addEventListener("click", () => {
        if (otpStep) otpStep.style.display = "none";
        if (emailStep) emailStep.style.display = "";
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send code"; }
        if (emailInput) emailInput.focus();
      });
    }

    async function handleVerify() {
      const otp = otpInput ? otpInput.value.trim() : "";
      if (!otp) {
        if (otpError) otpError.textContent = "Please enter the code from your email.";
        return;
      }
      if (otpError) otpError.textContent = "";
      if (otpVerifyBtn) { otpVerifyBtn.disabled = true; otpVerifyBtn.textContent = "Verifying…"; }

      try {
        await verifyEmailOtp(flowId, otp);
        // verifyEmailOtp sets module-level state; autoConnectCdpWallet reads it
        // and returns the provider without a network round-trip.
        const cdpResult = await autoConnectCdpWallet();
        if (!cdpResult) {
          throw new Error("Could not restore CDP session after OTP verification.");
        }

        if (!resolvePromise) return;
        resolvePromise({
          provider: cdpResult.provider,
          source: "cdp",
          walletAddress: cdpResult.smartAccountAddress,
          eoaAddress: cdpResult.eoaAddress,
        });
        hideWalletModal();
      } catch (err) {
        const msg = err.message || "Verification failed. Check your code and try again.";
        if (otpError) otpError.textContent = msg;
        if (otpVerifyBtn) { otpVerifyBtn.disabled = false; otpVerifyBtn.textContent = "Verify"; }
      }
    }

    if (otpVerifyBtn) {
      otpVerifyBtn.addEventListener("click", handleVerify);
    }
    if (otpInput) {
      otpInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleVerify();
      });
    }

  } catch (err) {
    const msg = err.message || "Failed to send code. Please try again.";
    if (emailError) emailError.textContent = msg;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send code"; }
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


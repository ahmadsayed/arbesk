/**
 * Wallet Picker Modal
 *
 * GNOME HIG-styled modal that lists discovered EIP-6963 wallets.
 * Uses the existing dialog backdrop pattern and implements focus trapping.
 *
 * Usage:
 *   import { showWalletModal, hideWalletModal } from './ui/wallet-modal.ts';
 *   showWalletModal({ onSelect: (provider, source) => { ... } });
 */

import {
  requestWallets,
  onWalletsUpdated,
  getWallets,
} from "../blockchain/wallet-discovery.ts";
import type { EIP6963Wallet } from "../blockchain/wallet-discovery.ts";
import { escapeHtml } from "../utils/html.ts";

/**
 * Result the modal promise resolves with. Injected wallets set
 * walletName/walletRdns; the CDP email flow sets walletAddress/eoaAddress/email.
 */
export interface WalletModalResult {
  /** EIP-1193 provider (or CDP SDK provider object) */
  provider: any;
  /** "injected" | "cdp" */
  source: string;
  walletName?: string;
  walletRdns?: string;
  /** CDP smart account address */
  walletAddress?: string;
  /** CDP embedded EOA address */
  eoaAddress?: string;
  /** CDP sign-in email */
  email?: string;
}

let backdrop: HTMLElement | null = null;
let modal: HTMLElement | null = null;
let resolvePromise: ((result: WalletModalResult) => void) | null = null;
let rejectPromise: ((err: Error) => void) | null = null;
/** unsubscribe from wallet-discovery */
let removeWalletListener: (() => void) | null = null;
let focusTrapCleanup: (() => void) | null = null;

/**
 * Show the wallet picker modal.
 * @returns
 *   Resolves when user selects a wallet.
 *   Rejects when user cancels (Escape, backdrop click, close button).
 */
export function showWalletModal(): Promise<WalletModalResult> {
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
    // Local alias: the module-level `modal` is captured by closures below,
    // which defeats TS narrowing; modalEl stays non-null for this executor.
    const modalEl = modal;
    modalEl.className = "wallet-modal";
    modalEl.innerHTML = `
      <div class="wallet-modal-header">
        <h3 id="wallet-modal-title">Sign in to Arbesk</h3>
        <button class="btn btn-icon btn-sm wallet-modal-close" aria-label="Close" title="Close (Escape)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="wallet-modal-body">
        <p class="wallet-modal-subtitle">Choose how you want to sign in or create an account.</p>

        <div class="wallet-section">
          <p class="wallet-modal-section-label">Email — free, no wallet needed</p>
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
              <button id="walletEmailSendBtn" class="btn btn-primary" type="button">
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
              <button id="walletOtpVerifyBtn" class="btn btn-primary" type="button">
                Verify
              </button>
            </div>
            <div id="walletOtpError" class="wallet-email-error" role="alert" aria-live="polite"></div>
            <button id="walletOtpBackBtn" class="btn btn-link btn-sm wallet-otp-back" type="button">
              Use a different email
            </button>
          </div>
        </div>

        <div class="wallet-modal-divider" aria-hidden="true">
          <span>or</span>
        </div>

        <div class="wallet-section">
          <p class="wallet-modal-section-label">Web3 wallet</p>
          <div class="wallet-options-list" id="walletOptionsList">
            <div class="wallet-modal-empty">Detecting wallets…</div>
          </div>
        </div>
      </div>
    `;

    backdrop.appendChild(modalEl);
    document.body.appendChild(backdrop);

    // Focus trap
    focusTrapCleanup = setupFocusTrap(modalEl);

    // Wire close handlers — the close button is part of the innerHTML above.
    const closeBtn = modalEl.querySelector(
      ".wallet-modal-close"
    ) as HTMLElement;
    closeBtn.addEventListener("click", () => cancelModal());
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cancelModal();
    });

    // Wire email OTP flow
    const emailSendBtn = modalEl.querySelector("#walletEmailSendBtn");
    if (emailSendBtn) {
      emailSendBtn.addEventListener("click", () => selectEmailWallet());
    }
    const emailInput = modalEl.querySelector("#walletEmailInput");
    if (emailInput) {
      emailInput.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter")
          selectEmailWallet();
      });
    }

    // Wire Escape key
    document.addEventListener("keydown", handleKeydown);

    // Subscribe to wallet discovery updates
    removeWalletListener = onWalletsUpdated(
      (wallets: EIP6963Wallet[]) => {
        renderWalletOptions(wallets);
      }
    );

    // Initial render
    renderWalletOptions(getWallets());

    // Focus first option
    requestAnimationFrame(() => {
      const firstOption = modalEl.querySelector(
        ".wallet-option"
      ) as HTMLElement | null;
      if (firstOption) firstOption.focus();
    });
  });
}

/**
 * Hide the wallet modal and clean up.
 */
export function hideWalletModal(): void {
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
function cancelModal(): void {
  if (rejectPromise) {
    rejectPromise(new Error("User cancelled wallet selection"));
  }
  hideWalletModal();
}

/**
 * Handle keyboard events (Escape to cancel).
 */
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    cancelModal();
  }
}

/**
 * Render the list of discovered wallet options.
 */
function renderWalletOptions(wallets: EIP6963Wallet[]): void {
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
 */
function selectInjectedWallet(wallet: EIP6963Wallet): void {
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
async function selectEmailWallet(): Promise<void> {
  if (!resolvePromise) return;
  // Non-null: this flow is only reachable from buttons inside the open modal.
  const modalEl = modal as HTMLElement;

  const emailInput = modalEl.querySelector(
    "#walletEmailInput"
  ) as HTMLInputElement | null;
  const emailError = modalEl.querySelector("#walletEmailError");
  const sendBtn = modalEl.querySelector(
    "#walletEmailSendBtn"
  ) as HTMLButtonElement | null;
  const emailStep = modalEl.querySelector(
    "#walletEmailStep"
  ) as HTMLElement | null;
  const otpStep = modalEl.querySelector(
    "#walletOtpStep"
  ) as HTMLElement | null;

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
    const { getConfig } = await import("../services/api.ts");
    const config = await getConfig();
    if (!config?.cdpProjectId) {
      if (emailError) emailError.textContent = "Email sign-in is not configured. Contact support.";
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send code"; }
      return;
    }

    const { initCdpClient, requestEmailOtp, verifyEmailOtp, autoConnectCdpWallet, resetCdpStorage } = await import("../blockchain/wallet-cdp.ts");

    // Initialize the SDK first so that signOut (and any other session calls)
    // actually reach CDP's servers.
    await initCdpClient(config.cdpProjectId);

    // Clear stale CDP browser state before starting a fresh login flow.
    // The SDK stores session data under coinbase/cdp keys across localStorage,
    // IndexedDB, and cookies; stale state causes "User is already authenticated"
    // or "EVM account not found" errors. Always reset — a first-time visitor has
    // nothing to clean up, and the cleanup is best-effort.
    await resetCdpStorage();

    const { flowId } = await requestEmailOtp(email);

    // Transition to OTP step
    if (emailStep) emailStep.style.display = "none";
    if (otpStep) otpStep.style.display = "";

    // Wire OTP verify button
    const otpVerifyBtn = modalEl.querySelector(
      "#walletOtpVerifyBtn"
    ) as HTMLButtonElement | null;
    const otpInput = modalEl.querySelector(
      "#walletOtpInput"
    ) as HTMLInputElement | null;
    const otpError = modalEl.querySelector("#walletOtpError");
    const otpBackBtn = modalEl.querySelector(
      "#walletOtpBackBtn"
    ) as HTMLElement | null;

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
      }, { once: true });
    }

    async function handleVerify(): Promise<void> {
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
          email,
        });
        hideWalletModal();
      } catch (err) {
        const msg =
          (err as Error).message ||
          "Verification failed. Check your code and try again.";
        if (otpError) otpError.textContent = msg;
        if (otpVerifyBtn) { otpVerifyBtn.disabled = false; otpVerifyBtn.textContent = "Verify"; }
      }
    }

    if (otpVerifyBtn) {
      otpVerifyBtn.addEventListener("click", handleVerify, { once: true });
    }
    if (otpInput) {
      otpInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleVerify();
      });
    }

  } catch (err) {
    const msg =
      (err as Error).message || "Failed to send code. Please try again.";
    if (emailError) emailError.textContent = msg;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "Send code"; }
  }
}

/**
 * Setup focus trap within the modal.
 * @returns cleanup function
 */
function setupFocusTrap(container: HTMLElement): () => void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function handleTab(e: KeyboardEvent): void {
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
  function handleFocusIn(e: FocusEvent): void {
    if (!container.contains(e.target as Node)) {
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

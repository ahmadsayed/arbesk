/**
 * Arbesk Wallet Popover
 *
 * GNOME HIG-compliant dropdown for the connected wallet button.
 * Shows: address (with copy), explorer link, disconnect action.
 * Network switching lives in the headerbar — not duplicated here.
 */

import {
  getAddressExplorerUrl,
  copyToClipboard,
} from "../blockchain/explorer.js";
import { disconnectWallet } from "../blockchain/wallet.js";
import { getCachedSession } from "../services/api.js";

let popover = null;
let isOpen = false;

// ─── DOM refs (lazy) ─────────────────────────────────────────────────

function getElements() {
  return {
    popover: document.getElementById("walletPopover"),
    address: document.getElementById("walletPopoverAddress"),
    copyBtn: document.getElementById("walletPopoverCopy"),
    explorerLink: document.getElementById("walletPopoverExplorer"),
    signInBtn: document.getElementById("walletPopoverSignIn"),
    disconnectBtn: document.getElementById("walletPopoverDisconnect"),
    walletBtn: document.getElementById("disconnectWalletBtn"),
  };
}

// ─── Open / Close ────────────────────────────────────────────────────

function openPopover() {
  const els = getElements();
  if (!els.popover || !els.walletBtn) return;

  updateContent();

  // Make visible first so getBoundingClientRect returns real dimensions
  els.popover.classList.remove("hidden");
  isOpen = true;

  positionPopover();

  // Focus the first actionable element
  requestAnimationFrame(() => {
    els.copyBtn?.focus();
  });

  // Click-outside and Escape listeners
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKey);
}

function closePopover() {
  const els = getElements();
  if (!els.popover) return;

  els.popover.classList.add("hidden");
  isOpen = false;

  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKey);
}

function togglePopover() {
  if (isOpen) closePopover();
  else openPopover();
}

// ─── Positioning ─────────────────────────────────────────────────────

function positionPopover() {
  const els = getElements();
  if (!els.popover || !els.walletBtn) return;

  const btnRect = els.walletBtn.getBoundingClientRect();
  const popoverRect = els.popover.getBoundingClientRect();

  // Align right edge of popover with right edge of button
  let left = btnRect.right - popoverRect.width;
  let top = btnRect.bottom + 8;

  // Prevent clipping off the right edge of the viewport
  if (left + popoverRect.width > window.innerWidth - 16) {
    left = window.innerWidth - popoverRect.width - 16;
  }
  // Prevent clipping off the bottom
  if (top + popoverRect.height > window.innerHeight - 16) {
    top = btnRect.top - popoverRect.height - 8;
  }

  els.popover.style.left = `${Math.max(16, left)}px`;
  els.popover.style.top = `${top}px`;
}

// ─── Content Update ──────────────────────────────────────────────────

function updateContent() {
  const els = getElements();
  const address = window.walletAddress || "";
  const chainId = Number(window.chainId || 0);

  // Address with truncation
  if (els.address) {
    els.address.textContent = address
      ? `${address.slice(0, 6)}…${address.slice(-4)}`
      : "—";
    els.address.title = address;
  }

  // Copy button state reset
  if (els.copyBtn) {
    els.copyBtn.textContent = "Copy";
    els.copyBtn.classList.remove("copied");
  }

  // Explorer link
  if (els.explorerLink) {
    const url = getAddressExplorerUrl(chainId, address);
    if (url) {
      els.explorerLink.href = url;
      els.explorerLink.classList.remove("hidden");
    } else {
      els.explorerLink.classList.add("hidden");
    }
  }

  // Sign In button visibility
  if (els.signInBtn) {
    const cached = getCachedSession();
    const isAuth = cached && cached.address === address.toLowerCase();
    if (address && !isAuth) {
      els.signInBtn.classList.remove("hidden");
    } else {
      els.signInBtn.classList.add("hidden");
    }
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────

async function onCopy() {
  const els = getElements();
  if (!els.copyBtn || !window.walletAddress) return;

  const ok = await copyToClipboard(window.walletAddress);
  if (ok) {
    els.copyBtn.textContent = "Copied!";
    els.copyBtn.classList.add("copied");
    setTimeout(() => {
      if (els.copyBtn) {
        els.copyBtn.textContent = "Copy";
        els.copyBtn.classList.remove("copied");
      }
    }, 1500);
  }
}

async function onSignIn() {
  closePopover();
  try {
    const { getOrCreateSession } = await import("../services/api.js");
    await getOrCreateSession();
  } catch (err) {
    // User rejected — state remains auth-required
  }
}

function onDisconnect() {
  closePopover();
  disconnectWallet();
}

function onDocumentClick(e) {
  const els = getElements();
  // Close if click is outside both the popover and the wallet button
  if (
    els.popover &&
    !els.popover.contains(e.target) &&
    els.walletBtn &&
    !els.walletBtn.contains(e.target)
  ) {
    closePopover();
  }
}

function onDocumentKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closePopover();
  }
}

// ─── Initialization ──────────────────────────────────────────────────

function initWalletPopover() {
  const els = getElements();

  // Wire wallet button (connected state) to toggle popover instead of disconnecting
  if (els.walletBtn) {
    els.walletBtn.removeAttribute("onclick");
    els.walletBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopover();
    });
  }

  if (els.copyBtn) {
    els.copyBtn.addEventListener("click", onCopy);
  }
  if (els.signInBtn) {
    els.signInBtn.addEventListener("click", onSignIn);
  }
  if (els.disconnectBtn) {
    els.disconnectBtn.addEventListener("click", onDisconnect);
  }

  // Close on window resize to prevent misalignment
  window.addEventListener("resize", () => {
    if (isOpen) closePopover();
  });
}

export { initWalletPopover, openPopover, closePopover };

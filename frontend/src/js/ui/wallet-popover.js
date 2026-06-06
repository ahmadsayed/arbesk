/**
 * Arbesk Wallet Popover
 *
 * Dropdown popover for the connected wallet button.
 * Shows: address (with copy), network badge, explorer link,
 * network switcher, and disconnect action.
 */

import {
  getNetworkName,
  getAddressExplorerUrl,
  copyToClipboard,
  switchNetwork,
} from "../blockchain/explorer.js";
import { disconnectWallet } from "../blockchain/wallet.js";

let popover = null;
let isOpen = false;

// ─── DOM refs (lazy) ─────────────────────────────────────────────────

function getElements() {
  return {
    popover: document.getElementById("walletPopover"),
    address: document.getElementById("walletPopoverAddress"),
    copyBtn: document.getElementById("walletPopoverCopy"),
    networkBadge: document.getElementById("walletPopoverNetworkBadge"),
    chainId: document.getElementById("walletPopoverChainId"),
    explorerLink: document.getElementById("walletPopoverExplorer"),
    networkSelect: document.getElementById("walletPopoverNetworkSelect"),
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

  // Network badge
  if (els.networkBadge) {
    els.networkBadge.textContent = getNetworkName(chainId);
  }
  if (els.chainId) {
    els.chainId.textContent = chainId ? `Chain ID: ${chainId}` : "";
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

  // Network select — sync current value
  if (els.networkSelect) {
    const key = getNetworkKey(chainId);
    if (key) els.networkSelect.value = key;
  }
}

function getNetworkKey(chainId) {
  const map = {
    31415822: "hardhat",
    84532: "baseSepolia",
    80002: "polygonAmoy",
  };
  return map[Number(chainId)] || "";
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

async function onSwitchNetwork(e) {
  const key = e.target.value;
  if (!key) return;
  closePopover();
  try {
    await switchNetwork(key);
  } catch (err) {
    console.error("Network switch failed:", err);
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
  if (els.networkSelect) {
    els.networkSelect.addEventListener("change", onSwitchNetwork);
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

/**
 * Arbesk Wallet Popover — Alpine.js component
 *
 * GNOME HIG-compliant dropdown for the connected wallet button.
 * Shows: address (with copy), explorer link, sign-in / disconnect actions.
 * Network switching lives in the headerbar - not duplicated here.
 *
 * The DOM lives in app.pug (#walletPopover fragment, `x-data="walletPopover"`).
 * Reactive state lives in an Alpine.store so that BOTH template expressions
 * and external code (the walletState bus subscription, the header toggle
 * button) mutate the same reactive proxy — mutating a component's captured
 * `this` from outside Alpine's expression evaluation does not trigger
 * reactivity, but store writes always do.
 */

import {
  getAddressExplorerUrl,
  copyToClipboard,
} from "../blockchain/explorer.js";
import { truncateAddress } from "../utils/format.js";
import { disconnectWallet } from "../blockchain/wallet.js";
import { getCachedSession } from "../services/api.js";
import { on, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";
import { Alpine, registerAlpineComponent } from "./alpine.js";

/**
 * @typedef {object} WalletPopoverState
 * @property {boolean} isOpen
 * @property {string} address - full wallet address, "" when disconnected
 * @property {number} chainId
 * @property {boolean} copied - copy-button confirmation flag
 * @property {boolean} sessionAuthed - a cached session matches the address
 */

/** @type {WalletPopoverState|null} reactive Alpine.store proxy */
let _state = null;

/**
 * Get (or lazily create) the reactive popover state store.
 * @returns {WalletPopoverState}
 */
function state() {
  if (!_state) {
    // Alpine.store(name, value) is a setter (returns undefined); read it back.
    if (!Alpine.store("walletPopover")) {
      Alpine.store("walletPopover", {
        isOpen: false,
        address: "",
        chainId: 0,
        copied: false,
        sessionAuthed: false,
      });
    }
    _state = /** @type {WalletPopoverState} */ (Alpine.store("walletPopover"));
  }
  return /** @type {WalletPopoverState} */ (_state);
}

// ─── Open / close (state + imperative side effects) ──────────────────

function openState() {
  const s = state();
  s.isOpen = true;
  // Measure only after Alpine has flushed the `hidden` class removal.
  requestAnimationFrame(() => {
    positionPopover();
    document.getElementById("walletPopoverCopy")?.focus();
  });
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKey);
}

function closeState() {
  const s = state();
  if (!s.isOpen) return;
  s.isOpen = false;
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKey);
}

function toggleState() {
  if (state().isOpen) closeState();
  else openState();
}

// ─── Component factory (template-facing) ─────────────────────────────

/**
 * Alpine data factory for the wallet popover (`x-data="walletPopover"`).
 * Getters read the reactive store, so Alpine effects track them; methods
 * delegate to the module functions above.
 * @returns {object}
 */
export function walletPopover() {
  return {
    get displayAddress() {
      return truncateAddress(state().address) || "-";
    },

    get address() {
      return state().address;
    },

    get explorerUrl() {
      const s = state();
      return getAddressExplorerUrl(s.chainId, s.address);
    },

    get showSignIn() {
      const s = state();
      return !!s.address && !s.sessionAuthed;
    },

    get isOpen() {
      return state().isOpen;
    },

    get copied() {
      return state().copied;
    },

    /** Alpine init hook: seed from the store, then follow bus updates. */
    init() {
      const sync = (/** @type {any} */ s) => {
        const st = state();
        st.address = s.walletAddress || "";
        st.chainId = Number(s.chainId || 0);
        const cached = st.address ? getCachedSession() : null;
        st.sessionAuthed = !!(
          cached && cached.address === st.address.toLowerCase()
        );
      };
      sync(walletState.get());
      on(EVENTS.WALLET_STATE_CHANGED, sync);
    },

    toggle() {
      toggleState();
    },

    close() {
      closeState();
    },

    async copy() {
      const s = state();
      if (!s.address) return;
      const ok = await copyToClipboard(s.address);
      if (!ok) return;
      s.copied = true;
      setTimeout(() => {
        s.copied = false;
      }, 1500);
    },

    async signIn() {
      closeState();
      try {
        const { getOrCreateSession } = await import("../services/api.js");
        await getOrCreateSession();
      } catch {
        // User rejected - state remains auth-required
      }
    },

    disconnect() {
      closeState();
      disconnectWallet();
    },
  };
}

// ─── Imperative helpers (outside Alpine's template reach) ────────────

function positionPopover() {
  const popover = document.getElementById("walletPopover");
  const walletBtn = document.getElementById("disconnectWalletBtn");
  if (!popover || !walletBtn) return;

  const btnRect = walletBtn.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();

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

  popover.style.left = `${Math.max(16, left)}px`;
  popover.style.top = `${top}px`;
}

/** @param {MouseEvent} e */
function onDocumentClick(e) {
  const popover = document.getElementById("walletPopover");
  const walletBtn = document.getElementById("disconnectWalletBtn");
  const target = /** @type {Node|null} */ (e.target);
  // Close if click is outside both the popover and the wallet button
  if (
    popover &&
    !popover.contains(target) &&
    walletBtn &&
    !walletBtn.contains(target)
  ) {
    closeState();
  }
}

/** @param {KeyboardEvent} e */
function onDocumentKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeState();
  }
}

// ─── Initialization ──────────────────────────────────────────────────

function initWalletPopover() {
  registerAlpineComponent("walletPopover", walletPopover);

  // Wire the header wallet button (outside the component root) to toggle
  // the popover instead of disconnecting.
  const walletBtn = document.getElementById("disconnectWalletBtn");
  if (walletBtn) {
    walletBtn.removeAttribute("onclick");
    walletBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleState();
    });
  }

  // Close on window resize to prevent misalignment
  window.addEventListener("resize", () => {
    if (state().isOpen) closeState();
  });
}

/** Programmatic open (no-op until the store exists). */
function openPopover() {
  openState();
}

/** Programmatic close. */
function closePopover() {
  closeState();
}

export { initWalletPopover, openPopover, closePopover };

/**
 * Dropdown for the connected wallet button (address, explorer link, sign-in
 * and disconnect actions).
 * @remarks Reactive state lives in an Alpine.store so template expressions and
 *   external code mutate the same proxy — mutating a component's captured
 *   `this` from outside Alpine does not trigger reactivity, but store writes
 *   do. Network switching lives in the headerbar, not here.
 */

import {
  getAddressExplorerUrl,
  copyToClipboard,
} from "../blockchain/explorer.ts";
import { truncateAddress } from "../utils/format.ts";
import { disconnectWallet } from "../blockchain/wallet.ts";
import { getCachedSession } from "../services/api.ts";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { Alpine, registerAlpineComponent } from "./alpine.ts";

export interface WalletPopoverState {
  isOpen: boolean;
  /** full wallet address, "" when disconnected */
  address: string;
  chainId: number;
  /** copy-button confirmation flag */
  copied: boolean;
  /** a cached session matches the address */
  sessionAuthed: boolean;
}

/** reactive Alpine.store proxy */
let _state: WalletPopoverState | null = null;

/**
 * Get (or lazily create) the reactive popover state store.
 */
function state(): WalletPopoverState {
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
    _state = Alpine.store("walletPopover") as WalletPopoverState;
  }
  return _state;
}

// ─── Open / close (state + imperative side effects) ──────────────────

function openState(): void {
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

function closeState(): void {
  const s = state();
  if (!s.isOpen) return;
  s.isOpen = false;
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKey);
}

function toggleState(): void {
  if (state().isOpen) closeState();
  else openState();
}

// ─── Component factory (template-facing) ─────────────────────────────

/** Alpine component object for the wallet popover (`x-data="walletPopover"`). */
interface WalletPopoverComponent {
  readonly displayAddress: string;
  readonly address: string;
  readonly explorerUrl: string | null;
  readonly showSignIn: boolean;
  readonly isOpen: boolean;
  readonly copied: boolean;
  init(): void;
  toggle(): void;
  close(): void;
  copy(): Promise<void>;
  signIn(): Promise<void>;
  disconnect(): void;
}

/**
 * Alpine data factory for the wallet popover.
 */
export function walletPopover(): WalletPopoverComponent {
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
      const sync = (s: any) => {
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
        const { getOrCreateSession } = await import("../services/api.ts");
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

function positionPopover(): void {
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

function onDocumentClick(e: MouseEvent): void {
  const popover = document.getElementById("walletPopover");
  const walletBtn = document.getElementById("disconnectWalletBtn");
  const target = e.target as Node | null;
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

function onDocumentKey(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    closeState();
  }
}

// ─── Initialization ──────────────────────────────────────────────────

function initWalletPopover(): void {
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
function openPopover(): void {
  openState();
}

/** Programmatic close. */
function closePopover(): void {
  closeState();
}

export { initWalletPopover, openPopover, closePopover };

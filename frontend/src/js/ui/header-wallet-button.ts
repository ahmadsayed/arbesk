/**
 * Header wallet button — Alpine.js component.
 *
 * Renders the headerbar wallet controls from the reactive
 * `Alpine.store("headerWallet")`:
 *   - disconnected: show #connectWalletBtn, hide #disconnectWalletBtn
 *   - connected via CDP email: email/"Account" label, hide network selector
 *   - connected via crypto wallet: truncated address + optional Sign In dot
 *
 * The DOM lives in app.pug (.headerbar-actions, `x-data="headerWallet"`).
 * The store syncs itself from walletState + auth bus events, and the legacy
 * exported updaters remain as thin store writers so existing callers
 * (app-init.js) keep working unchanged.
 */

import { truncateAddress } from "../utils/format.ts";
import { getCachedSession } from "../services/api.ts";
import { walletState } from "../state/wallet-state.ts";
import { on, EVENTS } from "../asset-core/events/bus.ts";
import { Alpine, registerAlpineComponent } from "./alpine.ts";

export interface HeaderWalletState {
  /** full wallet address, "" when disconnected */
  address: string;
  walletSource: "cdp" | "walletconnect" | "injected" | null;
  email: string | null;
  isAuthenticated: boolean;
}

/** reactive Alpine.store proxy */
let _state: HeaderWalletState | null = null;

/**
 * Get (or lazily create) the reactive header-wallet store.
 */
function hwState(): HeaderWalletState {
  if (!_state) {
    // Alpine.store(name, value) is a setter (returns undefined); read it back.
    if (!Alpine.store("headerWallet")) {
      Alpine.store("headerWallet", {
        address: "",
        walletSource: null,
        email: null,
        isAuthenticated: false,
      });
    }
    _state = Alpine.store("headerWallet") as HeaderWalletState;
  }
  return _state;
}

// ─── Component factory (template-facing) ─────────────────────────────

/** Alpine component object for the header wallet controls (`x-data="headerWallet"`). */
interface HeaderWalletComponent {
  readonly connected: boolean;
  readonly isCdp: boolean;
  readonly label: string;
  readonly showAuthRequired: boolean;
  init(): void;
}

/**
 * Alpine data factory for the header wallet controls (`x-data="headerWallet"`).
 */
export function headerWallet(): HeaderWalletComponent {
  return {
    get connected() {
      return !!hwState().address;
    },

    get isCdp() {
      return hwState().walletSource === "cdp";
    },

    get label() {
      const s = hwState();
      if (!s.address) return "Disconnect";
      if (s.walletSource === "cdp") {
        // Web2-friendly: show email (truncated), no Sign In dot
        const email = s.email;
        return email && email.length > 24
          ? `${email.slice(0, 21)}…`
          : email || "Account";
      }
      const truncated = truncateAddress(s.address);
      return s.isAuthenticated ? truncated : `${truncated} • Sign In`;
    },

    get showAuthRequired() {
      const s = hwState();
      return !!s.address && s.walletSource !== "cdp" && !s.isAuthenticated;
    },

    /**
     * Alpine init hook: SEED from current state, then follow bus events.
     * Seeding is mandatory: auto-connect on page load can set walletState and
     * emit WALLET_CONNECTED before Alpine.start() (DOMContentLoaded), and a
     * subscriber registered here would never see those earlier events.
     */
    init() {
      const syncFromStore = (s: any) => {
        const st = hwState();
        st.address = s.walletAddress || "";
        st.walletSource = s.walletSource || null;
        st.email = s.email || null;
        st.isAuthenticated = isWalletAuthenticated(st.address);
      };
      syncFromStore(walletState.get());
      on(EVENTS.WALLET_STATE_CHANGED, syncFromStore);
      on(EVENTS.USER_AUTHENTICATED, () => {
        hwState().isAuthenticated = true;
      });
      on(EVENTS.USER_AUTH_REQUIRED, () => {
        hwState().isAuthenticated = false;
      });
    },
  };
}

// ─── Legacy imperative API (now thin store writers) ──────────────────

/**
 * Update the header wallet button and network selector.
 * Writes to the reactive store; Alpine bindings update the DOM.
 */
export function updateHeaderWalletButton(
  address: string | null,
  isAuthenticated: boolean,
  walletSource: "cdp" | "walletconnect" | "injected" | null,
  email: string | null = null
): void {
  const s = hwState();
  s.address = address || "";
  s.isAuthenticated = isAuthenticated;
  s.walletSource = walletSource;
  s.email = email;
}

/**
 * Update the header wallet button using the current walletSource/email from
 * walletState, so callers only need to pass what actually changed.
 */
export function updateHeaderWalletButtonFromState(
  address: string | null,
  isAuthenticated: boolean
): void {
  const { walletSource, email } = walletState.get();
  updateHeaderWalletButton(address, isAuthenticated, walletSource, email);
}

/**
 * Convenience: derive auth state from cached session and current address.
 */
export function isWalletAuthenticated(address: string | null): boolean {
  const cached = getCachedSession();
  return !!(cached && address && cached.address === address.toLowerCase());
}

registerAlpineComponent("headerWallet", headerWallet);

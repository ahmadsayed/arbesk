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

import { truncateAddress } from "../utils/format.js";
import { getCachedSession } from "../services/api.js";
import { walletState } from "../state/wallet-state.js";
import { on, EVENTS } from "../events/bus.js";
import { Alpine, registerAlpineComponent } from "./alpine.js";

/**
 * @typedef {object} HeaderWalletState
 * @property {string} address - full wallet address, "" when disconnected
 * @property {"cdp"|"walletconnect"|"injected"|null} walletSource
 * @property {string|null} email
 * @property {boolean} isAuthenticated
 */

/** @type {HeaderWalletState|null} reactive Alpine.store proxy */
let _state = null;

/**
 * Get (or lazily create) the reactive header-wallet store.
 * @returns {HeaderWalletState}
 */
function hwState() {
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
    _state = /** @type {HeaderWalletState} */ (Alpine.store("headerWallet"));
  }
  return /** @type {HeaderWalletState} */ (_state);
}

// ─── Component factory (template-facing) ─────────────────────────────

/**
 * Alpine data factory for the header wallet controls (`x-data="headerWallet"`).
 * @returns {object}
 */
export function headerWallet() {
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

    /** Alpine init hook: follow wallet state and auth bus events. */
    init() {
      on(EVENTS.WALLET_STATE_CHANGED, (/** @type {any} */ s) => {
        const st = hwState();
        st.address = s.walletAddress || "";
        st.walletSource = s.walletSource || null;
        st.email = s.email || null;
        st.isAuthenticated = isWalletAuthenticated(st.address);
      });
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
 *
 * @param {string|null} address
 * @param {boolean} isAuthenticated
 * @param {'cdp'|'walletconnect'|'injected'|null} walletSource
 * @param {string|null} email
 */
export function updateHeaderWalletButton(address, isAuthenticated, walletSource, email = null) {
  const s = hwState();
  s.address = address || "";
  s.isAuthenticated = isAuthenticated;
  s.walletSource = walletSource;
  s.email = email;
}

/**
 * Update the header wallet button using the current walletSource/email from
 * walletState, so callers only need to pass what actually changed.
 * @param {string|null} address
 * @param {boolean} isAuthenticated
 */
export function updateHeaderWalletButtonFromState(address, isAuthenticated) {
  const { walletSource, email } = walletState.get();
  updateHeaderWalletButton(address, isAuthenticated, walletSource, email);
}

/**
 * Convenience: derive auth state from cached session and current address.
 * @param {string|null} address
 * @returns {boolean}
 */
export function isWalletAuthenticated(address) {
  const cached = getCachedSession();
  return !!(cached && address && cached.address === address.toLowerCase());
}

registerAlpineComponent("headerWallet", headerWallet);

import { createStore } from "./create-store.js";
import { EVENTS } from "../events/bus.js";

/**
 * @typedef {Object} WalletState
 * @property {string|null} walletAddress
 * @property {string|null} eoaAddress
 * @property {number|string|null} chainId
 * @property {any} contract - Web3 contract instance (CDN global, untyped)
 * @property {string|null} contractAddress
 * @property {"cdp"|"walletconnect"|"injected"|null} walletSource
 * @property {string|null} email - CDP email login address (displayed in header)
 */

/** @type {WalletState} */
const _defaults = {
  walletAddress: null,
  eoaAddress: null,
  chainId: null,
  contract: null,
  contractAddress: null,
  walletSource: null, // 'cdp' | 'walletconnect' | 'injected' | null
  email: null, // CDP email login address (displayed in header)
};

const { store: walletState, _resetForTesting } = createStore(_defaults, EVENTS.WALLET_STATE_CHANGED);
export { walletState, _resetForTesting };

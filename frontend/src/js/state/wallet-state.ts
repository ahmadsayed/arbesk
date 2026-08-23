import { createStore } from "../asset-core/state/create-store.ts";
import { EVENTS } from "../asset-core/events/bus.ts";

export interface WalletState {
  walletAddress: string | null;
  eoaAddress: string | null;
  chainId: number | string | null;
  /** Web3 contract instance (CDN global, untyped) */
  contract: any;
  contractAddress: string | null;
  walletSource: "cdp" | "walletconnect" | "injected" | null;
  /** CDP email login address (displayed in header) */
  email: string | null;
}

const _defaults: WalletState = {
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

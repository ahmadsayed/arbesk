import { createStore } from "@arbesk/asset-core/state/create-store.js";
import { EVENTS } from "@arbesk/asset-core/events/bus.js";
import type { UserIdentity } from "@arbesk/wallet/types.js";

interface WalletState {
  walletAddress: string | null;
  eoaAddress: string | null;
  chainId: number | string | null;
  /** viem contract instance (untyped) */
  contract: any;
  contractAddress: string | null;
  walletSource: "cdp" | "walletconnect" | "injected" | null;
  /** CDP email login address (displayed in header) */
  email: string | null;
  /** First-class identity (the "who"), split from the on-chain signer state. */
  identity: UserIdentity | null;
}

const _defaults: WalletState = {
  walletAddress: null,
  eoaAddress: null,
  chainId: null,
  contract: null,
  contractAddress: null,
  walletSource: null, // 'cdp' | 'walletconnect' | 'injected' | null
  email: null, // CDP email login address (displayed in header)
  identity: null,
};

const { store: walletState, _resetForTesting } = createStore(_defaults, EVENTS.WALLET_STATE_CHANGED);
export { walletState, _resetForTesting };

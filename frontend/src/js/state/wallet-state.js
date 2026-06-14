import { createStore } from "./create-store.js";
import { EVENTS } from "../events/registry.js";

const _defaults = {
  walletAddress: null,
  chainId: null,
  contract: null,
  contractAddress: null,
};

const { store: walletState, _resetForTesting } = createStore(_defaults, EVENTS.WALLET_STATE_CHANGED);
export { walletState, _resetForTesting };

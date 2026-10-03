/**
 * viem clients for the browser: cached public clients for reads, and a wallet
 * client wrapping the injected EIP-1193 provider for user transactions.
 * @remarks The default chain is the connected wallet's, read from wallet-state;
 *   importing wallet-core here would create an import cycle.
 */
import { createPublicClient, custom, http } from "viem";
import type { PublicClient, Transport } from "viem";
import { CHAIN_IDS } from "../../../../constants/chains.js";
import { getRpcUrl } from "./network-config.ts";
import { walletState } from "../state/wallet-state.ts";
import { getConfig } from "../services/app-config.ts";

const readClients = new Map<number, PublicClient>();

/**
 * The chain reads default to the connected wallet's chain, or Hardhat local
 * (the dev default) when disconnected.
 */
function activeChainId(): number {
  const stored = walletState.get().chainId;
  return stored != null ? Number(stored) : CHAIN_IDS.HARDHAT_LOCAL;
}

/**
 * Hardhat Local transport bound to the RPC the backend advertises
 * (/api/v1/config → hardhatRpcUrl), resolved on first request.
 * @remarks The bundle's static Hardhat URL is shared by every backend that
 *   serves it, but each parallel E2E stack runs its own Hardhat node — the
 *   backend already honours HARDHAT_RPC_URL (src/config.ts), so the browser
 *   reads from the same node.
 */
function hardhatTransport(): Transport {
  let inner: Promise<ReturnType<Transport>> | null = null;
  return custom(
    {
      async request({ method, params }) {
        inner ??= getConfig()
          .catch(() => null)
          .then((config) =>
            http(config?.hardhatRpcUrl || getRpcUrl(CHAIN_IDS.HARDHAT_LOCAL))({})
          );
        return (await inner).request({ method, params });
      },
    },
    // The inner http transport already retries.
    { retryCount: 0 }
  );
}

/**
 * Cached read client for a chain (default: the active network).
 */
export function getReadClient(chainId?: number): PublicClient {
  const id = chainId ?? activeChainId();
  let c = readClients.get(id);
  if (!c) {
    const transport =
      id === CHAIN_IDS.HARDHAT_LOCAL ? hardhatTransport() : http(getRpcUrl(id));
    c = createPublicClient({ transport });
    readClients.set(id, c);
  }
  return c;
}

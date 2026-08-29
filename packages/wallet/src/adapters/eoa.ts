/**
 * Reference EOA Signer adapter: wraps a raw EIP-1193 provider (injected wallet
 * or WalletConnect) with viem wallet/public clients. personal_sign carries
 * exactly [message, address] — the web3 empty-password quirk is gone.
 */
import { createPublicClient, createWalletClient, custom } from "viem";
import type { Signer, SendResult, MinedReceipt } from "../types.ts";

/** Minimal EIP-1193 shape (the package may not reference window.ethereum types). */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export function createEoaSigner(provider: Eip1193Provider, address: string): Signer {
  const transport = custom(provider as any);
  const wallet = createWalletClient({ transport });
  const reader = createPublicClient({ transport });
  const account = address as `0x${string}`;
  return {
    source: "eoa",
    getAddress: () => address,
    getSignerAddress: () => address,
    getChainId: () => reader.getChainId(),
    signMessage: (message: string) =>
      wallet.signMessage({ account, message }) as Promise<string>,
    async sendTransaction({ to, value, data, gas }): Promise<SendResult> {
      // chain: null — the signer is chain-agnostic (the provider may switch
      // chains after construction); this skips viem's chain assertion, like
      // the old web3 path which never pinned a chain either.
      const hash = await wallet.sendTransaction({
        account, chain: null, to: to as `0x${string}`,
        value: value === undefined ? undefined : BigInt(value),
        data: data as `0x${string}` | undefined,
        gas: gas === undefined ? undefined : BigInt(gas),
      });
      return {
        hash,
        wait: async (): Promise<MinedReceipt> => {
          const r = await reader.waitForTransactionReceipt({ hash, pollingInterval: 250 });
          return {
            transactionHash: r.transactionHash,
            status: r.status === "success" ? true : r.status === "reverted" ? false : null,
            blockNumber: Number(r.blockNumber),
          };
        },
      };
    },
  };
}

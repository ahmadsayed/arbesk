/**
 * EOA Signer adapter — wraps an injected Web3.js instance (EIP-1193 or
 * WalletConnect) as the wallet Signer port. DI'd (web3 is passed in, no
 * browser globals), so it lives in the package. Gas defaults to
 * estimateGas + 20% pad (matching the old wallet-gas.ts); on estimate failure
 * it omits gas and lets web3 estimate at send time.
 */
import type { Signer } from "../types.ts";

export function createEoaSigner(web3: any, address: string): Signer {
  return {
    source: "eoa",
    getAddress: () => address,
    getSignerAddress: () => address,
    getChainId: async () => Number(await web3.eth.getChainId()),
    signMessage: async (message: string) =>
      web3.eth.personal.sign(message, address, ""),
    sendTransaction: async (tx) => {
      let gas = tx.gas;
      if (gas === undefined) {
        try {
          const est = await web3.eth.estimateGas({
            from: address,
            to: tx.to,
            data: tx.data,
            value: tx.value ?? "0x0",
          });
          gas = Math.floor(Number(est) * 1.2);
        } catch {
          // Leave gas undefined so web3 estimates at send time.
          gas = undefined;
        }
      }
      return new Promise((resolve, reject) => {
        const promiEvent: any = web3.eth.sendTransaction({
          from: address,
          to: tx.to,
          value: tx.value ?? "0x0",
          data: tx.data ?? "0x",
          gas,
        });
        promiEvent.once("transactionHash", (hash: string) => {
          resolve({
            hash,
            wait: async () => {
              const receipt = await promiEvent;
              return {
                transactionHash: receipt.transactionHash,
                status: Boolean(receipt.status),
                blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : null,
              };
            },
          });
        });
        promiEvent.once("error", (err: unknown) => reject(err));
      });
    },
  };
}

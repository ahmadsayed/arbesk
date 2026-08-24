/**
 * EOA `Signer` — wraps an injected (EIP-1193) or WalletConnect provider via the
 * Web3.js instance the app already builds. This is the *native* EOA signer:
 * getAddress/getSignerAddress are the same key, and signMessage/sendTransaction
 * route through Web3.js unchanged (behavior-identical to today).
 */
import type { Signer } from "./wallet-ports.ts";

export function createEoaSigner(web3: any, address: string): Signer {
  return {
    source: "eoa",
    getAddress: () => address,
    getSignerAddress: () => address,
    getChainId: async () => Number(await web3.eth.getChainId()),
    signMessage: async (message: string) =>
      web3.eth.personal.sign(message, address, ""),
    sendTransaction: async (tx) => {
      // web3.eth.sendTransaction returns a PromiEvent (EventEmitter + thenable).
      // Resolve on the broadcast hash; wait() awaits the mined receipt.
      return new Promise((resolve, reject) => {
        const promiEvent: any = web3.eth.sendTransaction({
          from: address,
          to: tx.to,
          value: tx.value ?? "0x0",
          data: tx.data ?? "0x",
          gas: tx.gas,
        });
        promiEvent.once("transactionHash", (hash: string) => {
          resolve({
            hash,
            wait: async () => {
              const receipt = await promiEvent;
              return {
                transactionHash: receipt.transactionHash,
                status: Boolean(receipt.status),
                blockNumber: receipt.blockNumber
                  ? Number(receipt.blockNumber)
                  : null,
              };
            },
          });
        });
        promiEvent.once("error", (err: unknown) => reject(err));
      });
    },
  };
}

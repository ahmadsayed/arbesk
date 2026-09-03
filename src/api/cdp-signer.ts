/**
 * CDP server Signer (P2b): implements the @arbesk/wallet Signer port over the
 * CDP server SDK's delegated-signing surface.
 * @remarks Submits paymaster-sponsored ERC-4337 UserOperations on Base
 *   Sepolia; the smart account + end-user id come from the email-auth session.
 */
import type { CdpClient } from "@coinbase/cdp-sdk";
import type { Signer, SendResult, MinedReceipt } from "@arbesk/wallet/types.js";

const CDP_NETWORK = "base-sepolia";

export interface CdpServerSignerConfig {
  cdp: CdpClient;
  userId: string;
  address: string;
  chainId: number;
  /** Poll an operation status (injectable for tests). */
  getOperation?: (userOpHash: string) => Promise<{ status: string; transactionHash?: string }>;
}

export function createCdpServerSigner(config: CdpServerSignerConfig): Signer {
  const { cdp, userId, address, chainId } = config;

  const getOperation =
    config.getOperation ??
    (async (userOpHash: string) => {
      const op = (await cdp.evm.getUserOperation({ smartAccount: address, userOpHash } as any)) as any;
      return { status: String(op?.status ?? ""), transactionHash: op?.transactionHash };
    });

  return {
    source: "cdp",
    getAddress: () => address,
    getSignerAddress: () => address,
    getChainId: async () => chainId,
    signMessage: async (message: string) => {
      const r = (await cdp.endUser.signEvmMessage({ userId, address, message })) as any;
      const sig = r?.signature;
      if (!sig) throw new Error("CDP signEvmMessage returned no signature");
      return String(sig);
    },
    sendTransaction: async (tx) => {
      const calls = [{ to: tx.to, data: tx.data ?? "0x", value: String(tx.value ?? 0n) }];
      const result = (await cdp.endUser.sendUserOperation({
        userId,
        address,
        network: CDP_NETWORK as any,
        calls,
        useCdpPaymaster: true,
      } as any)) as any;
      const userOpHash = String(result?.userOpHash ?? "");
      if (!userOpHash) throw new Error("CDP sendUserOperation returned no userOpHash");

      const wait = async (): Promise<MinedReceipt> => {
        for (let i = 0; i < 180; i++) {
          const op = await getOperation(userOpHash);
          if (op.status === "complete") {
            return { transactionHash: op.transactionHash ?? userOpHash, status: true };
          }
          if (op.status === "failed" || op.status === "dropped") {
            return { transactionHash: op.transactionHash ?? userOpHash, status: false };
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        return { transactionHash: userOpHash, status: null };
      };

      return { hash: userOpHash, wait } as SendResult;
    },
  };
}

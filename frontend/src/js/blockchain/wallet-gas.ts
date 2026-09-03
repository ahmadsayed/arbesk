/**
 * Resolves gas for contract sends.
 * @remarks CDP smart accounts skip estimation (sponsored UserOperations);
 *   EOA wallets estimate via the viem read client and pad by 20%.
 */

import { getActiveConnectionSource } from "./wallet-core.ts";
import { getReadClient } from "./viem-clients.ts";

// Generous gas ceiling for sponsored UserOperations. Supplying an explicit gas
// value lets the send path skip its own eth_estimateGas round trip; the
// ERC-4337 bundler re-estimates during UserOperation construction and the
// paymaster sponsors the cost, so an overestimate is free. Removing the
// redundant estimate trims a full RPC round trip from the social-login
// publish path.
const SMART_ACCOUNT_GAS_LIMIT = 2_000_000n;

export interface ResolveGasOptions {
  /** Contract address. */
  to: string;
  /** 0x-prefixed ABI-encoded calldata. */
  data: string;
  /** Native value to send (default 0). */
  value?: bigint | string;
  /** Sender address used as the estimation account. */
  from: string;
  /** Chain to estimate against (default: the active network). */
  chainId?: number;
  /** Gas to use when EOA estimation fails. */
  fallbackGas?: number;
}

/**
 * Resolves the gas option for a contract call send.
 * @remarks CDP smart accounts skip estimation; EOA wallets estimate and pad
 *   by 20%. For EOA wallets, when estimation fails and `fallbackGas` is
 *   given, the padded fallback is used instead of throwing.
 * @returns the padded gas limit, or the smart-account ceiling.
 */
async function resolveGas({
  to,
  data,
  value,
  from,
  chainId,
  fallbackGas,
}: ResolveGasOptions): Promise<bigint | undefined> {
  if (getActiveConnectionSource() === "cdp") return SMART_ACCOUNT_GAS_LIMIT;
  try {
    const estimate = await getReadClient(chainId).estimateGas({
      account: from as `0x${string}`,
      to: to as `0x${string}`,
      data: data as `0x${string}`,
      value: value !== undefined ? BigInt(value) : undefined,
    });
    return (estimate * 120n) / 100n;
  } catch (error) {
    if (fallbackGas === undefined) throw error;
    return (BigInt(fallbackGas) * 120n) / 100n;
  }
}

export { resolveGas, SMART_ACCOUNT_GAS_LIMIT };

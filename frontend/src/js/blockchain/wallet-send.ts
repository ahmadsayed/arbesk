/**
 * Wallet-agnostic contract transaction sending.
 *
 * Routes a web3 contract method through the injected `Signer` port instead of
 * `contract.methods.X().send()`: the method is ABI-encoded here (Web3.js still
 * owns encoding/decoding), gas is resolved per connection, and the broadcast +
 * wait are delegated to the Signer (EOA → PromiEvent; CDP → sponsored
 * UserOperation). This is what makes contract *writes* independent of wallet
 * kind — the prerequisite for deleting the CDP EIP-1193 shim.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getSigner } from "./wallet-core.ts";
import { resolveGas } from "./wallet-gas.ts";
import type { MinedReceipt } from "@arbesk/wallet/types.js";

export interface SendMethodOptions {
  /** Gas to use when EOA estimation fails (ignored for CDP). */
  fallbackGas?: number;
  /** Emit ASSET_PUBLISH_PENDING with this payload on the broadcast hash. */
  pendingPayload?: Record<string, unknown>;
  /** Native value to send (default 0). */
  value?: bigint | string;
}

/**
 * Send a prepared web3 contract method transaction through the active Signer.
 *
 * @param to - the contract address
 * @param method - a web3 contract method (e.g. `c.methods.foo(...)`)
 * @param opts  - see SendMethodOptions
 * @returns the mined receipt ({ transactionHash, status, blockNumber })
 */
export async function sendContractMethod(
  to: string | null,
  method: any,
  opts: SendMethodOptions = {}
): Promise<MinedReceipt> {
  const signer = getSigner();
  if (!signer) throw new Error("sendContractMethod: no signer connected");
  if (!to) throw new Error("sendContractMethod: no contract address");

  const from = signer.getAddress();
  const gas = await resolveGas(method, from, opts.fallbackGas);
  const data = method.encodeABI();

  const result = await signer.sendTransaction({
    to,
    data,
    value: opts.value,
    gas,
  });

  if (opts.pendingPayload) {
    emit(EVENTS.ASSET_PUBLISH_PENDING, {
      ...opts.pendingPayload,
      txHash: result.hash,
    });
  }

  return result.wait();
}

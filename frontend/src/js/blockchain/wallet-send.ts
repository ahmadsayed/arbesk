/**
 * Wallet-agnostic contract transaction sending.
 *
 * Routes a contract call through the injected `Signer` port instead of
 * `contract.methods.X().send()`: the call is ABI-encoded here with viem
 * (`encodeFunctionData`), gas is resolved per connection via wallet-gas,
 * and the broadcast + wait are delegated to the Signer (EOA → wallet tx;
 * CDP → sponsored UserOperation). This is what makes contract *writes*
 * independent of wallet kind — the prerequisite for deleting the CDP
 * EIP-1193 shim.
 */
import { encodeFunctionData } from "viem";
import type { Abi } from "viem";
import { toFunctionSignature } from "viem/utils";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getSigner } from "./wallet-core.ts";
import { resolveGas } from "./wallet-gas.ts";
import type { SendResult } from "@arbesk/wallet/types.js";

export interface SendCallOptions {
  /** Contract address. */
  to: string | null;
  /** Contract ABI (full artifact ABI is fine). */
  abi: Abi;
  /** Bare name, or full signature ("burn(uint256,bytes32[])") to pin an overload. */
  functionName: string;
  /** Call arguments; uint256 values are bigint. */
  args?: readonly unknown[];
  /** Native value to send (default 0). */
  value?: bigint | string;
  /** Chain to estimate gas on (default: the active network). */
  chainId?: number;
  /** Gas to use when EOA estimation fails (ignored for CDP). */
  fallbackGas?: number;
  /** Emit ASSET_PUBLISH_PENDING with this payload on the broadcast hash. */
  pendingPayload?: Record<string, unknown>;
}

/**
 * viem resolves functions by bare name and rejects full signatures, so a
 * web3-era full-signature `functionName` is narrowed to the matching ABI
 * item first (exact canonical-signature match, then same-name candidates).
 * No-op for plain names.
 */
function narrowToOverload(
  abi: Abi,
  functionName: string
): { abi: Abi; name: string } {
  const paren = functionName.indexOf("(");
  if (paren === -1) return { abi, name: functionName };
  const name = functionName.slice(0, paren);
  const candidates = (abi as any[]).filter(
    (i) => i?.type === "function" && i.name === name
  );
  const exact = candidates.filter(
    (i) => toFunctionSignature(i) === functionName
  );
  const narrowed = exact.length > 0 ? exact : candidates;
  return { abi: (narrowed.length > 0 ? narrowed : abi) as Abi, name };
}

/**
 * Encode and send a contract call through the active Signer.
 *
 * @param opts - see SendCallOptions
 * @returns the broadcast result ({ hash, wait() }) — `wait()` resolves the
 *   mined receipt ({ transactionHash, status, blockNumber })
 */
export async function sendContractCall(
  opts: SendCallOptions
): Promise<SendResult> {
  const signer = getSigner();
  if (!signer) throw new Error("sendContractCall: no signer connected");
  if (!opts.to) throw new Error("sendContractCall: no contract address");
  const to = opts.to;

  const { abi, name } = narrowToOverload(opts.abi, opts.functionName);
  const data = encodeFunctionData({
    abi,
    functionName: name,
    args: opts.args,
  } as any);

  const gas = await resolveGas({
    to,
    data,
    value: opts.value,
    from: signer.getAddress(),
    chainId: opts.chainId,
    fallbackGas: opts.fallbackGas,
  });

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

  return result;
}

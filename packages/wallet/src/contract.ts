/**
 * @arbesk/wallet contract facade — createAssetContract.
 *
 * Typed contract writes for the ArbeskAsset contracts. Calldata is ABI-encoded
 * with viem (the SDK owns encoding); broadcast + wait are delegated to the
 * injected Signer, so the facade is independent of wallet kind. The generic
 * call() method is the escape hatch for any ABI function.
 */
import { encodeFunctionData } from "viem";
import type { Abi } from "viem";
import type { Signer, MinedReceipt } from "./types.ts";

export interface AssetContractConfig {
  signer: Signer;
  address: string;
  abi: Abi;
}

export interface PublishParams {
  uri: string;
  tokenId: string | number;
  editorRoot: string;
  editorListUri: string;
}

export interface UpdateUriParams {
  tokenId: string | number;
  newUri: string;
  /** Editor-grant scope: `bytes32(0)` = collection-wide, `keccak256(assetId)` = asset-scoped. */
  assetScope: string;
  proof: string[];
}

export interface UpdateEditorsParams {
  tokenId: string | number;
  newRoot: string;
  newListUri: string;
  callerRole: number;
  callerProof: string[];
}

export interface BurnParams {
  tokenId: string | number;
  proof: string[];
}

export interface AssetContractClient {
  publish(p: PublishParams): Promise<MinedReceipt>;
  updateUri(p: UpdateUriParams): Promise<MinedReceipt>;
  updateEditors(p: UpdateEditorsParams): Promise<MinedReceipt>;
  burn(p: BurnParams): Promise<MinedReceipt>;
  /** Generic ABI write. Callers coerce uint256 args to bigint themselves. */
  call(functionName: string, args: unknown[], opts?: { value?: bigint; gas?: number }): Promise<MinedReceipt>;
}

/** tokenId is uint256 on-chain (may exceed Number.MAX_SAFE_INTEGER). */
function toUint256(tokenId: string | number): bigint {
  return BigInt(String(tokenId));
}

export function createAssetContract(config: AssetContractConfig): AssetContractClient {
  const { signer, address, abi } = config;

  async function write(
    functionName: string,
    args: unknown[],
    opts: { value?: bigint; gas?: number } = {},
  ): Promise<MinedReceipt> {
    const data = encodeFunctionData({ abi, functionName, args } as any);
    const result = await signer.sendTransaction({
      to: address,
      data,
      value: opts.value,
      gas: opts.gas,
    });
    return result.wait();
  }

  return {
    publish: (p) =>
      write("publishAsset", [p.uri, toUint256(p.tokenId), p.editorRoot, p.editorListUri]),
    updateUri: (p) => write("updateAssetURI", [toUint256(p.tokenId), p.newUri, p.assetScope, p.proof]),
    updateEditors: (p) =>
      write("updateEditors", [toUint256(p.tokenId), p.newRoot, p.newListUri, p.callerRole, p.callerProof]),
    burn: (p) => write("burn", [toUint256(p.tokenId), p.proof]),
    call: write,
  };
}

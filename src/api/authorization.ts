/**
 * Thin adapter over @arbesk/authz for the Express/viem backend.
 * @remarks The access policy lives in packages/authz so it stays reusable and
 *   testable independently of the Express/viem wiring.
 */

import { createAuthz } from "@arbesk/authz/facade.js";
import type { ChainReadPort, ResolvedContract } from "@arbesk/authz/types.js";
import { validateSession } from "./sessions.ts";
import { getContractAddress, getPublicClient } from "../config.ts";
import { CHAIN_IDS } from "../../constants/chains.js";

/**
 * Minimal ABI for owner/editor checks.
 */
const MINIMAL_COLLAB_ABI = [
  {
    stateMutability: "view",
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    type: "function",
  },
  {
    stateMutability: "view",
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "editorRoot",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    type: "function",
  },
  {
    stateMutability: "view",
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "editorSetVersion",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    type: "function",
  },
  {
    stateMutability: "view",
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    type: "function",
  },
] as const;

/**
 * Resolves the collection contract for a chain into a ChainReadPort.
 * @remarks Values are stringified at this boundary because viem returns
 *   bigint for uint256 where web3 returned strings, so the authz policy sees
 *   strings either way.
 */
function resolveContract(
  chainId: number | null,
  contractAddressOverride?: string,
): ResolvedContract {
  const cid = chainId ? Number(chainId) : null;
  const contractAddr = contractAddressOverride || getContractAddress(cid);
  if (!contractAddr) {
    throw new Error(`No contract address for chain ${chainId || "default"}`);
  }
  const client = getPublicClient(cid ?? undefined);
  const addr = contractAddr as `0x${string}`;
  const chain: ChainReadPort = {
    ownerOf: async (id) =>
      String(
        await client.readContract({
          address: addr,
          abi: MINIMAL_COLLAB_ABI,
          functionName: "ownerOf",
          args: [BigInt(id)],
        }),
      ),
    editorRoot: async (id) =>
      String(
        await client.readContract({
          address: addr,
          abi: MINIMAL_COLLAB_ABI,
          functionName: "editorRoot",
          args: [BigInt(id)],
        }),
      ),
    editorSetVersion: async (id) =>
      String(
        await client.readContract({
          address: addr,
          abi: MINIMAL_COLLAB_ABI,
          functionName: "editorSetVersion",
          args: [BigInt(id)],
        }),
      ),
    tokenURI: async (id) =>
      String(
        await client.readContract({
          address: addr,
          abi: MINIMAL_COLLAB_ABI,
          functionName: "tokenURI",
          args: [BigInt(id)],
        }),
      ),
  };
  return { chainId: cid, contractAddress: contractAddr, chain };
}

const authz = createAuthz({
  validateSession,
  defaultChainId: CHAIN_IDS.HARDHAT_LOCAL,
  resolveContract,
});

export const { checkAssetAccess, authorizeAssetAccess, getTokenUri } = authz;

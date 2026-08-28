/**
 * Backend authz wiring (P2c).
 *
 * Connects @arbesk/authz to the deployed ArbeskAsset contracts: resolves the
 * contract + chain via config.ts and reads ownerOf / editorRoot /
 * editorSetVersion / tokenURI through viem readContract. checkAssetAccess then
 * enforces ownership + Merkle editor proofs for the relay route.
 */
import { createAuthz } from "@arbesk/authz";
import type { ChainReadPort, Authz, AuthzConfig } from "@arbesk/authz";
import { getViemPublicClient, getContractAddress } from "../config.ts";
import { validateSession } from "./sessions.ts";
import type { PublicClient, Abi, Address } from "viem";

/** Minimal read ABI for the four methods the policy needs (full ABI loads in P2d). */
const READ_ABI: Abi = [
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { name: "editorRoot", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "bytes32" }] },
  { name: "editorSetVersion", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
];

const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID || 84532);

export function makeChainReadPort(
  chainId: number,
  contractAddress: string,
  client: PublicClient | null = getViemPublicClient(chainId),
): ChainReadPort {
  if (!client) throw new Error("No RPC client for chain " + chainId);
  const address = contractAddress as Address;
  const read = (functionName: "ownerOf" | "editorRoot" | "editorSetVersion" | "tokenURI", tokenId: string) =>
    client.readContract({ address, abi: READ_ABI, functionName, args: [BigInt(tokenId)] });
  return {
    ownerOf: async (tokenId) => String(await read("ownerOf", tokenId)),
    editorRoot: async (tokenId) => String(await read("editorRoot", tokenId)),
    editorSetVersion: async (tokenId) => String(await read("editorSetVersion", tokenId)),
    tokenURI: async (tokenId) => String(await read("tokenURI", tokenId)),
  };
}

export function resolveContract(chainId: number | null, contractAddressOverride?: string) {
  const cid = chainId ?? DEFAULT_CHAIN_ID;
  const contractAddress =
    contractAddressOverride ?? getContractAddress(cid) ?? process.env.CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("No contract address resolved for chain " + cid);
  return { chainId: cid, contractAddress, chain: makeChainReadPort(cid, contractAddress) };
}

export function createAuthzInstance(overrides: Partial<AuthzConfig> = {}): Authz {
  return createAuthz({
    validateSession,
    defaultChainId: DEFAULT_CHAIN_ID,
    resolveContract,
    ...overrides,
  });
}

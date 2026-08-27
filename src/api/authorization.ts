/**
 * Arbesk API Authorization Service
 *
 * Thin adapter over @arbesk/authz: builds the web3 ChainReadPort + session
 * validator, then delegates the access policy to createAuthz. The policy
 * itself lives in packages/authz so it's reusable and testable independently
 * of the Express/web3 wiring.
 */

import { createAuthz } from "@arbesk/authz/facade.js";
import type { ChainReadPort, ResolvedContract } from "@arbesk/authz/types.js";
import { validateSession } from "./sessions.ts";
import { getContractAddress, getWeb3 } from "../config.ts";
import { CHAIN_IDS } from "../../constants/chains.js";

/**
 * Minimal ABI for owner/editor checks.
 */
const MINIMAL_COLLAB_ABI = [
  {
    constant: true,
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "editorRoot",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "editorSetVersion",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    type: "function",
  },
];

/**
 * Resolve the collection contract for a chain into a ChainReadPort.
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
  const w3 = getWeb3(cid);
  const contract = new w3.eth.Contract(MINIMAL_COLLAB_ABI, contractAddr);
  const chain: ChainReadPort = {
    ownerOf: (id) => contract.methods.ownerOf(id).call(),
    editorRoot: (id) => contract.methods.editorRoot(id).call(),
    editorSetVersion: (id) => contract.methods.editorSetVersion(id).call(),
    tokenURI: (id) => contract.methods.tokenURI(id).call(),
  };
  return { chainId: cid, contractAddress: contractAddr, chain };
}

const authz = createAuthz({
  validateSession,
  defaultChainId: CHAIN_IDS.HARDHAT_LOCAL,
  resolveContract,
});

export const { checkAssetAccess, authorizeAssetAccess, getTokenUri } = authz;
export type { AssetAccessOptions, AssetAccessResult } from "@arbesk/authz/types.js";

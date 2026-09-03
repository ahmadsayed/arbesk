/**
 * Builds the canonical asset-level Nostr tag '<chainId>:<contract>:<tokenId>:<assetId>'.
 * @remarks Comments are scoped per asset, not per collection.
 * Used by chat-proxy.ts and the comments-archive route.
 */

import { getContractAddress } from "../config.ts";
import { CHAIN_IDS } from "../../constants/chains.js";

export function buildAssetTag(
  chainId: string | number | null,
  contractAddress: string | null,
  tokenId: string | number,
  assetId?: string | string[] | null,
): string {
  const cid = chainId ? Number(chainId) : CHAIN_IDS.HARDHAT_LOCAL;
  const addr = (contractAddress || getContractAddress(cid) || "unknown").toLowerCase();
  const id = assetId || "";
  return `${cid}:${addr}:${tokenId}:${id}`;
}

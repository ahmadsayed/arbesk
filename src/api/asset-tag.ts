/**
 * Canonical asset-level Nostr tag builder.
 *
 * Comments are scoped to an asset, not the whole collection: each asset gets
 * its own isolated thread keyed by the tag
 * `<chainId>:<contractAddress>:<tokenId>:<assetId>`. Shared by the chat proxy
 * (`chat-proxy.js`) and the comments archive route (`routes/comments.js`) so
 * both compute the exact same tag for the same asset.
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

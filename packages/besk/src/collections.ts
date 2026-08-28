/**
 * Collection creation for the CLI: derive the deterministic named-collection
 * token ID (byte-identical to the Studio's deriveNamedCollectionId) and mint it
 * via the backend relay (no key, no browser). Reuses the asset-core write port
 * for the collection manifest + editor list.
 */
import { encodePacked, keccak256 } from "viem/utils";
import { computeRoot } from "@arbesk/wallet/merkle.js";
import { writeJSON, getCollectionManifest } from "./catalog.ts";
import { relay } from "./relay.ts";
import type { Session } from "./session.ts";

/** CollaboratorRole.Editor — matches the Solidity contract + wallet SDK. */
const EDITOR_ROLE = 2;

/**
 * Derive the deterministic named-collection token ID from wallet + name.
 * Byte-identical to the Studio: keccak256(abi.encodePacked(address, string))
 * with the address lowercased (checksum-exempt, matching Web3.soliditySha3).
 */
export function deriveNamedCollectionTokenId(address: string, name: string): string {
  const hex = keccak256(
    encodePacked(
      ["address", "string"] as any,
      [address.toLowerCase(), name] as any,
    ),
  );
  return BigInt(hex).toString();
}

export interface CreatedCollection {
  tokenId: string;
  manifestCid: string;
  isNew: boolean;
  transactionHash?: string;
}

/**
 * Create (mint) a named collection, or return the existing one when already
 * minted. The collection manifest is written first, then the editor list, then
 * the mint is submitted through the relay publish op.
 */
export async function createCollection(
  session: Session,
  name: string,
): Promise<CreatedCollection> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Collection name is required");

  const tokenId = deriveNamedCollectionTokenId(session.address, trimmed);

  // Already minted? tokenURI reverts for a non-existent token, so a successful
  // read means the collection exists (deterministic ID → same wallet+name).
  try {
    const { cid } = await getCollectionManifest(tokenId);
    return { tokenId, manifestCid: cid, isNew: false };
  } catch {
    // token does not exist — proceed to mint.
  }

  const collectionManifest = {
    type: "collection",
    name: trimmed,
    asset_id: "collection_" + Date.now(),
    version: 1,
    timestamp: Date.now(),
    assets: {},
    prev_asset_manifest_cid: null,
  };
  const collectionCid = await writeJSON(collectionManifest);

  const editorList = [{ address: session.address, role: EDITOR_ROLE }];
  const editorRoot = computeRoot(editorList, tokenId, 1);
  const editorListUri = await writeJSON(editorList);

  const receipt = await relay(session, "publish", tokenId, {
    uri: collectionCid,
    editorRoot,
    editorListUri,
  });
  const transactionHash =
    (receipt as { transactionHash?: string }).transactionHash;

  return { tokenId, manifestCid: collectionCid, isNew: true, transactionHash };
}

/**
 * Merkle editor-tree primitives — pure (no runtime/ports), used by the wallet
 * facade's getMerkleProof and the @arbesk/authz asset-access check.
 *
 * Leaf encoding matches ArbeskAssetBase._requireEditor:
 *   keccak256(abi.encodePacked(address, role, tokenId, assetScope, editorSetVersion))
 * implemented with viem encodePacked + keccak256 (byte-identical to
 * Web3.utils.soliditySha3 and the asset-core HashPort path).
 *
 * CANONICAL: this is the Merkle source of truth. @arbesk/asset-core keeps an
 * independent copy (domain/editors.ts) because it cannot import this package —
 * the two MUST stay byte-identical for makeLeaf/computeRoot/getProof/verify.
 * A change here must be mirrored there; test/merkle-parity.test.js pins parity.
 */
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { encodePacked, keccak256 } from "viem/utils";

export const MAX_EDITORS_PER_TOKEN = 5000;

export const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export interface EditorEntry {
  address: string;
  role: number;
  /** Email the editor was invited by (CDP email-login users only). */
  email?: string;
}

/**
 * Build a leaf hash for the editor Merkle tree (32-byte hex string).
 */
export function makeLeaf(
  address: string,
  role: number,
  tokenId: string | number,
  setVersion: string | number,
  assetScope: string = ZERO_HASH,
): string {
  // Cast the packed arrays the same way asset-core's browser HashPort does:
  // viem's encodePacked demands branded Address/uint value types, but the
  // output bytes are identical to Web3.utils.soliditySha3.
  return keccak256(
    encodePacked(
      ["address", "uint8", "uint256", "bytes32", "uint256"] as any,
      [address.toLowerCase(), role, BigInt(tokenId), assetScope, BigInt(setVersion)] as any,
    ),
  );
}

function buildTree(leaves: string[]): SimpleMerkleTree {
  return SimpleMerkleTree.of(leaves);
}

/**
 * Compute the Merkle root for an editor list at a token/version.
 */
export function computeRoot(
  editorList: EditorEntry[],
  tokenId: string | number,
  setVersion: string | number,
  assetScope: string = ZERO_HASH,
): string {
  if (!editorList || editorList.length === 0) return ZERO_HASH;
  if (editorList.length > MAX_EDITORS_PER_TOKEN) {
    throw new Error(
      `Editor list has ${editorList.length} members; the maximum is ${MAX_EDITORS_PER_TOKEN}`,
    );
  }
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion, assetScope),
  );
  return buildTree(leaves).root;
}

/**
 * Generate a Merkle proof for an editor in the list.
 */
export function getProof(
  editorList: EditorEntry[],
  targetAddress: string,
  tokenId: string | number,
  setVersion: string | number,
  assetScope: string = ZERO_HASH,
): { proof: string[]; role: number } | null {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase(),
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion, assetScope),
  );
  const tree = buildTree(leaves);
  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion, assetScope);
  return { proof: tree.getProof(leaf), role: entry.role };
}

/**
 * Verify a Merkle proof against a root and leaf.
 */
export function verifyEditorProof(
  root: string,
  leaf: string,
  proof: string[],
): boolean {
  if (!root || root === ZERO_HASH) return false;
  return SimpleMerkleTree.verify(root, leaf, proof);
}

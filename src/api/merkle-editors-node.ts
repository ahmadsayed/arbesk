/**
 * Merkle Editor Tree - Node backend version
 *
 * Leaf encoding and proof verification compatible with
 * ArbeskAssetBase._requireEditor, using OpenZeppelin's reference Merkle-tree
 * implementation. Root/proof construction happens client-side
 * (frontend/src/js/asset-core/gltf/merkle-editors.js); the backend only verifies.
 */

import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { soliditySha3 } from "web3-utils";

/**
 * Build a leaf hash matching ArbeskAssetBase._requireEditor.
 *
 * @param address    - Ethereum address (0x...)
 * @param role       - CollaboratorRole enum (1=Viewer, 2=Editor)
 * @returns bytes32 hex string
 */
export function makeLeaf(
  address: string,
  role: number,
  tokenId: string | number | bigint,
  setVersion: string | number | bigint,
): string {
  return soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId.toString() },
    { type: "uint256", value: setVersion.toString() },
  ) as string;
}

/**
 * Verify a Merkle proof against a root and leaf.
 *
 * @param root   - bytes32 hex root
 * @param leaf   - bytes32 hex leaf
 * @param proof - array of bytes32 hex sibling hashes
 */
export function verifyProof(root: string, leaf: string, proof: string[]): boolean {
  if (!root || root === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return false;
  }
  return SimpleMerkleTree.verify(root, leaf, proof);
}

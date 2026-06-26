/**
 * Merkle Editor Tree — Node backend version
 *
 * Builds and verifies Merkle proofs compatible with ArbeskAssetBase._requireEditor.
 *
 * Uses web3 v4 utils.soliditySha3 (the same hash semantics as the browser
 * merkle-editors.js module which uses window.Web3.utils.soliditySha3).
 */

import { soliditySha3 } from "web3-utils";

/**
 * Build a leaf hash matching ArbeskAssetBase._requireEditor.
 *
 * @param {string} address    - Ethereum address (0x...)
 * @param {number} role       - CollaboratorRole enum (1=Viewer, 2=Editor)
 * @param {string|number|BigInt} tokenId
 * @param {string|number|BigInt} setVersion
 * @returns {string} bytes32 hex string
 */
export function makeLeaf(address, role, tokenId, setVersion) {
  return soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId.toString() },
    { type: "uint256", value: setVersion.toString() },
  );
}

/**
 * OZ-compatible pair hash: keccak256(abi.encodePacked(a, b)) with a ≤ b.
 */
function hashPair(a, b) {
  const [lo, hi] = cmpBytes32(a, b) <= 0 ? [a, b] : [b, a];
  return soliditySha3(
    { type: "bytes32", value: lo },
    { type: "bytes32", value: hi },
  );
}

function cmpBytes32(a, b) {
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

/**
 * Verify a Merkle proof against a root and leaf.
 *
 * @param {string} root   - bytes32 hex root
 * @param {string} leaf   - bytes32 hex leaf
 * @param {string[]} proof - array of bytes32 hex sibling hashes
 * @returns {boolean}
 */
export function verifyProof(root, leaf, proof) {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

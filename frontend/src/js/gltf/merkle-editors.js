// @ts-nocheck
/**
 * Merkle Editor Tree - JS library
 *
 * Builds Merkle trees and proofs compatible with OpenZeppelin's
 * MerkleProof.sol (used in ArbeskAssetBase._requireEditor).
 *
 * Uses window.Web3.utils.soliditySha3 (static, available from CDN before
 * wallet connection) - NOT window.web3 (instance, only after connection).
 */

function _soliditySha3(...args) {
  const W3 = window.Web3;
  if (!W3 || !W3.utils || !W3.utils.soliditySha3) {
    throw new Error("Web3.js not loaded from CDN");
  }
  return W3.utils.soliditySha3(...args);
}

/**
 * Build a leaf hash matching ArbeskAssetBase._requireEditor.
 *
 * @param {string}  address    - Ethereum address (0x...)
 * @param {number}  role       - CollaboratorRole enum (0=None, 1=Viewer, 2=Editor)
 * @param {number|string|BigInt} tokenId
 * @param {number|string|BigInt} setVersion
 * @returns {string} bytes32 hex string
 */
export function makeLeaf(address, role, tokenId, setVersion) {
  return _soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId },
    { type: "uint256", value: setVersion }
  );
}

/**
 * OZ-compatible pair hash: keccak256(abi.encodePacked(a, b)) with a ≤ b.
 */
function hashPair(a, b) {
  const [lo, hi] = cmpBytes32(a, b) <= 0 ? [a, b] : [b, a];
  return _soliditySha3(
    { type: "bytes32", value: lo },
    { type: "bytes32", value: hi }
  );
}

function cmpBytes32(a, b) {
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

function sortLeaves(leaves) {
  return [...leaves].sort((a, b) => cmpBytes32(a, b));
}

export function computeRoot(editorList, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  return buildRoot(leaves);
}

function buildRoot(leaves) {
  if (leaves.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  let layer = sortLeaves(leaves);
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  return layer[0];
}

export function getProof(editorList, targetAddress, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion);
  const allLeaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );

  const proof = buildProof(allLeaves, leaf);
  return { proof, role: entry.role };
}

function buildProof(leaves, targetLeaf) {
  if (leaves.length <= 1) return [];
  let layer = sortLeaves(leaves);
  const proof = [];

  while (layer.length > 1) {
    const idx = layer.findIndex((l) => l === targetLeaf);
    if (idx === -1) break;
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (pairIdx >= 0 && pairIdx < layer.length) {
      proof.push(layer[pairIdx]);
    }
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    targetLeaf = next[Math.floor(idx / 2)];
    layer = next;
  }
  return proof;
}

export function verifyProof(root, leaf, proof) {
  let computed = leaf;
  for (const sibling of proof) {
    computed = hashPair(computed, sibling);
  }
  return computed === root;
}

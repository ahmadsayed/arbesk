/**
 * Arbesk API Authorization Service
 *
 * Centralized authorization logic for both HTTP and WebSocket endpoints.
 * Combines session validation with asset access checks.
 */

import { validateSession } from "./sessions.js";
import { getContractAddress, getWeb3 } from "../config.js";
import { makeLeaf, verifyProof } from "./merkle-editors-node.js";

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
];

/**
 * Default chain ID for local dev when chainId not supplied.
 */
function defaultChainId() {
  return 31415822; // Matches CHAIN_IDS.HARDHAT_LOCAL
}

/**
 * Check asset access by ownership or Merkle editor proof.
 * @param {string|number} tokenId - Token ID to check
 * @param {number|null} chainId - Chain ID (null for default)
 * @param {string} address - Wallet address to check
 * @param {object} [opts] - Optional proof for non-owner collaborators
 * @param {string[]} [opts.proof] - Merkle proof (bytes32 hex strings)
 * @param {number} [opts.requiredRole] - Claimed collaborator role (1=Viewer, 2=Editor)
 * @returns {Promise<{allowed: boolean, assetId: string, chainId: number|null, isOwner: boolean, role: number}>}
 */
export async function checkAssetAccess(tokenId, chainId, address, opts = {}) {
  // Token IDs are uint256 and can exceed Number.MAX_SAFE_INTEGER, so keep them
  // as strings/BigInt throughout this check.
  let id;
  try {
    id = BigInt(tokenId);
  } catch {
    throw new Error("Invalid tokenId");
  }
  if (id < 0n) {
    throw new Error("Invalid tokenId");
  }

  const cid = chainId ? Number(chainId) : null;
  const contractAddr = getContractAddress(cid);
  if (!contractAddr) {
    throw new Error(`No contract address for chain ${chainId || "default"}`);
  }

  const assetId = `${cid || defaultChainId()}:${contractAddr}:${id.toString()}`;
  const w3 = getWeb3(cid);
  const contract = new w3.eth.Contract(MINIMAL_COLLAB_ABI, contractAddr);

  const owner = await contract.methods.ownerOf(id.toString()).call();

  const normalizedAddress = address.toLowerCase();
  const isOwner = owner.toLowerCase() === normalizedAddress;

  if (isOwner) {
    return { allowed: true, assetId, chainId: cid, isOwner: true, role: 2 };
  }

  // Non-owners may present a Merkle proof that they hold a collaborator role.
  const { proof, requiredRole } = opts;
  if (Array.isArray(proof) && proof.length > 0 && requiredRole != null) {
    try {
      const [root, setVersion] = await Promise.all([
        contract.methods.editorRoot(id.toString()).call(),
        contract.methods.editorSetVersion(id.toString()).call(),
      ]);

      if (
        root &&
        root !== "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        const leaf = makeLeaf(
          normalizedAddress,
          Number(requiredRole),
          id.toString(),
          setVersion.toString(),
        );
        if (verifyProof(root, leaf, proof)) {
          return {
            allowed: true,
            assetId,
            chainId: cid,
            isOwner: false,
            role: Number(requiredRole),
          };
        }
      }
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.warn(
        `[AUTH] Merkle proof verification failed for ${assetId}:`,
        e.message,
      );
    }
  }

  return { allowed: false, assetId, chainId: cid, isOwner: false, role: 0 };
}

/**
 * Validate session and check asset access in one call.
 * @param {string} token - Session token
 * @param {string|number} tokenId - Token ID to check
 * @param {number|null} chainId - Chain ID (null for default)
 * @param {object} [opts] - Optional proof for non-owner collaborators
 * @param {string[]} [opts.proof] - Merkle proof (bytes32 hex strings)
 * @param {number} [opts.requiredRole] - Claimed collaborator role (1=Viewer, 2=Editor)
 * @returns {Promise<{allowed: boolean, assetId: string, chainId: number|null, address: string, isOwner: boolean, role: number}|null>}
 */
export async function authorizeAssetAccess(token, tokenId, chainId, opts = {}) {
  const address = validateSession(token);
  if (!address) {
    return null;
  }

  const access = await checkAssetAccess(tokenId, chainId, address, opts);
  return {
    ...access,
    address,
  };
}

/**
 * Validate session token only.
 * @param {string} token - Session token
 * @returns {string|null} Wallet address or null if invalid
 */
export { validateSession };

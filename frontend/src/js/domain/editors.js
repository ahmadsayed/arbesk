/**
 * Domain: Editors — Merkle editor-list operations, local cache, and proof commands.
 *
 * Centralizes editor list localStorage caching, on-chain version lookup,
 * Merkle root computation, and proof generation for the publish, team,
 * delete, library, and comment flows.
 */
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { getActiveContract } from "../blockchain/wallet.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

export const MAX_EDITORS_PER_TOKEN = 5000;

/**
 * @typedef {{address: string, role: number}} EditorEntry
 */

/**
 * @param {...any} args
 * @returns {any} hex string from Web3.utils.soliditySha3
 */
function _soliditySha3(...args) {
  const W3 = window.Web3;
  if (!W3 || !W3.utils || !W3.utils.soliditySha3) {
    throw new Error("Web3.js not loaded from CDN");
  }
  return W3.utils.soliditySha3(...args);
}

/**
 * Build a leaf hash for the editor Merkle tree.
 * @param {string} address
 * @param {number} role
 * @param {string|number} tokenId
 * @param {number} setVersion
 * @returns {string} 32-byte hex string
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
 * @param {string[]} leaves
 * @returns {any} SimpleMerkleTree instance, or null for an empty list
 */
function _buildTree(leaves) {
  if (!leaves || leaves.length === 0) return null;
  return SimpleMerkleTree.of(leaves);
}

/**
 * Compute the Merkle root for an editor list at a given token/version.
 * @param {Array<{address: string, role: number}>} editorList
 * @param {string|number} tokenId
 * @param {number} setVersion
 * @returns {string} 32-byte hex root
 */
export function computeRoot(editorList, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  if (editorList.length > MAX_EDITORS_PER_TOKEN) {
    throw new Error(
      `Editor list has ${editorList.length} members; the maximum is ${MAX_EDITORS_PER_TOKEN}`
    );
  }
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = _buildTree(leaves);
  return tree.root;
}

/**
 * Generate a Merkle proof for an editor in the list.
 * @param {Array<{address: string, role: number}>} editorList
 * @param {string} targetAddress
 * @param {string|number} tokenId
 * @param {number} setVersion
 * @returns {{proof: string[], role: number}|null}
 */
export function getProof(editorList, targetAddress, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return null;
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  const tree = _buildTree(leaves);
  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion);
  const proof = tree.getProof(leaf);
  return { proof, role: entry.role };
}

/**
 * Verify a Merkle proof against a root and leaf.
 * @param {string} root
 * @param {string} leaf
 * @param {string[]} proof
 * @returns {boolean}
 */
export function verifyProof(root, leaf, proof) {
  if (
    !root ||
    root === "0x0000000000000000000000000000000000000000000000000000000000000000"
  ) {
    return false;
  }
  return SimpleMerkleTree.verify(root, leaf, proof);
}

// ─── Cache ─────────────────────────────────────────────────────────────────

/**
 * @param {string} tag asset tag
 * @returns {string} localStorage key
 */
export function editorListKey(tag) {
  return EDITOR_LIST_PREFIX + tag;
}

/**
 * @param {string} tag
 * @param {EditorEntry[]} list
 * @param {string|null} [cid]
 */
export function saveEditorList(tag, list, cid = null) {
  try {
    localStorage.setItem(
      editorListKey(tag),
      JSON.stringify({ list, cid, saved: Date.now() })
    );
  } catch (e) {
    console.warn("[EDITORS] failed to cache editor list:", /** @type {Error} */ (e).message);
  }
}

/**
 * @param {string} tag
 * @returns {EditorEntry[]|null}
 */
function _loadCachedEditorList(tag) {
  try {
    const raw = localStorage.getItem(editorListKey(tag));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.list)) return parsed.list;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

/**
 * @param {string} tag
 */
export function clearEditorCache(tag) {
  try {
    localStorage.removeItem(editorListKey(tag));
  } catch {
    /* ignore */
  }
}

// ─── List / version resolution ─────────────────────────────────────────────

/**
 * @param {string} tag
 * @returns {Promise<EditorEntry[]>}
 */
export async function loadEditorList(tag) {
  if (!tag) return [];
  try {
    const c = getActiveContract();
    if (c) {
      const cid = await c.methods.editorListURI(tag).call();
      if (cid) {
        const fresh = await getFromRemoteIPFS(cid);
        if (Array.isArray(fresh)) {
          saveEditorList(tag, fresh, cid);
          return fresh;
        }
      }
    }
  } catch (err) {
    console.warn(`[EDITORS] failed to load editor list for ${tag}:`, /** @type {Error} */ (err).message);
  }
  const cached = _loadCachedEditorList(tag);
  return cached || [];
}

/**
 * @param {string} tag
 * @returns {Promise<number>}
 */
export async function getEditorSetVersion(tag) {
  const c = getActiveContract();
  if (!c) return 1;
  try {
    const version = await c.methods.editorSetVersion(tag).call();
    return Number(version);
  } catch {
    return 1;
  }
}

// ─── Proof command ─────────────────────────────────────────────────────────

/**
 * @param {string} tag
 * @param {string} editorAddress
 * @returns {Promise<{proof: string[], role: number}|null>}
 */
export async function buildEditorProof(tag, editorAddress) {
  const [versionResult, listResult] = await Promise.allSettled([
    getEditorSetVersion(tag),
    loadEditorList(tag),
  ]);

  const version = versionResult.status === "fulfilled" ? versionResult.value : 1;
  const list = listResult.status === "fulfilled" ? listResult.value : [];

  return getProof(list, editorAddress, tag, version);
}

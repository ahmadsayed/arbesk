/**
 * Domain: Editors — Merkle editor-list operations, local cache, and proof commands.
 *
 * Centralizes editor list caching (StoragePort), on-chain version lookup
 * (ChainPort), Merkle root computation (HashPort), and proof generation for
 * the publish, team, delete, library, and comment flows.
 */
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { getRuntime } from "../runtime.ts";

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

export const MAX_EDITORS_PER_TOKEN = 5000;

export interface EditorEntry {
  address: string;
  role: number;
  /** Email the editor was invited by (CDP email-login users only). */
  email?: string;
}

/**
 * ABI-packed keccak256 via the injected HashPort — same semantics (and
 * `{type, value}` arguments) as Web3.utils.soliditySha3.
 * @returns hex string from the HashPort
 */
function _soliditySha3(...args: any[]): any {
  const h = getRuntime().hash;
  if (!h) {
    throw new Error("asset-core: editor ops require a HashPort");
  }
  return h.soliditySha3(...args);
}

/**
 * Build a leaf hash for the editor Merkle tree.
 * @returns 32-byte hex string
 */
export function makeLeaf(
  address: string,
  role: number,
  tokenId: string | number,
  setVersion: number
): string {
  return _soliditySha3(
    { type: "address", value: address },
    { type: "uint8", value: role },
    { type: "uint256", value: tokenId },
    { type: "uint256", value: setVersion }
  );
}

/**
 * @returns SimpleMerkleTree instance, or null for an empty list
 */
function _buildTree(leaves: string[]): SimpleMerkleTree | null {
  if (!leaves || leaves.length === 0) return null;
  return SimpleMerkleTree.of(leaves);
}

/**
 * Compute the Merkle root for an editor list at a given token/version.
 * @returns 32-byte hex root
 */
export function computeRoot(
  editorList: EditorEntry[],
  tokenId: string | number,
  setVersion: number
): string {
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
  return tree!.root;
}

/**
 * Generate a Merkle proof for an editor in the list.
 */
export function getProof(
  editorList: EditorEntry[],
  targetAddress: string,
  tokenId: string | number,
  setVersion: number
): { proof: string[]; role: number } | null {
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
  const proof = tree!.getProof(leaf);
  return { proof, role: entry.role };
}

/**
 * Verify a Merkle proof against a root and leaf.
 */
export function verifyProof(
  root: string,
  leaf: string,
  proof: string[]
): boolean {
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
 * @returns localStorage key
 */
export function editorListKey(tag: string): string {
  return EDITOR_LIST_PREFIX + tag;
}

export function saveEditorList(
  tag: string,
  list: EditorEntry[],
  cid: string | null = null
) {
  try {
    getRuntime().storage.setItem(
      editorListKey(tag),
      JSON.stringify({ list, cid, saved: Date.now() })
    );
  } catch (e) {
    console.warn("[EDITORS] failed to cache editor list:", (e as Error).message);
  }
}

function _loadCachedEditorList(tag: string): EditorEntry[] | null {
  try {
    const raw = getRuntime().storage.getItem(editorListKey(tag));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.list)) return parsed.list;
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

export function clearEditorCache(tag: string) {
  try {
    getRuntime().storage.removeItem(editorListKey(tag));
  } catch {
    /* ignore */
  }
}

// ─── List / version resolution ─────────────────────────────────────────────

export async function loadEditorList(tag: string): Promise<EditorEntry[]> {
  if (!tag) return [];
  try {
    const chain = getRuntime().chain;
    const cid = chain?.getEditorListURI
      ? await chain.getEditorListURI(tag)
      : null;
    if (cid) {
      const fresh = await getRuntime().ipfsRead.getJSON(cid);
      if (Array.isArray(fresh)) {
        saveEditorList(tag, fresh, cid);
        return fresh;
      }
    }
  } catch (err) {
    console.warn(`[EDITORS] failed to load editor list for ${tag}:`, (err as Error).message);
  }
  const cached = _loadCachedEditorList(tag);
  return cached || [];
}

export async function getEditorSetVersion(tag: string): Promise<number> {
  const chain = getRuntime().chain;
  if (!chain?.getEditorListVersion) return 1;
  try {
    const version = await chain.getEditorListVersion(tag);
    return Number(version);
  } catch {
    return 1;
  }
}

// ─── Add/remove commands ────────────────────────────────────────────────────

/** Role assigned by addEditorCommand (matches CollaboratorRole.Editor in services/team.ts). */
export const EDITOR_ROLE_EDITOR = 2;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Result of an editor-list mutation. `root`/`version` are what an on-chain
 * updateEditors transaction would submit — the command itself only persists
 * the list (IPFS write + local cache); the ChainPort has no write op yet, so
 * submitting the transaction stays the caller's job.
 */
export interface EditorListUpdate {
  cid: string;
  root: string;
  version: number;
  list: EditorEntry[];
}

/**
 * Rebuild the Merkle root for `list` at the next set version and persist the
 * list to IPFS + the local cache.
 */
async function _persistEditorList(
  tag: string,
  list: EditorEntry[]
): Promise<EditorListUpdate> {
  const version = (await getEditorSetVersion(tag)) + 1;
  const root = computeRoot(list, tag, version);
  const cid = await getRuntime().ipfsWrite.writeJSON(list, null, {
    compress: true,
    type: "editors",
    assetId: `token_${tag}_v${version}`,
  });
  saveEditorList(tag, list, cid);
  return { cid, root, version, list };
}

/**
 * Add an editor to a token's editor list and persist the updated list.
 * Mirrors services/team.ts addTeamMember minus the on-chain updateEditors
 * transaction (see EditorListUpdate).
 */
export async function addEditorCommand(
  tag: string,
  address: string,
  options: { role?: number; email?: string } = {}
): Promise<EditorListUpdate> {
  const { role = EDITOR_ROLE_EDITOR, email } = options;
  if (!ADDRESS_RE.test(address || "")) throw new Error("Invalid Ethereum address");
  const normalized = address.toLowerCase();
  const list = await loadEditorList(tag);
  if (list.some((e) => e.address.toLowerCase() === normalized)) {
    throw new Error("Address is already an editor");
  }
  if (list.length >= MAX_EDITORS_PER_TOKEN) {
    throw new Error(
      `Editor limit reached (maximum ${MAX_EDITORS_PER_TOKEN} members)`
    );
  }
  const next = [
    ...list,
    { address: normalized, role, ...(email ? { email } : {}) },
  ];
  return _persistEditorList(tag, next);
}

/**
 * Remove an editor from a token's editor list and persist the updated list.
 * Mirrors services/team.ts removeTeamMember minus the on-chain updateEditors
 * transaction (see EditorListUpdate).
 */
export async function removeEditorCommand(
  tag: string,
  address: string
): Promise<EditorListUpdate> {
  if (!ADDRESS_RE.test(address || "")) throw new Error("Invalid Ethereum address");
  const normalized = address.toLowerCase();
  const list = await loadEditorList(tag);
  const next = list.filter((e) => e.address.toLowerCase() !== normalized);
  if (next.length === list.length) {
    throw new Error("Address is not an editor");
  }
  if (next.length === 0) {
    throw new Error("Cannot remove the last editor");
  }
  return _persistEditorList(tag, next);
}

/**
 * List the current editors of a token (IPFS list with local cache fallback).
 */
export async function listEditorsCommand(tag: string): Promise<EditorEntry[]> {
  return loadEditorList(tag);
}

// ─── Proof command ─────────────────────────────────────────────────────────

export async function buildEditorProof(
  tag: string,
  editorAddress: string
): Promise<{ proof: string[]; role: number } | null> {
  const [versionResult, listResult] = await Promise.allSettled([
    getEditorSetVersion(tag),
    loadEditorList(tag),
  ]);

  const version = versionResult.status === "fulfilled" ? versionResult.value : 1;
  const list = listResult.status === "fulfilled" ? listResult.value : [];

  return getProof(list, editorAddress, tag, version);
}

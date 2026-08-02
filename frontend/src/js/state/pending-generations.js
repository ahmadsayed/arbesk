/**
 * Pending-generation store.
 *
 * Tracks generation results that have been uploaded to IPFS but not yet sent
 * to the Studio viewport. Each record backs one asset chat bubble; its status
 * moves "pending" → "sent" | "discarded". Pure in-memory state — no events,
 * no persistence (a page reload drops undecided generations, same as any
 * unsaved Studio state).
 */

/**
 * @typedef {Object} PendingGeneration
 * @property {string} id
 * @property {string} assetManifestCid
 * @property {string} sourceAssetCid
 * @property {string} prompt
 * @property {string} [format]
 * @property {string} [path]
 * @property {string|null} prevAssetManifestCid
 * @property {number[]} [transformMatrix]
 * @property {number} [tier]
 * @property {string} [provider] - generation provider ("mock", "tripo3d")
 * @property {string} [task] - AI task kind ("model", "texture", "animate")
 * @property {string} [taskId] - provider-side task id (e.g. Tripo); chat provenance only
 * @property {string} [backendTaskId] - backend registry task id; animate-chain source
 * @property {boolean} [recorded] - true once written into a saved manifest version
 * @property {"pending"|"sent"|"discarded"} status
 */

/** @type {Map<string, PendingGeneration>} */
const records = new Map();
let nextId = 1;

/**
 * Register a new pending generation.
 * @param {Omit<PendingGeneration, "id" | "status">} data
 * @returns {string} the new record id
 */
export function addPendingGeneration(data) {
  const id = `gen_${nextId++}`;
  records.set(id, { ...data, id, status: "pending" });
  return id;
}

/**
 * Look up a record by id.
 * @param {string} id
 * @returns {PendingGeneration | null}
 */
export function getPendingGeneration(id) {
  return records.get(id) || null;
}

/**
 * Patch a record in place. No-op for unknown ids.
 * @param {string} id
 * @param {Partial<PendingGeneration>} patch
 */
export function updatePendingGeneration(id, patch) {
  const record = records.get(id);
  if (record) records.set(id, { ...record, ...patch });
}

/**
 * List all records in insertion order.
 * @returns {PendingGeneration[]}
 */
export function listPendingGenerations() {
  return [...records.values()];
}

/** Reset the store. Used by Clear Chat and tests. */
export function _resetPendingGenerations() {
  records.clear();
  nextId = 1;
}

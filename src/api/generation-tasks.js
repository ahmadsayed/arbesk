import { randomUUID } from "crypto";

const TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * @typedef {object} TaskEntry
 * @property {string} tripoTaskId
 * @property {string} providerKey
 * @property {string} userAddress
 * @property {number} createdAt
 * @property {"running"|"complete"} status
 * @property {"generate"|"animate"} [kind] - animate entries run a rig chain
 * @property {"rig-check"|"rig"|"retarget"} [phase] - current chain phase
 * @property {string[]} [animations] - requested retarget presets
 * @property {boolean} [rigOnly] - stop after the rig step (no retarget)
 * @property {string} [sourceFileToken] - Tripo file_token of the source GLB (animate chain)
 */

/** @type {Map<string, TaskEntry>} */
const registry = new Map();

// Sweep expired entries every 5 minutes; unref so it does not keep tests alive.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (now - entry.createdAt > TTL_MS) registry.delete(id);
  }
}, 5 * 60 * 1000);
if (sweep.unref) sweep.unref();

/**
 * Register a new in-flight generation task.
 * @param {{ tripoTaskId: string; providerKey: string; userAddress: string; kind?: "generate"|"animate"; phase?: "rig-check"|"rig"|"retarget"; animations?: string[]; rigOnly?: boolean; sourceFileToken?: string }} entry
 * @returns {string} public taskId
 */
export function registerTask({
  tripoTaskId,
  providerKey,
  userAddress,
  kind,
  phase,
  animations,
  rigOnly,
  sourceFileToken,
}) {
  const taskId = randomUUID();
  registry.set(taskId, {
    tripoTaskId,
    providerKey,
    userAddress,
    createdAt: Date.now(),
    status: "running",
    ...(kind && { kind }),
    ...(phase && { phase }),
    ...(animations && { animations }),
    ...(rigOnly && { rigOnly }),
    ...(sourceFileToken && { sourceFileToken }),
  });
  return taskId;
}

/**
 * Patch a running task entry (e.g. advance an animate chain to its next
 * phase). No-op when the entry is missing or owned by another wallet.
 * @param {string} taskId
 * @param {string} userAddress
 * @param {Partial<TaskEntry>} patch
 */
export function updateTaskEntry(taskId, userAddress, patch) {
  const entry = registry.get(taskId);
  if (!entry || entry.userAddress !== userAddress) return;
  Object.assign(entry, patch);
}

/**
 * Look up a running task entry. Returns undefined if expired, missing,
 * already complete, or owned by a different wallet address.
 * @param {string} taskId
 * @param {string} userAddress
 * @returns {TaskEntry | undefined}
 */
export function getTask(taskId, userAddress) {
  const entry = registry.get(taskId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    registry.delete(taskId);
    return undefined;
  }
  if (entry.userAddress !== userAddress) return undefined;
  if (entry.status !== "running") return undefined;
  return entry;
}

/**
 * Mark a running task as complete. Refreshes the TTL window so the entry
 * remains available as a refine source for a full TTL after completion.
 * @param {string} taskId
 * @param {string} userAddress
 */
export function markTaskComplete(taskId, userAddress) {
  const entry = registry.get(taskId);
  if (!entry || entry.userAddress !== userAddress) return;
  entry.status = "complete";
  entry.createdAt = Date.now();
}

/**
 * Look up a completed task entry (refine source). Returns undefined if
 * missing, expired, not complete, or owned by a different wallet.
 * @param {string} taskId
 * @param {string} userAddress
 * @returns {TaskEntry | undefined}
 */
export function getCompletedTask(taskId, userAddress) {
  const entry = registry.get(taskId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    registry.delete(taskId);
    return undefined;
  }
  if (entry.userAddress !== userAddress) return undefined;
  if (entry.status !== "complete") return undefined;
  return entry;
}

/**
 * Remove an entry (e.g. after terminal state).
 * @param {string} taskId
 */
export function evictTask(taskId) {
  registry.delete(taskId);
}

/** Test helper: clear registry. */
export function _resetRegistry() {
  registry.clear();
}

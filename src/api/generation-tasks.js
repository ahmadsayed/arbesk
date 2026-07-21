import { randomUUID } from "crypto";

const TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * @typedef {object} TaskEntry
 * @property {string} tripoTaskId
 * @property {string} providerKey
 * @property {string} userAddress
 * @property {number} createdAt
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
 * @param {{ tripoTaskId: string; providerKey: string; userAddress: string }} entry
 * @returns {string} public taskId
 */
export function registerTask({ tripoTaskId, providerKey, userAddress }) {
  const taskId = randomUUID();
  registry.set(taskId, {
    tripoTaskId,
    providerKey,
    userAddress,
    createdAt: Date.now(),
  });
  return taskId;
}

/**
 * Look up a task entry. Returns undefined if expired, missing, or owned by a
 * different wallet address.
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

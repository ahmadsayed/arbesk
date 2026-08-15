import { randomUUID } from "crypto";

const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface TaskEntry {
  tripoTaskId: string;
  providerKey: string;
  userAddress: string;
  createdAt: number;
  status: "running" | "complete";
  /** animate entries run a rig chain */
  kind?: "generate" | "animate";
  /** current chain phase */
  phase?: "rig-check" | "rig" | "retarget";
  /** requested retarget presets */
  animations?: string[];
  /** stop after the rig step (no retarget) */
  rigOnly?: boolean;
  /** retarget with animate_in_place */
  animateInPlace?: boolean;
  /** Tripo rig model used for the rig step (v1.0 biped rigs take preset:biped:* retarget IDs) */
  rigModel?: string;
  /** Tripo file_token of the source GLB (animate chain) */
  sourceFileToken?: string;
}

export interface RegisterTaskInput {
  tripoTaskId: string;
  providerKey: string;
  userAddress: string;
  kind?: "generate" | "animate";
  phase?: "rig-check" | "rig" | "retarget";
  animations?: string[];
  rigOnly?: boolean;
  animateInPlace?: boolean;
  rigModel?: string;
  sourceFileToken?: string;
}

const registry = new Map<string, TaskEntry>();

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
 * @returns public taskId
 */
export function registerTask({
  tripoTaskId,
  providerKey,
  userAddress,
  kind,
  phase,
  animations,
  rigOnly,
  animateInPlace,
  rigModel,
  sourceFileToken,
}: RegisterTaskInput): string {
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
    ...(animateInPlace && { animateInPlace }),
    ...(rigModel && { rigModel }),
    ...(sourceFileToken && { sourceFileToken }),
  });
  return taskId;
}

/**
 * Patch a running task entry (e.g. advance an animate chain to its next
 * phase). No-op when the entry is missing or owned by another wallet.
 */
export function updateTaskEntry(
  taskId: string,
  userAddress: string,
  patch: Partial<TaskEntry>,
): void {
  const entry = registry.get(taskId);
  if (!entry || entry.userAddress !== userAddress) return;
  Object.assign(entry, patch);
}

/**
 * Look up a running task entry. Returns undefined if expired, missing,
 * already complete, or owned by a different wallet address.
 */
export function getTask(taskId: string, userAddress: string): TaskEntry | undefined {
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
 */
export function markTaskComplete(taskId: string, userAddress: string): void {
  const entry = registry.get(taskId);
  if (!entry || entry.userAddress !== userAddress) return;
  entry.status = "complete";
  entry.createdAt = Date.now();
}

/**
 * Look up a completed task entry (refine source). Returns undefined if
 * missing, expired, not complete, or owned by a different wallet.
 */
export function getCompletedTask(
  taskId: string,
  userAddress: string,
): TaskEntry | undefined {
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
 */
export function evictTask(taskId: string): void {
  registry.delete(taskId);
}

/** Test helper: clear registry. */
export function _resetRegistry(): void {
  registry.clear();
}

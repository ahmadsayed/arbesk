/**
 * Pending-generation store.
 *
 * Tracks generation results that have been uploaded to IPFS but not yet sent
 * to the Studio viewport. Each record backs one asset chat bubble; its status
 * moves "pending" → "sent" | "discarded". Pure in-memory state — no events,
 * no persistence (a page reload drops undecided generations, same as any
 * unsaved Studio state).
 */

export interface PendingGeneration {
  id: string;
  /** null for viewport drops (unsaved model already in the Studio) */
  assetManifestCid: string | null;
  sourceAssetCid: string;
  prompt: string;
  format?: string;
  path?: string;
  prevAssetManifestCid: string | null;
  transformMatrix?: number[];
  tier?: number;
  /** generation provider ("mock", "tripo3d") */
  provider?: string;
  /** AI task kind ("model", "texture", "animate") */
  task?: string;
  /** provider-side task id (e.g. Tripo); chat provenance only */
  taskId?: string;
  /** backend registry task id; animate-chain source */
  backendTaskId?: string;
  /** Tripo rig model version used (v1.0-20240301 or v2.5-20260210) */
  rigModel?: string;
  /** true once written into a saved manifest version */
  recorded?: boolean;
  status: "pending" | "sent" | "discarded";
}

const records = new Map<string, PendingGeneration>();
let nextId = 1;

/**
 * Register a new pending generation.
 * @returns the new record id
 */
export function addPendingGeneration(
  data: Omit<PendingGeneration, "id" | "status">
): string {
  const id = `gen_${nextId++}`;
  records.set(id, { ...data, id, status: "pending" });
  return id;
}

/**
 * Look up a record by id.
 */
export function getPendingGeneration(id: string): PendingGeneration | null {
  return records.get(id) || null;
}

/**
 * Patch a record in place. No-op for unknown ids.
 */
export function updatePendingGeneration(
  id: string,
  patch: Partial<PendingGeneration>
): void {
  const record = records.get(id);
  if (record) records.set(id, { ...record, ...patch });
}

/**
 * List all records in insertion order.
 */
export function listPendingGenerations(): PendingGeneration[] {
  return [...records.values()];
}

/** Reset the store. Used by Clear Chat and tests. */
export function _resetPendingGenerations(): void {
  records.clear();
  nextId = 1;
}

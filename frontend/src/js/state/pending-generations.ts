/**
 * Pending-generation store.
 * @remarks Pure in-memory with no events or persistence — a page reload drops
 *   undecided generations, like any unsaved Studio state.
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
 * @returns the new record id
 */
export function addPendingGeneration(
  data: Omit<PendingGeneration, "id" | "status">
): string {
  const id = `gen_${nextId++}`;
  records.set(id, { ...data, id, status: "pending" });
  return id;
}

export function getPendingGeneration(id: string): PendingGeneration | null {
  return records.get(id) || null;
}

/**
 * @remarks No-op for unknown ids.
 */
export function updatePendingGeneration(
  id: string,
  patch: Partial<PendingGeneration>
): void {
  const record = records.get(id);
  if (record) records.set(id, { ...record, ...patch });
}

/**
 * @remarks Records are listed in insertion order.
 */
export function listPendingGenerations(): PendingGeneration[] {
  return [...records.values()];
}

export function _resetPendingGenerations(): void {
  records.clear();
  nextId = 1;
}

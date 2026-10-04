/**
 * One path for every transform change the user makes in the viewport
 * (gizmo drags, Drop to floor, Reset transform): stage the moved nodes for
 * Save and record a single undo entry.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "./state.ts";
import { stageNodeTransform, readNodeTransformMatrix, matricesEqual } from "./transforms.ts";
import { pushUndoEntry } from "./undo-stack.ts";

export type MatrixSnapshot = Array<{ nodeId: string; matrix: number[] }>;

/**
 * Node ids the viewport tools act on: the multi-selection when present,
 * otherwise the single highlighted node.
 */
export function selectedIds(): string[] {
  if (state.selectedNodeIds.size > 0) return [...state.selectedNodeIds];
  return state.highlightedNodeId ? [state.highlightedNodeId] : [];
}

export function snapshotMatrices(ids: string[]): MatrixSnapshot {
  const out: MatrixSnapshot = [];
  for (const nodeId of ids) {
    const matrix = readNodeTransformMatrix(nodeId);
    if (matrix) out.push({ nodeId, matrix });
  }
  return out;
}

/**
 * Stages and records every node whose matrix changed since `before`.
 * @remarks Unmoved nodes are not staged, so a click without a drag never
 *   marks the asset as having unsaved changes.
 * @returns the ids that moved.
 */
export function commitTransformChange(
  label: string,
  before: MatrixSnapshot | null
): string[] {
  const items = [];
  for (const { nodeId, matrix } of before || []) {
    const after = readNodeTransformMatrix(nodeId);
    if (after && !matricesEqual(matrix, after)) items.push({ nodeId, before: matrix, after });
  }
  if (items.length === 0) return [];
  const ids = items.map((i) => i.nodeId);
  for (const id of ids) stageNodeTransform(id);
  emit(EVENTS.TRANSFORM_STAGED, { nodeIds: ids });
  pushUndoEntry({ type: "transform", label, items });
  return ids;
}

/**
 * Single answer to "does the open asset have edits that Save would write?".
 * @remarks Pessimistic by design: undo re-stages rather than unstages, so
 *   the answer only returns to false after Save draft / Publish or a scene
 *   reload. Modules that keep their own pending store (source colours,
 *   metadata annotations) register it with registerPendingSource.
 */
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { state } from "../engine/state.ts";

const _sources = new Set<() => boolean>();

/**
 * Adds a pending-edit store to the unsaved check.
 * @returns an unregister function.
 */
export function registerPendingSource(fn: () => boolean): () => void {
  _sources.add(fn);
  return () => {
    _sources.delete(fn);
  };
}

function _stateHasPending(): boolean {
  return (
    state.pendingTransformEdits.size > 0 ||
    state.pendingChildRefs.length > 0 ||
    state.pendingChildRefRemovals.size > 0 ||
    state.pendingPostProcessorEdits.size > 0 ||
    state.pendingSourceOverrides.size > 0
  );
}

export function hasUnsavedChanges(): boolean {
  if (_stateHasPending()) return true;
  for (const fn of _sources) if (fn()) return true;
  return false;
}

/** Call after any write to a pending-edit collection. */
export function notifyPendingEditsChanged(): void {
  emit(EVENTS.PENDING_EDITS_CHANGED);
}

/**
 * `beforeunload` handler: asks the browser to confirm leaving while edits
 * are unsaved (including mid-save — pending state clears only on success).
 */
export function onBeforeUnload(e: {
  preventDefault(): void;
  returnValue?: unknown;
}): void {
  if (!hasUnsavedChanges()) return;
  e.preventDefault();
  // Legacy browsers only show the prompt when returnValue is set.
  e.returnValue = "";
}

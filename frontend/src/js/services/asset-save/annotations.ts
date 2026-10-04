/**
 * Pending-annotations store.
 * @remarks Holds the full annotations map (prior + edits), baked into the
 *   manifest on save.
 */
import {
  notifyPendingEditsChanged,
  registerPendingSource,
} from "../../state/unsaved-changes.ts";

let pending: Record<string, unknown> | null = null;
registerPendingSource(() => pending !== null);

export function getPendingAnnotations(): Record<string, unknown> | null {
  return pending;
}

export function setPendingAnnotations(a: Record<string, unknown> | null): void {
  pending = a;
  notifyPendingEditsChanged();
}

export function clearPendingAnnotations(): void {
  pending = null;
  notifyPendingEditsChanged();
}

/**
 * Pending-annotations store.
 * @remarks Holds the full annotations map (prior + edits), baked into the
 *   manifest on save.
 */
let pending: Record<string, unknown> | null = null;

export function getPendingAnnotations(): Record<string, unknown> | null {
  return pending;
}

export function setPendingAnnotations(a: Record<string, unknown> | null): void {
  pending = a;
}

export function clearPendingAnnotations(): void {
  pending = null;
}

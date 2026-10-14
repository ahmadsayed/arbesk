/**
 * Confirm before replacing the open asset when it has unsaved edits.
 * @remarks Resolves true straight away when there is nothing to lose (no
 *   edit rights, or no staged edits), so callers can await it unconditionally.
 */
import { canEdit } from "../state/edit-mode.ts";
import { hasUnsavedOrUnpublished } from "../state/draft-status.ts";
import { showConfirmDialog } from "./dialog.ts";

export async function confirmDiscardChanges(): Promise<boolean> {
  if (!(canEdit() && hasUnsavedOrUnpublished())) return true;
  const choice = await showConfirmDialog(
    "Open another asset?",
    "Unsaved changes to the open asset will be lost.",
    [
      { text: "Cancel", value: "cancel" },
      { text: "Open", value: "open" },
    ],
  );
  return choice === "open";
}

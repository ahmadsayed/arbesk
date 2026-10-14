/**
 * Confirm before replacing the open asset when it has unsaved edits or an
 * unpublished draft.
 * @remarks Resolves true straight away when there is nothing to lose (no
 *   edit rights, no staged edits, no unpublished draft), so callers can await
 *   it unconditionally.
 */
import { canEdit } from "../state/edit-mode.ts";
import { hasUnsavedOrUnpublished } from "../state/draft-status.ts";
import { hasUnsavedChanges } from "../state/unsaved-changes.ts";
import { showConfirmDialog } from "./dialog.ts";

const UNSAVED_BODY = "Unsaved changes to the open asset will be lost.";
const UNPUBLISHED_BODY =
  "Your draft isn't published yet. Opening another asset leaves it unpublished.";

export async function confirmDiscardChanges(): Promise<boolean> {
  if (!(canEdit() && hasUnsavedOrUnpublished())) return true;
  const choice = await showConfirmDialog(
    "Open another asset?",
    hasUnsavedChanges() ? UNSAVED_BODY : UNPUBLISHED_BODY,
    [
      { text: "Cancel", value: "cancel" },
      { text: "Open", value: "open" },
    ],
  );
  return choice === "open";
}

/**
 * Global keyboard shortcuts must not fire while the user types.
 * @remarks The one shared guard for new shortcut handlers (edit-ui rule 3);
 *   older modules still carry private copies.
 */
const FIELD_TAGS = new Set(["input", "textarea", "select"]);

/** True when focus is in a text field, select or contentEditable element. */
export function isTypingInField(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || FIELD_TAGS.has(el.tagName.toLowerCase());
}

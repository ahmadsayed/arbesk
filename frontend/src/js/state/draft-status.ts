/**
 * Tracks "a draft was saved but not published yet" for the open asset.
 * @remarks A saved draft is unsaved work as far as the leave-page guard is
 *   concerned, and it makes the header read "Draft" instead of "Published".
 *   Reset whenever an asset opens (SCENE_READY), closes, or a new draft
 *   starts (SCENE_EMPTY) — both events fire on every such path.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { notifyPendingEditsChanged, registerPendingSource } from "./unsaved-changes.ts";

let _unpublishedDraft = false;

export function hasUnpublishedDraft(): boolean {
  return _unpublishedDraft;
}

function _set(value: boolean): void {
  if (_unpublishedDraft === value) return;
  _unpublishedDraft = value;
  notifyPendingEditsChanged();
}

/** A draft manifest was written without updating the token. */
export function markDraftSaved(): void {
  _set(true);
}

/** The token now points at the latest saved manifest. */
export function markPublished(): void {
  _set(false);
}

/** A different asset opened, the asset closed, or a new draft started. */
export function resetDraftStatus(): void {
  _set(false);
}

registerPendingSource(hasUnpublishedDraft);
on(EVENTS.SCENE_EMPTY, resetDraftStatus);
on(EVENTS.SCENE_READY, resetDraftStatus);

import { beforeEach, expect, test } from "bun:test";
import { state } from "../../frontend/src/js/engine/state.js";
import { hasUnsavedChanges } from "../../frontend/src/js/state/unsaved-changes.js";
import {
  hasUnpublishedDraft,
  markDraftSaved,
  markPublished,
  resetDraftStatus,
} from "../../frontend/src/js/state/draft-status.js";

beforeEach(() => {
  state.pendingTransformEdits = new Map();
  resetDraftStatus();
});

test("saved draft is unpublished until published", () => {
  expect(hasUnpublishedDraft()).toBe(false);
  markDraftSaved();
  expect(hasUnpublishedDraft()).toBe(true);
  markPublished();
  expect(hasUnpublishedDraft()).toBe(false);
});

test("reset clears it", () => {
  markDraftSaved();
  resetDraftStatus();
  expect(hasUnpublishedDraft()).toBe(false);
});

test("hasUnsavedChanges is true after markDraftSaved", () => {
  expect(hasUnsavedChanges()).toBe(false);
  markDraftSaved();
  expect(hasUnsavedChanges()).toBe(true);
});

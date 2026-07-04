/**
 * Dialog contract tests.
 *
 * Lock in the public API behaviour of showDialog / showConfirmDialog /
 * showInfoDialog so the focus-trap refactor (issue #23) has a safety net.
 *
 * window.focusTrap is provided by MockFocusTrap - a minimal stand-in that
 * mirrors the createFocusTrap API the wrapper will use after the refactor,
 * so the CDN script is not required at test time. The current implementation
 * ignores window.focusTrap entirely, so its presence does not affect the
 * pre-refactor run.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach, afterEach } from "@jest/globals";
import { showDialog, showConfirmDialog, showInfoDialog, showForkOrLiveRefDialog } from "../../frontend/src/js/ui/dialog.js";

// ─── MockFocusTrap ────────────────────────────────────────────────────────────
// Minimal stand-in for window.focusTrap (loaded via CDN in studio.pug).
// activate() honours initialFocus so "initial focus" tests work after refactor.

class MockTrap {
  constructor(el, opts = {}) {
    this._opts = opts;
  }
  activate() {
    const target = this._opts.initialFocus;
    if (target) {
      const el = typeof target === "function" ? target() : target;
      el?.focus();
    }
    return this;
  }
  deactivate() { return this; }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  global.focusTrap = { createFocusTrap: (el, opts) => new MockTrap(el, opts) };
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  // Remove any dialogs left open by a failing test
  document.querySelectorAll(".dialog-backdrop").forEach((el) => el.remove());
  jest.runAllTimers();
  jest.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pressKey(target, key, extra = {}) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
}

// ─── showDialog ───────────────────────────────────────────────────────────────

test("showDialog renders the title", () => {
  showDialog("Name Your Asset", "Enter a name:");
  expect(document.body.textContent).toContain("Name Your Asset");
});

test("showDialog renders the body text", () => {
  showDialog("Title", "Please enter something");
  expect(document.body.textContent).toContain("Please enter something");
});

test("showDialog pre-fills the input with defaultValue", () => {
  showDialog("Title", "Body", "My Default");
  expect(document.querySelector(".dialog-input").value).toBe("My Default");
});

test("showDialog resolves with trimmed input when Confirm is clicked", async () => {
  const p = showDialog("Title", "Body", "");
  document.querySelector(".dialog-input").value = "  hello world  ";
  document.querySelector(".dialog-confirm-btn").click();
  expect(await p).toBe("hello world");
});

test("showDialog resolves null when Cancel is clicked", async () => {
  const p = showDialog("Title", "Body");
  document.querySelector(".dialog-cancel-btn").click();
  expect(await p).toBeNull();
});

test("showDialog resolves null when Escape is pressed", async () => {
  const p = showDialog("Title", "Body");
  pressKey(document, "Escape");
  expect(await p).toBeNull();
});

test("showDialog resolves null when the backdrop is clicked", async () => {
  const p = showDialog("Title", "Body");
  document.querySelector(".dialog-backdrop").click();
  expect(await p).toBeNull();
});

test("showDialog resolves null when input is blank and Confirm is clicked", async () => {
  const p = showDialog("Title", "Body", "");
  document.querySelector(".dialog-input").value = "   ";
  document.querySelector(".dialog-confirm-btn").click();
  expect(await p).toBeNull();
});

test("showDialog resolves with value when Enter is pressed in the input", async () => {
  const p = showDialog("Title", "Body", "");
  document.querySelector(".dialog-input").value = "entered via enter";
  pressKey(document.querySelector(".dialog-input"), "Enter");
  expect(await p).toBe("entered via enter");
});

test("showDialog removes the dialog from DOM after resolution", async () => {
  const p = showDialog("Title", "Body");
  document.querySelector(".dialog-cancel-btn").click();
  await p;
  expect(document.querySelector(".dialog-backdrop")).toBeNull();
});

test("showDialog appends the backdrop to document.body so it layers above page content", () => {
  showDialog("Title", "Body");
  const backdrop = document.querySelector(".dialog-backdrop");
  expect(backdrop).not.toBeNull();
  expect(backdrop.parentElement).toBe(document.body);
  expect(document.body.lastElementChild).toBe(backdrop);
});

test("a second dialog layers above the first by being appended later", async () => {
  const p1 = showDialog("First", "Body");
  const firstBackdrop = document.querySelector(".dialog-backdrop");
  const p2 = showDialog("Second", "Body");
  const backdrops = document.querySelectorAll(".dialog-backdrop");
  expect(backdrops).toHaveLength(2);
  expect(document.body.lastElementChild).toBe(backdrops[1]);
  expect(backdrops[1]).not.toBe(firstBackdrop);
  backdrops.forEach((b) => b.querySelector(".dialog-cancel-btn").click());
  await Promise.all([p1, p2]);
});

test("showDialog does not resolve twice if closed twice", async () => {
  let calls = 0;
  const p = showDialog("Title", "Body").then((v) => { calls++; return v; });
  document.querySelector(".dialog-cancel-btn").click();
  pressKey(document, "Escape"); // second close - should be a no-op
  await p;
  expect(calls).toBe(1);
});

test("showDialog places initial focus on the text input", async () => {
  const p = showDialog("Title", "Body", "");
  jest.runAllTimers(); // flush requestAnimationFrame / focus-trap activate
  expect(document.activeElement).toBe(document.querySelector(".dialog-input"));
  document.querySelector(".dialog-cancel-btn").click();
  await p;
});

// ─── showConfirmDialog ────────────────────────────────────────────────────────

test("showConfirmDialog resolves with the clicked button's value", async () => {
  const p = showConfirmDialog("Are you sure?", "This cannot be undone.", [
    { text: "Cancel", value: "cancel" },
    { text: "Delete", value: "delete" },
  ]);
  const [, deleteBtn] = document.querySelectorAll(".dialog-action-btn");
  deleteBtn.click();
  expect(await p).toBe("delete");
});

test("showConfirmDialog resolves null when Escape is pressed", async () => {
  const p = showConfirmDialog("Sure?", "Body");
  pressKey(document, "Escape");
  expect(await p).toBeNull();
});

test("showConfirmDialog renders default Cancel/Confirm buttons when none supplied", () => {
  showConfirmDialog("Confirm?", "Are you sure?");
  const btns = [...document.querySelectorAll(".dialog-action-btn")];
  const labels = btns.map((b) => b.textContent.trim());
  expect(labels).toContain("Cancel");
  expect(labels).toContain("Confirm");
});

test("showConfirmDialog removes the dialog from DOM after resolution", async () => {
  const p = showConfirmDialog("Title", "Body");
  pressKey(document, "Escape");
  await p;
  expect(document.querySelector(".dialog-backdrop")).toBeNull();
});

// ─── showInfoDialog ───────────────────────────────────────────────────────────

test("showInfoDialog renders the title", () => {
  showInfoDialog("Keyboard Shortcuts", "<p>Press Ctrl+Z to undo</p>");
  expect(document.body.textContent).toContain("Keyboard Shortcuts");
});

test("showInfoDialog resolves when Close is clicked", async () => {
  const p = showInfoDialog("Info", "<p>Done</p>");
  document.querySelector(".dialog-close-btn").click();
  await expect(p).resolves.not.toThrow();
});

test("showInfoDialog resolves when Escape is pressed", async () => {
  const p = showInfoDialog("Info", "<p>Done</p>");
  pressKey(document, "Escape");
  await expect(p).resolves.not.toThrow();
});

// ─── showForkOrLiveRefDialog ──────────────────────────────────────────────────

test("showForkOrLiveRefDialog offers both fork and live-ref by default", () => {
  showForkOrLiveRefDialog("asset_1");
  const labels = [...document.querySelectorAll(".dialog-actions button")].map(
    (b) => b.textContent.trim()
  );
  expect(labels).toContain("Fork (copy)");
  expect(labels).toContain("Live reference");
});

test("showForkOrLiveRefDialog hides live-ref when allowLiveRef is false", () => {
  showForkOrLiveRefDialog("asset_1", { allowLiveRef: false });
  const labels = [...document.querySelectorAll(".dialog-actions button")].map(
    (b) => b.textContent.trim()
  );
  expect(labels).toContain("Fork (copy)");
  expect(labels).not.toContain("Live reference");
});

test("showForkOrLiveRefDialog fork-only mode still resolves 'fork'", async () => {
  const p = showForkOrLiveRefDialog("asset_1", { allowLiveRef: false });
  [...document.querySelectorAll(".dialog-actions button")]
    .find((b) => b.textContent.trim() === "Fork (copy)")
    .click();
  expect(await p).toBe("fork");
});

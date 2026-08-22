/**
 * Dialog contract tests.
 *
 * Lock in the public API behaviour of showDialog / showConfirmDialog /
 * showInfoDialog / showForkOrLiveRefDialog / showCustomDialog /
 * showBurnCollectionDialog / showCheckboxDialog.
 *
 * Post-Alpine-migration, the dialog DOM lives in a persistent #appDialogHost
 * (mirrored from app.pug below) and rendering is asynchronous: tests flush
 * Alpine's queue (faked queueMicrotask + rAF) via flush() before asserting on
 * the DOM. window.focusTrap is provided by MockFocusTrap, so the CDN script
 * is not required at test time.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach, afterEach } from "@jest/globals";
import { DIALOG_HOST_FRAGMENT as HOST_FRAGMENT } from "../helpers/dialog-host.js";

// ─── MockFocusTrap ────────────────────────────────────────────────────────────
// Minimal stand-in for window.focusTrap (loaded via CDN in app.pug).
// activate() honours initialFocus so "initial focus" tests work.

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

// ─── Host fragment ────────────────────────────────────────────────────────────
// Shared fixture: mirrors the #appDialogHost fragment in
// frontend/src/pug/includes/dialog-host.pug byte-for-byte (the E2E + unit DOM
// contract). Lives in test/helpers/dialog-host.js so every dialog consumer
// test uses the same source.

// ─── Setup ────────────────────────────────────────────────────────────────────

/** @type {typeof import("../../frontend/src/js/ui/dialog.js")} */
let dialogMod;

// Re-exported per setup so test bodies read like the pre-migration ones.
let showDialog, showConfirmDialog, showInfoDialog, showForkOrLiveRefDialog,
  showCustomDialog, showBurnCollectionDialog, showCheckboxDialog;

/**
 * Flush Alpine's render queue and the focus-trap rAF. With fake timers both
 * queueMicrotask (Alpine's scheduler) and requestAnimationFrame are faked, so
 * jest.runAllTimers() drives them; Promise.resolve() drains real microtasks
 * (promise continuations).
 */
async function flush() {
  jest.runAllTimers();
  await Promise.resolve();
  jest.runAllTimers();
  await Promise.resolve();
}

async function setup() {
  jest.resetModules();
  document.body.innerHTML = HOST_FRAGMENT;
  global.focusTrap = { createFocusTrap: (el, opts) => new MockTrap(el, opts) };
  // Importing dialog.js registers the "dialog" component and starts Alpine
  // (document.readyState is already "complete" under jsdom).
  dialogMod = await import("../../frontend/src/js/ui/dialog.js");
  ({
    showDialog,
    showConfirmDialog,
    showInfoDialog,
    showForkOrLiveRefDialog,
    showCustomDialog,
    showBurnCollectionDialog,
    showCheckboxDialog,
  } = dialogMod);
  await flush();
}

beforeAll(() => {
  global.focusTrap = { createFocusTrap: (el, opts) => new MockTrap(el, opts) };
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  // Each setup() gets a fresh Alpine instance via jest.resetModules(); tear
  // down the one that just ran so its MutationObserver can't initialize the
  // next test's DOM before its own instance starts.
  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  document.body.innerHTML = "";
  jest.runAllTimers();
  jest.useRealTimers();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pressKey(target, key, extra = {}) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
}

// ─── showDialog ───────────────────────────────────────────────────────────────

test("showDialog renders the title", async () => {
  await setup();
  showDialog("Name Your Asset", "Enter a name:");
  await flush();
  expect(document.body.textContent).toContain("Name Your Asset");
});

test("showDialog renders the body text", async () => {
  await setup();
  showDialog("Title", "Please enter something");
  await flush();
  expect(document.body.textContent).toContain("Please enter something");
});

test("showDialog pre-fills the input with defaultValue", async () => {
  await setup();
  showDialog("Title", "Body", "My Default");
  await flush();
  expect(document.querySelector(".dialog-input").value).toBe("My Default");
});

test("showDialog resolves with trimmed input when Confirm is clicked", async () => {
  await setup();
  const p = showDialog("Title", "Body", "");
  await flush();
  document.querySelector(".dialog-input").value = "  hello world  ";
  document.querySelector(".dialog-confirm-btn").click();
  expect(await p).toBe("hello world");
});

test("showDialog resolves null when Cancel is clicked", async () => {
  await setup();
  const p = showDialog("Title", "Body");
  await flush();
  document.querySelector(".dialog-cancel-btn").click();
  expect(await p).toBeNull();
});

test("showDialog resolves null when Escape is pressed", async () => {
  await setup();
  const p = showDialog("Title", "Body");
  await flush();
  pressKey(document, "Escape");
  expect(await p).toBeNull();
});

test("showDialog resolves null when the backdrop is clicked", async () => {
  await setup();
  const p = showDialog("Title", "Body");
  await flush();
  document.querySelector(".dialog-backdrop").click();
  expect(await p).toBeNull();
});

test("showDialog resolves null when input is blank and Confirm is clicked", async () => {
  await setup();
  const p = showDialog("Title", "Body", "");
  await flush();
  document.querySelector(".dialog-input").value = "   ";
  document.querySelector(".dialog-confirm-btn").click();
  expect(await p).toBeNull();
});

test("showDialog resolves with value when Enter is pressed in the input", async () => {
  await setup();
  const p = showDialog("Title", "Body", "");
  await flush();
  document.querySelector(".dialog-input").value = "entered via enter";
  pressKey(document.querySelector(".dialog-input"), "Enter");
  expect(await p).toBe("entered via enter");
});

test("showDialog removes the dialog from DOM after resolution", async () => {
  await setup();
  const p = showDialog("Title", "Body");
  await flush();
  document.querySelector(".dialog-cancel-btn").click();
  await p;
  await flush();
  expect(document.querySelector(".dialog-backdrop")).toBeNull();
});

test("showDialog renders the backdrop inside the persistent #appDialogHost", async () => {
  await setup();
  showDialog("Title", "Body");
  await flush();
  const backdrop = document.querySelector(".dialog-backdrop");
  expect(backdrop).not.toBeNull();
  expect(document.getElementById("appDialogHost").contains(backdrop)).toBe(true);
});

test("concurrent dialogs queue FIFO and each resolves with its own result", async () => {
  await setup();
  const p1 = showDialog("First", "Body");
  const p2 = showDialog("Second", "Body");
  await flush();
  // One dialog at a time: the second request is parked while the first is open.
  expect(document.querySelectorAll(".dialog-backdrop")).toHaveLength(1);
  expect(document.body.textContent).toContain("First");
  expect(document.body.textContent).not.toContain("Second");

  document.querySelector(".dialog-cancel-btn").click();
  expect(await p1).toBeNull();
  await flush();

  // The queued dialog opens next, still a single backdrop.
  expect(document.querySelectorAll(".dialog-backdrop")).toHaveLength(1);
  expect(document.body.textContent).toContain("Second");
  document.querySelector(".dialog-input").value = "second answer";
  document.querySelector(".dialog-confirm-btn").click();
  expect(await p2).toBe("second answer");
});

test("showDialog does not resolve twice if closed twice", async () => {
  await setup();
  let calls = 0;
  const p = showDialog("Title", "Body").then((v) => { calls++; return v; });
  await flush();
  document.querySelector(".dialog-cancel-btn").click();
  pressKey(document, "Escape"); // second close - should be a no-op
  await p;
  expect(calls).toBe(1);
});

test("showDialog places initial focus on the text input", async () => {
  await setup();
  const p = showDialog("Title", "Body", "");
  await flush(); // render + requestAnimationFrame (focus-trap activate)
  expect(document.activeElement).toBe(document.querySelector(".dialog-input"));
  document.querySelector(".dialog-cancel-btn").click();
  await p;
});

// ─── showConfirmDialog ────────────────────────────────────────────────────────

test("showConfirmDialog resolves with the clicked button's value", async () => {
  await setup();
  const p = showConfirmDialog("Are you sure?", "This cannot be undone.", [
    { text: "Cancel", value: "cancel" },
    { text: "Delete", value: "delete" },
  ]);
  await flush();
  const [, deleteBtn] = document.querySelectorAll(".dialog-action-btn");
  deleteBtn.click();
  expect(await p).toBe("delete");
});

test("showConfirmDialog resolves null when Escape is pressed", async () => {
  await setup();
  const p = showConfirmDialog("Sure?", "Body");
  await flush();
  pressKey(document, "Escape");
  expect(await p).toBeNull();
});

test("showConfirmDialog renders default Cancel/Confirm buttons when none supplied", async () => {
  await setup();
  showConfirmDialog("Confirm?", "Are you sure?");
  await flush();
  const btns = [...document.querySelectorAll(".dialog-action-btn")];
  const labels = btns.map((b) => b.textContent.trim());
  expect(labels).toContain("Cancel");
  expect(labels).toContain("Confirm");
});

test("showConfirmDialog removes the dialog from DOM after resolution", async () => {
  await setup();
  const p = showConfirmDialog("Title", "Body");
  await flush();
  pressKey(document, "Escape");
  await p;
  await flush();
  expect(document.querySelector(".dialog-backdrop")).toBeNull();
});

// ─── showInfoDialog ───────────────────────────────────────────────────────────

test("showInfoDialog renders the title", async () => {
  await setup();
  showInfoDialog("Keyboard Shortcuts", "<p>Press Ctrl+Z to undo</p>");
  await flush();
  expect(document.body.textContent).toContain("Keyboard Shortcuts");
});

test("showInfoDialog resolves when Close is clicked", async () => {
  await setup();
  const p = showInfoDialog("Info", "<p>Done</p>");
  await flush();
  document.querySelector(".dialog-close-btn").click();
  await expect(p).resolves.not.toThrow();
});

test("showInfoDialog resolves when Escape is pressed", async () => {
  await setup();
  const p = showInfoDialog("Info", "<p>Done</p>");
  await flush();
  pressKey(document, "Escape");
  await expect(p).resolves.not.toThrow();
});

// ─── showForkOrLiveRefDialog ──────────────────────────────────────────────────

test("showForkOrLiveRefDialog offers both fork and live-ref by default", async () => {
  await setup();
  showForkOrLiveRefDialog("asset_1");
  await flush();
  const labels = [...document.querySelectorAll(".dialog-actions button")].map(
    (b) => b.textContent.trim()
  );
  expect(labels).toContain("Fork (copy)");
  expect(labels).toContain("Live reference");
});

test("showForkOrLiveRefDialog hides live-ref when allowLiveRef is false", async () => {
  await setup();
  showForkOrLiveRefDialog("asset_1", { allowLiveRef: false });
  await flush();
  const labels = [...document.querySelectorAll(".dialog-actions button")].map(
    (b) => b.textContent.trim()
  );
  expect(labels).toContain("Fork (copy)");
  expect(labels).not.toContain("Live reference");
});

test("showForkOrLiveRefDialog fork-only mode still resolves 'fork'", async () => {
  await setup();
  const p = showForkOrLiveRefDialog("asset_1", { allowLiveRef: false });
  await flush();
  [...document.querySelectorAll(".dialog-actions button")]
    .find((b) => b.textContent.trim() === "Fork (copy)")
    .click();
  expect(await p).toBe("fork");
});

// ─── showCustomDialog ─────────────────────────────────────────────────────────

test("showCustomDialog renders the caller-supplied body element", async () => {
  await setup();
  const body = document.createElement("div");
  body.textContent = "custom body content";
  showCustomDialog("Custom", body);
  await flush();
  expect(document.body.textContent).toContain("custom body content");
  expect(document.querySelector(".dialog-body").classList.contains("collaborator-dialog-body")).toBe(true);
});

test("showCustomDialog resolves null when Close is clicked", async () => {
  await setup();
  const body = document.createElement("div");
  const p = showCustomDialog("Custom", body);
  await flush();
  document.querySelector(".dialog-close-btn").click();
  expect(await p).toBeNull();
});

test("showCustomDialog resolves null when Escape is pressed", async () => {
  await setup();
  const body = document.createElement("div");
  const p = showCustomDialog("Custom", body);
  await flush();
  pressKey(document, "Escape");
  expect(await p).toBeNull();
});

test("showCustomDialog body can close the dialog early with a value via bodyEl.closeDialog", async () => {
  await setup();
  const body = document.createElement("div");
  body.innerHTML = `<button id="go" type="button">Go</button>`;
  const p = showCustomDialog("Custom", body);
  body.querySelector("#go").addEventListener("click", () => body.closeDialog(42));
  body.querySelector("#go").click();
  expect(await p).toBe(42);
  await flush();
  // Dialog is removed from the DOM — no lingering modal.
  expect(document.querySelector(".dialog-backdrop")).toBeNull();
});

test("showCustomDialog body-close is idempotent against a later Close/Escape", async () => {
  await setup();
  let calls = 0;
  const body = document.createElement("div");
  const p = showCustomDialog("Custom", body).then((v) => { calls++; return v; });
  await flush();
  body.closeDialog("first");
  document.querySelector(".dialog-close-btn")?.click(); // backdrop already closing
  pressKey(document, "Escape");
  expect(await p).toBe("first");
  expect(calls).toBe(1);
});

// ─── showBurnCollectionDialog ─────────────────────────────────────────────────

test("showBurnCollectionDialog keeps burn disabled until the typed name matches", async () => {
  await setup();
  const p = showBurnCollectionDialog("My Collection");
  await flush();
  const input = document.querySelector(".dialog-input");
  const burnBtn = document.querySelector(".dialog-burn-btn");
  expect(burnBtn.disabled).toBe(true);

  input.value = "nope";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  expect(burnBtn.disabled).toBe(true);

  input.value = "My Collection";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  expect(burnBtn.disabled).toBe(false);

  pressKey(input, "Enter"); // Enter confirms only while burn is enabled
  expect(await p).toBe("burn");
});

test("showBurnCollectionDialog Enter is a no-op while burn is disabled", async () => {
  await setup();
  let settled = false;
  const p = showBurnCollectionDialog("My Collection").then((v) => { settled = true; return v; });
  await flush();
  pressKey(document.querySelector(".dialog-input"), "Enter");
  await flush();
  expect(settled).toBe(false);
  document.querySelector(".dialog-cancel-btn").click();
  expect(await p).toBeNull();
});

// ─── showCheckboxDialog ───────────────────────────────────────────────────────

test("showCheckboxDialog enforces max on options that count toward it", async () => {
  await setup();
  const p = showCheckboxDialog(
    "Pick",
    "Choose up to one",
    [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "inplace", label: "In place", countsTowardMax: false },
    ],
    { max: 1 }
  );
  await flush();
  const boxes = [...document.querySelectorAll('.dialog-body input[type="checkbox"]')];
  expect(boxes).toHaveLength(3);
  boxes[0].click(); // check "a"
  boxes[1].click(); // refused - max 1 reached
  boxes[2].click(); // allowed - does not count toward max
  await flush();
  expect(boxes[0].checked).toBe(true);
  expect(boxes[1].checked).toBe(false);
  expect(boxes[2].checked).toBe(true);
  document.querySelector(".dialog-confirm-btn").click();
  expect(await p).toEqual(["a", "inplace"]);
});

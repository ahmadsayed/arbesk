/**
 * Toast notification contract tests.
 *
 * Tests run against the Notyf wrapper in toasts.js. window.Notyf is provided
 * by MockNotyf — a minimal in-memory stand-in that mirrors the subset of
 * Notyf's API the wrapper depends on, so the CDN script is not required.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach, afterEach } from "@jest/globals";
import { showToast, dismissToast, dismissAllToasts } from "../../frontend/src/js/ui/toasts.js";

// ─── MockNotyf ───────────────────────────────────────────────────────────────

class MockNotyf {
  constructor(config = {}) {
    this._notifications = [];
    // Real Notyf appends a <div class="notyf"> wrapper to <body>.
    this._el = document.createElement("div");
    this._el.className = "notyf";
    document.body.appendChild(this._el);
    // Map each registered type → its className so open() can mirror the real
    // library, which stamps the per-type className onto the toast element.
    this._typeClassNames = new Map(
      (config.types || []).map((t) => [t.type, t.className])
    );
  }

  open({ type = "info", message = "", duration = 6000 }) {
    const el = document.createElement("div");
    el.className = "notyf__toast";
    const typeClass = this._typeClassNames.get(type);
    if (typeClass) el.classList.add(typeClass);
    el.dataset.type = type;
    el.innerHTML = message;
    this._el.appendChild(el);

    const handlers = {};
    const notification = {
      el,
      on(event, cb) { handlers[event] = cb; return this; },
      _fire(event) { handlers[event]?.(); },
    };

    if (duration > 0) {
      notification._timerId = setTimeout(() => this.dismiss(notification), duration);
    }

    this._notifications.push(notification);
    return notification;
  }

  dismiss(notification) {
    const idx = this._notifications.indexOf(notification);
    if (idx === -1) return;
    this._notifications.splice(idx, 1);
    if (notification._timerId) clearTimeout(notification._timerId);
    notification.el.remove();
    notification._fire("dismiss");
  }

  dismissAll() {
    [...this._notifications].forEach((n) => this.dismiss(n));
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

function toastCount() {
  return document.querySelectorAll(".notyf__toast").length;
}

beforeAll(() => {
  global.Notyf = MockNotyf;
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  dismissAllToasts();
  jest.runAllTimers();
  jest.useRealTimers();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test("showToast renders a toast", () => {
  showToast({ type: "info", title: "Hello" });

  expect(toastCount()).toBe(1);
});

test("showToast returns a non-null string ID", () => {
  const id = showToast({ type: "success", title: "Saved" });

  expect(typeof id).toBe("string");
  expect(id.length).toBeGreaterThan(0);
});

test("showToast renders the title", () => {
  showToast({ type: "info", title: "My Title" });

  expect(document.querySelector(".notyf__toast").textContent).toContain("My Title");
});

test("showToast stamps the per-type className so SCSS can style accents", () => {
  // The CDN stylesheet is gone and custom Notyf types get no --type modifier,
  // so the wrapper must register an explicit className per type (toast--info,
  // toast--success, …) for the accent-border SCSS to match. Regression guard
  // for the toasts that rendered unstyled/off-screen.
  for (const type of ["info", "success", "warning", "error", "pending"]) {
    showToast({ type, title: type, duration: 0 });
    const el = document.querySelector(`.notyf__toast.toast--${type}`);
    expect(el).not.toBeNull();
    dismissAllToasts();
  }
});

test("showToast renders the optional message body", () => {
  showToast({ type: "info", title: "Title", message: "Details here" });

  expect(document.querySelector(".notyf__toast").textContent).toContain("Details here");
});

test("dismissToast removes only the targeted toast", () => {
  const id1 = showToast({ type: "info", title: "First", duration: 0 });
  showToast({ type: "info", title: "Second", duration: 0 });

  dismissToast(id1);

  expect(toastCount()).toBe(1);
  expect(document.querySelector(".notyf__toast").textContent).toContain("Second");
  expect(document.querySelector(".notyf__toast").textContent).not.toContain("First");
});

test("dismissToast is a no-op for an unknown ID", () => {
  showToast({ type: "info", title: "Alive", duration: 0 });

  expect(() => dismissToast("nonexistent-id")).not.toThrow();
  expect(toastCount()).toBe(1);
});

test("duration 0 keeps the toast open indefinitely", () => {
  showToast({ type: "error", title: "Persistent", duration: 0 });
  jest.advanceTimersByTime(60_000);

  expect(toastCount()).toBe(1);
});

test("positive duration auto-dismisses the toast after the timeout", () => {
  showToast({ type: "info", title: "Fleeting", duration: 3000 });
  jest.advanceTimersByTime(3000);

  expect(toastCount()).toBe(0);
});

test("action button fires the callback and dismisses the toast", () => {
  const onClick = jest.fn();
  showToast({
    type: "info",
    title: "With Action",
    duration: 0,
    actions: [{ label: "Retry", onClick }],
  });

  const actionBtn = document.querySelector(".toast-action");
  expect(actionBtn).not.toBeNull();
  actionBtn.click();

  expect(onClick).toHaveBeenCalledTimes(1);
  expect(toastCount()).toBe(0);
});

test("dismissAllToasts removes every active toast", () => {
  showToast({ type: "info", title: "One", duration: 0 });
  showToast({ type: "info", title: "Two", duration: 0 });
  showToast({ type: "info", title: "Three", duration: 0 });

  dismissAllToasts();

  expect(toastCount()).toBe(0);
});

test("MAX_TOASTS evicts the oldest toast when the sixth is added", () => {
  for (let i = 1; i <= 5; i++) {
    showToast({ type: "info", title: `Toast ${i}`, duration: 0 });
  }
  expect(toastCount()).toBe(5);

  showToast({ type: "info", title: "Toast 6", duration: 0 });

  expect(toastCount()).toBe(5);
  const texts = [...document.querySelectorAll(".notyf__toast")].map((el) => el.textContent).join("");
  expect(texts).not.toContain("Toast 1");
  expect(texts).toContain("Toast 6");
});

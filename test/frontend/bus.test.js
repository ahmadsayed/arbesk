/**
 * Event bus contract tests.
 *
 * Locks in the public API of bus.js (the mitt singleton) so the registry.js
 * replacement (issue #20) has a safety net.
 *
 * Key invariant: handlers registered with on() receive the payload DIRECTLY,
 * not wrapped in a CustomEvent - this is the main behavioural difference
 * from the old registry.js which used document.dispatchEvent.
 *
 * @jest-environment jsdom
 */

import { expect, test, beforeEach } from "@jest/globals";
import { on, off, emit, EVENTS } from "../../frontend/src/js/events/bus.js";

// ─── Setup ───────────────────────────────────────────────────────────────────
// mitt is a module-level singleton, so listeners registered in one test
// carry over to the next. Clean up after every test by unregistering.

let _cleanup = [];

beforeEach(() => {
  for (const [event, handler] of _cleanup) off(event, handler);
  _cleanup = [];
});

function track(event, handler) {
  on(event, handler);
  _cleanup.push([event, handler]);
  return handler;
}

// ─── EVENTS constants ─────────────────────────────────────────────────────────

test("EVENTS exports expected constants", () => {
  expect(typeof EVENTS.SCENE_READY).toBe("string");
  expect(typeof EVENTS.WALLET_CONNECTED).toBe("string");
  expect(typeof EVENTS.ASSET_PUBLISHED).toBe("string");
  expect(Object.keys(EVENTS).length).toBeGreaterThan(10);
});

// ─── on / emit ───────────────────────────────────────────────────────────────

test("handler receives payload directly (not via .detail)", () => {
  let received;
  track(EVENTS.SCENE_READY, (payload) => { received = payload; });

  emit(EVENTS.SCENE_READY, { manifest: { name: "test" }, manifestCid: "bafy123" });

  expect(received).toEqual({ manifest: { name: "test" }, manifestCid: "bafy123" });
  expect(received.detail).toBeUndefined(); // no CustomEvent wrapping
});

test("emit with no payload delivers undefined to handler", () => {
  let called = false;
  track(EVENTS.SCENE_CLEARED, () => { called = true; });

  emit(EVENTS.SCENE_CLEARED);

  expect(called).toBe(true);
});

test("emit with no listeners does not throw", () => {
  expect(() => emit(EVENTS.SCENE_EMPTY)).not.toThrow();
});

test("multiple listeners for the same event all receive the payload", () => {
  const received = [];
  track(EVENTS.NODE_SELECTED, (p) => received.push("a:" + p.nodeId));
  track(EVENTS.NODE_SELECTED, (p) => received.push("b:" + p.nodeId));

  emit(EVENTS.NODE_SELECTED, { nodeId: "node-1", mesh: null });

  expect(received).toEqual(["a:node-1", "b:node-1"]);
});

test("listeners for different events do not cross-fire", () => {
  const hits = [];
  track(EVENTS.NODE_SELECTED, () => hits.push("selected"));
  track(EVENTS.NODE_DESELECTED, () => hits.push("deselected"));

  emit(EVENTS.NODE_SELECTED, { nodeId: "x", mesh: null });

  expect(hits).toEqual(["selected"]);
});

// ─── off ─────────────────────────────────────────────────────────────────────

test("off removes a specific handler", () => {
  const calls = [];
  const handlerA = (_p) => calls.push("a");
  const handlerB = (_p) => calls.push("b");

  on(EVENTS.THEME_CHANGED, handlerA);
  on(EVENTS.THEME_CHANGED, handlerB);

  off(EVENTS.THEME_CHANGED, handlerA);
  _cleanup.push([EVENTS.THEME_CHANGED, handlerB]); // handlerA already removed

  emit(EVENTS.THEME_CHANGED, { theme: "dark" });

  expect(calls).toEqual(["b"]);
});

test("off is a no-op for an unregistered handler", () => {
  expect(() => off(EVENTS.SCENE_READY, () => {})).not.toThrow();
});

// ─── payload shape passthrough ────────────────────────────────────────────────

test("complex nested payloads are delivered intact", () => {
  let received;
  track(EVENTS.NESTING_DIVE_REQUESTED, (p) => { received = p; });

  const payload = { childRef: { type: "token", tokenId: "42" }, nodeId: "n1" };
  emit(EVENTS.NESTING_DIVE_REQUESTED, payload);

  expect(received).toBe(payload); // same reference, no copying
});

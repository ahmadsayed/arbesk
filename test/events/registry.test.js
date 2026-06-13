/**
 * @jest-environment jsdom
 */

import { jest } from "@jest/globals";
import {
  EVENTS,
  emit,
  on,
  _resetListenerCounts,
} from "../../frontend/src/js/events/registry.js";

beforeEach(() => {
  _resetListenerCounts();
});

// ─── EVENTS constants ────────────────────────────────────────────────────────

describe("EVENTS constants", () => {
  test("all values are non-empty strings", () => {
    for (const value of Object.values(EVENTS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("all 25 values are unique", () => {
    const values = Object.values(EVENTS);
    expect(new Set(values).size).toBe(25);
    expect(values).toHaveLength(25);
  });

  test("spot-check: EVENTS.SCENE_READY === 'scene:ready'", () => {
    expect(EVENTS.SCENE_READY).toBe("scene:ready");
  });

  test("spot-check: EVENTS.ASSET_BURNED === 'asset:burned'", () => {
    expect(EVENTS.ASSET_BURNED).toBe("asset:burned");
  });

  test("spot-check: EVENTS.WALLET_GENERATION_PAID === 'wallet:generationPaid'", () => {
    expect(EVENTS.WALLET_GENERATION_PAID).toBe("wallet:generationPaid");
  });
});

// ─── emit + on ───────────────────────────────────────────────────────────────

describe("emit + on", () => {
  test("handler registered with on() receives event dispatched by emit()", () => {
    const handler = jest.fn();
    on(EVENTS.SCENE_READY, handler);
    emit(EVENTS.SCENE_READY, { manifest: { name: "test" }, manifestCid: "Qm123" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      manifest: { name: "test" },
      manifestCid: "Qm123",
    });
    document.removeEventListener(EVENTS.SCENE_READY, handler);
  });

  test("emit() with no detail argument produces event with null detail", () => {
    const handler = jest.fn();
    on(EVENTS.NODE_DESELECTED, handler);
    emit(EVENTS.NODE_DESELECTED);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toBeNull();
    document.removeEventListener(EVENTS.NODE_DESELECTED, handler);
  });

  test("multiple on() handlers for the same event all fire", () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    on(EVENTS.WALLET_CONNECTED, h1);
    on(EVENTS.WALLET_CONNECTED, h2);
    emit(EVENTS.WALLET_CONNECTED, { walletAddress: "0xABC" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    document.removeEventListener(EVENTS.WALLET_CONNECTED, h1);
    document.removeEventListener(EVENTS.WALLET_CONNECTED, h2);
  });

  test("handler for event A does not fire when event B is emitted", () => {
    const handler = jest.fn();
    on(EVENTS.ASSET_BURNED, handler);
    emit(EVENTS.ASSET_PUBLISHED, { manifestCid: "Qm456", tokenId: "1" });
    expect(handler).not.toHaveBeenCalled();
    document.removeEventListener(EVENTS.ASSET_BURNED, handler);
  });
});

// ─── dev-mode orphan warning ─────────────────────────────────────────────────

describe("dev-mode orphan warning", () => {
  // jsdom sets location.hostname = "localhost" so _isDev is true in tests.

  test("warns when emitting an event with no registered listeners", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    emit(EVENTS.ASSET_CLEARED); // no on() registered for this event
    expect(warnSpy).toHaveBeenCalledWith(
      '[EVENTS] "asset:cleared" dispatched with no registered listeners'
    );
    warnSpy.mockRestore();
  });

  test("does not warn when at least one listener is registered", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    on(EVENTS.ASSET_CLEARED, () => {});
    emit(EVENTS.ASSET_CLEARED);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("registering listener for event A does not suppress warning for event B", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    on(EVENTS.SCENE_READY, () => {});
    emit(EVENTS.SCENE_EMPTY); // different event, no listener
    expect(warnSpy).toHaveBeenCalledWith(
      '[EVENTS] "scene:empty" dispatched with no registered listeners'
    );
    warnSpy.mockRestore();
  });
});

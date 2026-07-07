/**
 * @jest-environment jsdom
 */
import {
  jest,
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  createVersionClock,
  _angleForIndex,
} from "../../frontend/src/js/ui/version-clock.js";

const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c2", version: 2, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c3", version: 3, name: "T", nodeCount: 2, timestamp: null },
];

describe("version-clock face", () => {
  let clock, commits;

  beforeEach(() => {
    commits = [];
    clock = createVersionClock({ onCommit: (i) => commits.push(i) });
    document.body.appendChild(clock.el);
    clock.update({
      entries: ENTRIES,
      activeIndex: 2,
      publishedIndex: 1,
      loading: false,
    });
  });

  afterEach(() => clock.destroy());

  test("geometry: newest at 12 o'clock, clockwise into the past", () => {
    expect(_angleForIndex(2, 3)).toBe(-90); // newest
    expect(_angleForIndex(1, 3)).toBe(30); // one step clockwise
    expect(_angleForIndex(0, 3)).toBe(150);
  });

  test("renders one tick per entry and slider ARIA", () => {
    expect(clock.el.querySelectorAll(".vc-tick")).toHaveLength(3);
    expect(clock.el.getAttribute("role")).toBe("slider");
    expect(clock.el.getAttribute("aria-valuemin")).toBe("0");
    expect(clock.el.getAttribute("aria-valuemax")).toBe("2");
    expect(clock.el.getAttribute("aria-valuenow")).toBe("2");
    expect(clock.el.getAttribute("aria-valuetext")).toBe("Version 3");
  });

  test("badge and published/loading classes", () => {
    expect(clock.el.querySelector(".vc-badge").textContent).toBe("v3");
    expect(clock.el.classList.contains("published")).toBe(false);

    clock.update({
      entries: ENTRIES,
      activeIndex: 1,
      publishedIndex: 1,
      loading: true,
    });
    expect(clock.el.classList.contains("published")).toBe(true);
    expect(clock.el.classList.contains("loading")).toBe(true);
    expect(clock.el.querySelector(".vc-badge").textContent).toBe("v2");
  });

  test("keyboard: arrows step and commit, Home/End jump", () => {
    // The face never moves activeIndex itself — the store reloads and calls
    // update(). Simulate that here after each commit.
    const setActive = (i) =>
      clock.update({
        entries: ENTRIES,
        activeIndex: i,
        publishedIndex: 1,
        loading: false,
      });
    const key = (k) =>
      clock.el.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true })
      );

    key("ArrowLeft"); // older: 2 → 1
    expect(commits).toEqual([1]);
    setActive(1);
    key("Home"); // oldest
    expect(commits).toEqual([1, 0]);
    setActive(0);
    key("ArrowLeft"); // already oldest → clamped, no commit
    expect(commits).toEqual([1, 0]);
    key("End"); // newest
    expect(commits).toEqual([1, 0, 2]);
  });

  test("single-entry chain renders and cannot step", () => {
    clock.update({
      entries: [ENTRIES[0]],
      activeIndex: 0,
      publishedIndex: -1,
      loading: false,
    });
    expect(clock.el.querySelectorAll(".vc-tick")).toHaveLength(1);
    clock.el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
    );
    expect(commits).toEqual([]);
  });

  test("pointer drag commits landed index", () => {
    clock.el.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    clock.el.setPointerCapture = () => {};

    const makeEvent = (type, x, y, button = 0) => {
      const EventCtor =
        typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
      return new EventCtor(type, {
        clientX: x,
        clientY: y,
        button,
        bubbles: true,
        pointerId: 1,
      });
    };

    // Index 0 sits at 150°; pick a point on that ray.
    const angle = _angleForIndex(0, 3);
    const rad = (angle * Math.PI) / 180;
    const r = 30;
    const x = 50 + r * Math.cos(rad);
    const y = 50 + r * Math.sin(rad);

    clock.el.dispatchEvent(makeEvent("pointerdown", x, y));
    clock.el.dispatchEvent(makeEvent("pointerup", x, y));
    expect(commits).toEqual([0]);
  });

  test("right-click does not initiate drag or commit", () => {
    clock.el.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const EventCtor =
      typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
    clock.el.dispatchEvent(
      new EventCtor("pointerdown", {
        clientX: 50,
        clientY: 50,
        button: 2,
        bubbles: true,
        pointerId: 1,
      })
    );
    clock.el.dispatchEvent(
      new EventCtor("pointerup", {
        clientX: 50,
        clientY: 50,
        button: 2,
        bubbles: true,
        pointerId: 1,
      })
    );
    expect(commits).toEqual([]);
  });

  test("wheel step commits older index after debounce", () => {
    jest.useFakeTimers();
    clock.el.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, bubbles: true })
    );
    expect(commits).toEqual([]);
    jest.advanceTimersByTime(400);
    expect(commits).toEqual([1]); // activeIndex 2 → older 1
    jest.useRealTimers();
  });
});

// @test-env dom
/**
 * Version timeline strip: renders the version-history store as numbered
 * ticks under the viewport. State-driven — no event-ordering assumptions.
 */

import { beforeAll, beforeEach, expect, mock, test } from "bun:test";

const versionStore = {
  entries: [],
  active: -1,
  publishedCid: null,
  loading: false,
  subs: new Set(),
  loads: [],
};

function snapshot() {
  return {
    entries: versionStore.entries,
    activeCid:
      versionStore.active >= 0
        ? versionStore.entries[versionStore.active]?.cid
        : null,
    publishedCid: versionStore.publishedCid,
    isLoading: versionStore.loading,
  };
}
function notify() {
  versionStore.subs.forEach((fn) => fn(snapshot()));
}
function setChain(n, { active = n - 1, published = null } = {}) {
  versionStore.entries = Array.from({ length: n }, (_, i) => ({
    cid: `cid-${i + 1}`,
    version: i + 1,
    timestamp: "2026-10-04T14:32:00Z",
    chat: null,
  }));
  versionStore.active = active;
  versionStore.publishedCid = published;
  notify();
}
const strip = () => document.getElementById("versionTimeline");
const ticks = () => [...strip().querySelectorAll(".vt-tick")];

beforeAll(async () => {
  await mock.module(
    "@arbesk/asset-core/domain/version-history-store.js",
    () => ({
      getState: () => snapshot(),
      activeIndex: () => versionStore.active,
      loadVersion: (cid) => {
        versionStore.loads.push(cid);
      },
      subscribe: (fn) => {
        versionStore.subs.add(fn);
        return () => versionStore.subs.delete(fn);
      },
    })
  );
  document.body.innerHTML = `<div id="versionTimeline" hidden role="slider" tabindex="0"></div>`;
  await import("../../frontend/src/js/ui/version-timeline.js");
});

beforeEach(() => {
  versionStore.entries = [];
  versionStore.active = -1;
  versionStore.publishedCid = null;
  versionStore.loading = false;
  versionStore.loads = [];
  notify();
});

test("hidden when the chain is empty", () => {
  expect(strip().hidden).toBe(true);
});

test("renders one numbered tick per entry, oldest first", () => {
  setChain(3);
  expect(strip().hidden).toBe(false);
  expect(ticks().map((t) => t.textContent.trim())).toEqual(["1", "2", "3"]);
});

test("active tick carries aria-current, others do not", () => {
  setChain(3, { active: 1 });
  expect(ticks()[1].getAttribute("aria-current")).toBe("true");
  expect(ticks()[0].getAttribute("aria-current")).toBeNull();
});

test("published tick gets the published marker class", () => {
  setChain(3, { published: "cid-2" });
  expect(ticks()[1].classList.contains("vt-tick-published")).toBe(true);
  expect(ticks()[0].classList.contains("vt-tick-published")).toBe(false);
});

test("click commits loadVersion(cid); clicking the active tick is a no-op", () => {
  setChain(3, { active: 2 });
  ticks()[0].click();
  expect(versionStore.loads).toEqual(["cid-1"]);
  ticks()[2].click();
  expect(versionStore.loads).toEqual(["cid-1"]);
});

test("isLoading disables all ticks and sets aria-busy", () => {
  setChain(2);
  versionStore.loading = true;
  notify();
  expect(ticks().every((t) => t.disabled)).toBe(true);
  expect(strip().getAttribute("aria-busy")).toBe("true");
});

test("slider aria attributes track the store", () => {
  setChain(3, { active: 1 });
  expect(strip().getAttribute("aria-valuemin")).toBe("1");
  expect(strip().getAttribute("aria-valuemax")).toBe("3");
  expect(strip().getAttribute("aria-valuenow")).toBe("2");
  // Local TZ is not pinned in the test env — assert the shape, not the wall time.
  expect(strip().getAttribute("aria-valuetext")).toMatch(
    /^v2 of 3 · saved \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/
  );
});

test("arrow keys move and commit; Home/End jump to the ends", () => {
  setChain(3, { active: 1 });
  strip().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(versionStore.loads).toEqual(["cid-1"]);
  versionStore.active = 0;
  notify();
  strip().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(versionStore.loads).toEqual(["cid-1", "cid-3"]);
});

test("keys at the ends are no-ops; unhandled keys are ignored", () => {
  setChain(2, { active: 0 });
  strip().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  strip().dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  expect(versionStore.loads).toEqual([]);
});

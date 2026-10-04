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

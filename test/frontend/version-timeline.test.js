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
    thumbnail: null,
  }));
  versionStore.active = active;
  versionStore.publishedCid = published;
  notify();
}
const strip = () => document.getElementById("versionTimeline");
const ticks = () => [...strip().querySelectorAll(".vt-tick")];
const q = (sel) => strip().querySelector(sel);
const gaps = () =>
  [...strip().querySelectorAll(".vt-gap")].map((g) =>
    g.style.getPropertyValue("--vt-gap")
  );
// Local-time constructor: independent of the runner's time zone.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
function setTimes(times, opts) {
  setChain(times.length, opts);
  versionStore.entries.forEach((e, i) => {
    e.timestamp = times[i];
  });
  notify();
}

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
  await mock.module(
    "../../frontend/src/js/ipfs/remote-ipfs.js",
    () => ({ gatewayBase: async () => "http://gw/ipfs/" })
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

test("tooltip shows on hover with version, timestamp, and chat prompt", async () => {
  setChain(2);
  versionStore.entries[0].chat = [
    { prompt: "a cowboy with a very long description that keeps going and going and going and going", provider: "mock", task: "text-to-3d" },
  ];
  notify();
  ticks()[0].dispatchEvent(new Event("pointerenter", { bubbles: true }));
  const tip = document.querySelector(".vt-tooltip");
  expect(tip).toBeTruthy();
  expect(tip.textContent).toContain("v1");
  expect(tip.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  const prompt = tip.querySelector(".vt-tooltip-prompt").textContent;
  expect(prompt.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
  expect(prompt).toContain("…");
});

test("tooltip shows the thumbnail img when the entry has one", async () => {
  setChain(1);
  versionStore.entries[0].thumbnail = { cid: "bafy-thumb" };
  notify();
  ticks()[0].dispatchEvent(new Event("pointerenter", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // let gatewayBase resolve
  const img = document.querySelector(".vt-tooltip img");
  expect(img.getAttribute("src")).toBe("http://gw/ipfs/bafy-thumb");
});

test("tooltip dismisses on pointerleave and Escape", () => {
  setChain(2);
  ticks()[1].dispatchEvent(new Event("pointerenter", { bubbles: true }));
  expect(document.querySelector(".vt-tooltip")).toBeTruthy();
  ticks()[1].dispatchEvent(new Event("pointerleave", { bubbles: true }));
  expect(document.querySelector(".vt-tooltip")).toBeNull();
  ticks()[0].dispatchEvent(new Event("pointerenter", { bubbles: true }));
  expect(document.querySelector(".vt-tooltip")).toBeTruthy();
  strip().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".vt-tooltip")).toBeNull();
});

// ─── Time strip: spacing, days, active-version details ───

test("gaps between ticks carry the time weight", () => {
  setTimes([local(2026, 10, 3, 10, 0), local(2026, 10, 3, 10, 5), local(2026, 10, 3, 13, 5)]);
  expect(gaps()).toEqual(["1.792", "5.198"]);
});

test("a day change starts a new day group and splits the gap across the divider", () => {
  // July: no DST change anywhere, so the two saves are exactly 1440 minutes apart.
  setTimes([local(2026, 7, 14, 10, 0), local(2026, 7, 15, 10, 0)]);
  expect(strip().querySelectorAll(".vt-day").length).toBe(2);
  expect(strip().querySelectorAll(".vt-day-label").length).toBe(2);
  expect(gaps().map(Number)).toEqual([3.6365, 3.6365]);
  expect(ticks().map((t) => t.textContent.trim())).toEqual(["1", "2"]);
});

test("each day group carries its tick count and total gap weight for sizing", () => {
  setTimes([local(2026, 7, 14, 10, 0), local(2026, 7, 14, 10, 5), local(2026, 7, 15, 10, 5)]);
  const days = [...strip().querySelectorAll(".vt-day")];
  expect(days.map((d) => d.style.getPropertyValue("--vt-ticks"))).toEqual(["2", "1"]);
  const spans = days.map((d) => Number(d.style.getPropertyValue("--vt-span")));
  expect(spans[0]).toBeCloseTo(1.792 + 3.6365, 2); // 5-minute gap + half the overnight gap
  expect(spans[1]).toBeCloseTo(3.6365, 2); // the other half
});

test("undated versions pack together under one unlabelled day", () => {
  setTimes([undefined, undefined, undefined]);
  expect(strip().querySelectorAll(".vt-day").length).toBe(1);
  expect(q(".vt-day-label")).toBeNull();
  expect(gaps()).toEqual(["0", "0"]);
  expect(q(".vt-current-meta").textContent).toBe("v3");
});

test("details show the active version's number, save time and first prompt line", () => {
  setTimes([Date.now(), Date.now()]);
  versionStore.entries[1].chat = [{ prompt: "make the hat red\nsecond line" }];
  notify();
  expect(q(".vt-current-meta").textContent).toMatch(/^v2 · Today \d{2}:\d{2}$/);
  expect(q(".vt-current-prompt").textContent).toBe("make the hat red");
});

test("details omit the prompt line when the version has none", () => {
  setChain(2);
  expect(q(".vt-current-meta")).toBeTruthy();
  expect(q(".vt-current-prompt")).toBeNull();
});

test("details mark the published version only while it is the active one", () => {
  setChain(3, { active: 1, published: "cid-2" });
  expect(q(".vt-current-published").textContent).toBe("Published");
  setChain(3, { active: 0, published: "cid-2" });
  expect(q(".vt-current-published")).toBeNull();
});

test("the prompt is rendered as text, never as markup", () => {
  setChain(1);
  versionStore.entries[0].chat = [{ prompt: "<img src=x onerror=alert(1)>" }];
  notify();
  expect(q(".vt-current img")).toBeNull();
  expect(q(".vt-current-prompt").textContent).toBe("<img src=x onerror=alert(1)>");
});

test("the active tick is scrolled into view on every render", () => {
  const scrolled = [];
  HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this);
  };
  setChain(3, { active: 1 });
  expect(scrolled.at(-1)).toBe(ticks()[1]);
  delete HTMLElement.prototype.scrollIntoView;
});

test("track and details elements persist across renders", () => {
  setChain(2);
  const track = q(".vt-track");
  const current = q(".vt-current");
  expect(track && current).toBeTruthy();
  notify();
  expect(q(".vt-track")).toBe(track);
  expect(q(".vt-current")).toBe(current);
});

test("details are empty when the chain is empty", () => {
  setChain(2);
  setChain(0);
  expect(strip().hidden).toBe(true);
  expect(q(".vt-current").children.length).toBe(0);
});

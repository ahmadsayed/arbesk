# Version Timeline Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the viewport-corner scene-clock dial with an always-visible, keyboard-operable version timeline strip under the viewport — numbered ticks, active/published markers, hover/focus tooltip with thumbnail + timestamp + chat prompt — and delete the radial dial stack.

**Architecture:** A new headless-friendly module `ui/version-timeline.ts` renders ticks from the existing `@arbesk/asset-core/domain/version-history-store.js` (entries oldest→newest, `activeCid`, `publishedCid`, `isLoading`) into a declarative Pug element `#versionTimeline` (sibling of `#viewport` inside `#mainStage`). Keyboard follows the WAI-ARIA APG slider pattern on the strip container; the tooltip is a fixed-position card on `document.body` (never inside the scrollable row). `walkManifestChain` gains a `thumbnail` field so tooltips can show version thumbnails. The dial stack (`scene-clock.ts`, `version-clock.ts`, `_version-clock.scss`, their tests) is deleted; spec 04 migrates to strip assertions.

**Tech Stack:** TypeScript frontend (Bun.build), Pug/SCSS, bun test + jsdom, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-04-version-timeline-design.md`

## Global Constraints

- Branch: `feat/version-timeline` off `docs/version-timeline-spec` in the worktree `.worktrees/ui-theme-p1-1` (spec + plan ride the implementation PR); one PR closes #85; commit per task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- Frontend imports carry explicit `.ts` extensions (`.js` only for plain-JS files like `constants/chains.js`).
- Tests: `// @test-env dom` first line for DOM tests; run via `bun scripts/run-tests.mjs <file>`; mock ESM with `mock.module()` before dynamic `import()`; test files import frontend modules with `.js` specifiers (bun test maps `.js`→`.ts`).
- SCSS: theme tokens only in `components/` (no hex); numbers get `.tabular`; `test/frontend/style-guards.test.js` must pass.
- E2E ids are a public contract: sync `e2e/helpers/studio-selectors.mjs` with any id/class change and grep `e2e/` before renaming.
- After each task touching `frontend/src`: `cd frontend && bun run build`.
- The pre-commit hook runs `fallow audit` (new-findings-only): keep new functions small — extract helpers instead of adding branches to long functions.
- After any E2E run: `git checkout -- blockchain/deployments` (the harness dirties it).
- Existing unit baseline: 17 frontend test files fail on clean `origin/main` — compare failing-file sets, never totals.
- **Out of scope (spec §11):** V-key time mode and `model-clock-gizmo.ts` stay untouched; no per-node history in the strip; no chain editing; no drag scrubbing.

---

### Task 1: Strip core — ticks, store wiring, visibility

**Files:**
- Create: `frontend/src/js/ui/version-timeline.ts`
- Modify: `frontend/src/pug/includes/studio-main.pug` (add the mount element)
- Modify: `frontend/src/js/app-entry.ts:17` (`import "./ui/scene-clock.ts";` → add `import "./ui/version-timeline.ts";` on the next line — scene-clock stays until Task 6)
- Test: `test/frontend/version-timeline.test.js`

**Interfaces:**
- Consumes: `@arbesk/asset-core/domain/version-history-store.js` — `getState()` → `{entries, activeCid, publishedCid, isLoading}`, `activeIndex()`, `subscribe(fn)`, `loadVersion(cid)`.
- Produces: `#versionTimeline` strip populated with `.vt-tick` buttons; module self-inits on import (same idiom as `scene-clock.ts`).
- Pug mount (in `studio-main.pug`, immediately after the `#viewport` block ends at line 20, before the inspector `aside`):

```pug
#versionTimeline.version-timeline(hidden role="slider" tabindex="0" aria-label="Version timeline" aria-orientation="horizontal")
```

- [ ] **Step 1: Write the failing test**

Create `test/frontend/version-timeline.test.js`. Mock the store exactly like `test/frontend/asset-chrome.test.js:37-52` does (controlled `versionStore` stand-in with `subs` poked manually); the mock must also record `loadVersion` calls:

```js
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

function notify() {
  versionStore.subs.forEach((fn) => fn({}));
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
      getState: () => ({
        entries: versionStore.entries,
        activeCid:
          versionStore.active >= 0
            ? versionStore.entries[versionStore.active]?.cid
            : null,
        publishedCid: versionStore.publishedCid,
        isLoading: versionStore.loading,
      }),
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/version-timeline.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ui/version-timeline.ts`**

Mirror the `scene-clock.ts` idiom (self-init on import, render-on-subscribe), but render into the existing Pug element:

```ts
/**
 * Version timeline strip under the viewport.
 * @remarks Replaces the scene-clock dial: numbered ticks for each manifest
 *   version, keyboard-operable as an APG slider. Hidden when the chain is
 *   empty; the router's Library view hides the whole Studio view, so no
 *   per-view visibility logic lives here.
 */

import * as store from "@arbesk/asset-core/domain/version-history-store.js";
import type { VersionHistoryState } from "@arbesk/asset-core/domain/version-history-store.js";

const ROOT_ID = "versionTimeline";

function render(root: HTMLElement, s: VersionHistoryState): void {
  root.hidden = s.entries.length === 0;
  if (root.hidden) return;
  const active = store.activeIndex();
  root.setAttribute("aria-busy", String(s.isLoading));
  // rebuild ticks (see Steps below for aria attrs — Task 2)
  root.replaceChildren(
    ...s.entries.map((entry, i) => {
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "vt-tick tabular";
      tick.tabIndex = -1;
      tick.disabled = s.isLoading;
      tick.textContent = String(i + 1);
      if (i === active) tick.setAttribute("aria-current", "true");
      if (entry.cid === s.publishedCid)
        tick.classList.add("vt-tick-published");
      tick.addEventListener("click", () => {
        if (entry.cid !== s.activeCid) store.loadVersion(entry.cid);
      });
      return tick;
    })
  );
}

function initVersionTimeline(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  store.subscribe((s) => render(root, s));
  render(root, store.getState());
}

initVersionTimeline();

export { initVersionTimeline };
```

- [ ] **Step 4: Add the Pug mount and app-entry import**

In `frontend/src/pug/includes/studio-main.pug`, after the `#viewport` block (line 20, before the `//- Inspector` comment):

```pug
//- Version timeline strip (hidden until a version chain loads)
#versionTimeline.version-timeline(hidden role="slider" tabindex="0" aria-label="Version timeline" aria-orientation="horizontal")
```

In `frontend/src/js/app-entry.ts`, add below line 17 (`import "./ui/scene-clock.ts";`):

```ts
import "./ui/version-timeline.ts";
```

- [ ] **Step 5: Run test + build**

Run: `bun scripts/run-tests.mjs test/frontend/version-timeline.test.js` — PASS.
Run: `cd frontend && bun run build` — clean.

- [ ] **Step 6: Commit**

`feat(ui): version timeline strip core (ticks, store wiring) (#85)` with the trailer.

---

### Task 2: APG slider keyboard + aria tracking

**Files:**
- Modify: `frontend/src/js/ui/version-timeline.ts`
- Test: `test/frontend/version-timeline.test.js`

**Interfaces:**
- Strip container aria: `aria-valuemin="1"`, `aria-valuemax={entries.length}`, `aria-valuenow={activeIndex+1}`, `aria-valuetext="v3 of 12 · saved 2026-10-04 14:32"` (empty string when no timestamp).
- Keys on the strip container: ArrowLeft/ArrowDown = older, ArrowRight/ArrowUp = newer, Home = oldest, End = newest; `preventDefault` on handled keys; commit via `loadVersion(entry.cid)` (the store no-ops on same-cid).
- Produces (internal, reused by Task 3): `formatTimestamp(ts: unknown): string` → `YYYY-MM-DD HH:MM` local time, `""` for missing/invalid input.

- [ ] **Step 1: Add the failing tests**

Append to `test/frontend/version-timeline.test.js`:

```js
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
```

(Same TZ caveat in the Task 3 tooltip test: assert `tip.textContent` matches `/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/` rather than a literal wall time.)

- [ ] **Step 2: Run to verify fail** — `bun scripts/run-tests.mjs test/frontend/version-timeline.test.js`.

- [ ] **Step 3: Implement**

In `version-timeline.ts` add `formatTimestamp`, an `onKeydown(root)` handler wired in `initVersionTimeline`, and the aria updates inside `render`. Movement helper keeps `render` small:

```ts
/** @returns `YYYY-MM-DD HH:MM` local time, or "" for missing/invalid input. */
function formatTimestamp(ts: unknown): string {
  if (ts == null) return "";
  const d = new Date(ts as string | number);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
```

In `render` (before `replaceChildren`):

```ts
root.setAttribute("aria-valuemin", "1");
root.setAttribute("aria-valuemax", String(s.entries.length));
root.setAttribute("aria-valuenow", String(active + 1));
const ts = formatTimestamp(s.entries[active]?.timestamp);
root.setAttribute(
  "aria-valuetext",
  `v${active + 1} of ${s.entries.length}${ts ? ` · saved ${ts}` : ""}`
);
```

Keyboard (wired once in `initVersionTimeline`):

```ts
const KEYS: Record<string, (i: number, n: number) => number> = {
  ArrowLeft: (i) => i - 1,
  ArrowDown: (i) => i - 1,
  ArrowRight: (i) => i + 1,
  ArrowUp: (i) => i + 1,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

function onKeydown(e: KeyboardEvent): void {
  const move = KEYS[e.key];
  if (!move) return;
  const { entries } = store.getState();
  if (entries.length === 0) return;
  const next = Math.min(Math.max(move(store.activeIndex(), entries.length), 0), entries.length - 1);
  e.preventDefault();
  const entry = entries[next];
  if (entry && entry.cid !== store.getState().activeCid) store.loadVersion(entry.cid);
}
```

- [ ] **Step 4: Run test + build** — PASS; `cd frontend && bun run build`.

- [ ] **Step 5: Commit** — `feat(ui): timeline strip slider keyboard + aria (#85)` with the trailer.

---

### Task 3: Tooltip + chain thumbnails

**Files:**
- Modify: `frontend/src/js/ui/version-timeline.ts`
- Modify: `frontend/src/js/engine/time-travel.ts` (interface line 10-21 + `chain.unshift` at line 159)
- Test: `test/frontend/version-timeline.test.js`

**Interfaces:**
- `ManifestChainVersion` gains `thumbnail: { cid?: string } | null` — one line in the interface and one in `chain.unshift`: `thumbnail: manifest.thumbnail ?? null,`.
- Tooltip: a single `.vt-tooltip` div appended to `document.body`, fixed-positioned above the hovered/focused tick via `getBoundingClientRect()`. Contents: thumbnail `<img>` (src = `${await gatewayBase()}${cid}` from `../ipfs/remote-ipfs.ts`, hidden while no thumbnail), a `v{n}` + timestamp line, and the first `metadata.chat[].prompt` first line truncated to 80 chars. Dismiss on pointerleave / blur / Escape; rebuilt per tick.
- Mock in tests: `../../frontend/src/js/ipfs/remote-ipfs.js` → `{ gatewayBase: async () => "http://gw/ipfs/" }` (add a second `mock.module` in `beforeAll` BEFORE importing version-timeline; the store mock stays).

- [ ] **Step 1: Add the failing tests**

```js
test("tooltip shows on hover with version, timestamp, and chat prompt", async () => {
  setChain(2);
  versionStore.entries[0].chat = [
    { prompt: "a cowboy with a very long description that keeps going and going and going and going", provider: "mock", task: "text-to-3d" },
  ];
  notify();
  ticks()[0].dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
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
  ticks()[0].dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); // let gatewayBase resolve
  const img = document.querySelector(".vt-tooltip img");
  expect(img.getAttribute("src")).toBe("http://gw/ipfs/bafy-thumb");
});

test("tooltip dismisses on pointerleave and Escape", () => {
  setChain(2);
  ticks()[1].dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
  expect(document.querySelector(".vt-tooltip")).toBeTruthy();
  ticks()[1].dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  expect(document.querySelector(".vt-tooltip")).toBeNull();
});
```

Note: `setChain` builds entries without `thumbnail` — extend its entry literal with `thumbnail: null` so the no-thumbnail path is covered too. If jsdom lacks `PointerEvent`, dispatch a plain `new Event("pointerenter")` — check `test/helpers/dom.js` and existing tests for the established idiom first.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

1. `time-travel.ts`: add `thumbnail: { cid?: string } | null;` to `ManifestChainVersion` and `thumbnail: manifest.thumbnail ?? null,` to the `chain.unshift` literal (after the `chat` line).
2. `version-timeline.ts`: add tooltip helpers — keep each under ~30 lines:

```ts
import { gatewayBase } from "../ipfs/remote-ipfs.ts";

let tooltip: HTMLElement | null = null;

function hideTooltip(): void {
  tooltip?.remove();
  tooltip = null;
}

async function showTooltip(tick: HTMLElement, entry: any, n: number): Promise<void> {
  hideTooltip();
  const tip = document.createElement("div");
  tip.className = "vt-tooltip";
  tip.setAttribute("role", "tooltip");
  // title line: vN + timestamp
  const title = document.createElement("div");
  title.className = "vt-tooltip-title tabular";
  const ts = formatTimestamp(entry.timestamp);
  title.textContent = `v${n}${ts ? ` · ${ts}` : ""}`;
  tip.appendChild(title);
  // chat prompt (first line, ~80 chars)
  const prompt = entry.chat?.[0]?.prompt?.split("\n")[0];
  if (prompt) {
    const p = document.createElement("div");
    p.className = "vt-tooltip-prompt";
    p.textContent = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
    tip.appendChild(p);
  }
  document.body.appendChild(tip);
  // fixed position above the tick
  const r = tick.getBoundingClientRect();
  tip.style.left = `${r.left + r.width / 2}px`;
  tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
  tooltip = tip;
  // thumbnail last: async gateway resolution must not block the card
  if (entry.thumbnail?.cid) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `${await gatewayBase()}${entry.thumbnail.cid}`;
    tip.prepend(img);
  }
}
```

Wire per tick inside `render` (the `s.entries.map` callback):

```ts
tick.addEventListener("pointerenter", () => showTooltip(tick, entry, i + 1));
tick.addEventListener("focus", () => showTooltip(tick, entry, i + 1));
tick.addEventListener("pointerleave", hideTooltip);
tick.addEventListener("blur", hideTooltip);
```

And in `onKeydown`, `if (e.key === "Escape") { hideTooltip(); return; }` before the `KEYS` lookup (Escape is handled but does not move the slider — still `preventDefault` only when a tooltip was visible: `if (tooltip) e.preventDefault();`).

- [ ] **Step 4: Run test + typecheck + build** — `bun scripts/run-tests.mjs test/frontend/version-timeline.test.js` PASS; `npx tsc --noEmit -p frontend/tsconfig.json` clean; `cd frontend && bun run build`.

- [ ] **Step 5: Commit** — `feat(ui): timeline tooltip with thumbnails + chat prompt (#85)` with the trailer.

---

### Task 4: SCSS `_version-timeline.scss`

**Files:**
- Create: `frontend/src/scss/components/_version-timeline.scss`
- Modify: `frontend/src/scss/styles.scss` (add `@use 'components/version-timeline';` next to line 28 — the `version-clock` @use stays until Task 6)
- Test: `test/frontend/style-guards.test.js` (existing — must stay green)

- [ ] **Step 1: Write the stylesheet** (tokens only — spacing scale is `--size-1/2/3` (as in `_bottombar.scss`), radii `--radius-1/2`, surfaces `--sidebar-bg`/`--card-bg`, hairline `--border-size-1 solid var(--border-hairline)`, accents `--accent-bg`/`--success`; literal `z-index: 100` for the tooltip matches the overlay convention in `_responsive.scss`/`_landing.scss`; no hex):

```scss
// Version timeline strip under the viewport (#85). Tokens only.

.version-timeline {
  display: flex;
  align-items: center;
  gap: var(--size-1);
  min-height: 36px;
  padding: 0 var(--size-2);
  overflow-x: auto;
  background: var(--sidebar-bg);
  border-top: var(--border-size-1) solid var(--border-hairline);

  &[hidden] {
    display: none;
  }
}

.vt-tick {
  position: relative;
  flex: 0 0 auto;
  min-width: 32px;
  min-height: 32px;
  border: 0;
  background: transparent;
  color: var(--window-fg);
  cursor: pointer;

  &[aria-current="true"] {
    color: var(--accent-bg);
    box-shadow: inset 0 -2px 0 var(--accent-bg);
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
}

.vt-tick-published::before {
  content: "";
  position: absolute;
  top: 4px;
  left: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  transform: translateX(-50%);
}

.vt-tooltip {
  position: fixed;
  z-index: 100;
  transform: translateX(-50%);
  max-width: 260px;
  padding: var(--size-2);
  background: var(--card-bg);
  border: var(--border-size-1) solid var(--border-hairline);
  border-radius: var(--radius-2);
  color: var(--window-fg);

  img {
    display: block;
    width: 100%;
    border-radius: var(--radius-1);
    margin-bottom: var(--size-1);
  }
}
```

- [ ] **Step 2: Add the `@use` and build**

`styles.scss` after line 28 area: `@use 'components/version-timeline';`
Run: `cd frontend && bun run build` — clean.
Run: `bun scripts/run-tests.mjs test/frontend/style-guards.test.js test/frontend/theme-contrast.test.js` — PASS (no new pairs needed: the tooltip reuses existing card tokens).

- [ ] **Step 3: Commit** — `feat(ui): version timeline strip styles (#85)` with the trailer.

---

### Task 5: E2E migration (spec 04, selectors, flows)

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs:79-81`
- Modify: `e2e/helpers/flows.mjs:368-380`
- Modify: `e2e/specs/04-parametric-version.spec.js` (first test only; the model-clock test is untouched)
- Modify: `e2e/README.md:157-161`

- [ ] **Step 1: Replace the selectors**

```js
// Version history / time-travel
versionTimeline: "#versionTimeline",
vtTicks: "#versionTimeline .vt-tick",
vtActiveTick: "#versionTimeline .vt-tick[aria-current='true']",
vtTooltip: ".vt-tooltip",
```

(Delete `sceneClock`, `sceneClockDial`, `sceneClockBadge`. `modelClockBadge` and `timeModeButton` stay.)

- [ ] **Step 2: Replace the flow helper** (`flows.mjs:368-380`)

```js
/**
 * Jump the version timeline to the oldest or newest version. The strip is an
 * APG slider: focus it, then Home/End commit the version load immediately.
 *
 * @param {Page} page
 * @param {"oldest" | "newest"} position
 */
export async function scrubVersionTimeline(page, position) {
  await page.locator(SELECTORS.versionTimeline).focus();
  await page.keyboard.press(position === "oldest" ? "Home" : "End");
}
```

- [ ] **Step 3: Migrate spec 04's first test**

- Import `scrubVersionTimeline` instead of `scrubSceneClock`.
- Step 5 assertions (lines 49-55) become:

```js
// 5. The version timeline now spans three versions and sits on the newest.
await expect(page.locator(SELECTORS.versionTimeline)).toBeVisible();
await expect(page.locator(SELECTORS.vtTicks)).toHaveCount(3);
await expect(page.locator(SELECTORS.vtActiveTick)).toHaveText("3");
await expect(page.locator(SELECTORS.versionTimeline)).toHaveAttribute(
  "aria-valuemax",
  "3",
);
await expect(page.locator(SELECTORS.versionTimeline)).toHaveAttribute(
  "aria-valuenow",
  "3",
);
```

- Steps 6-7: `scrubSceneClock(page, "oldest")` → `scrubVersionTimeline(page, "oldest")`; badge assertions become `vtActiveTick` text assertions (`"1"` / `"3"`). The `.not.toHaveClass(/loading/)` dial assertion (line 76-78) becomes an `aria-busy="false"` assertion on `#versionTimeline`. Keep every `__sceneReadyCids` poll byte-identical — they are the real load signal.
- Line 111-115 (`scrubSceneClock(page, "newest")` before publishing) → `scrubVersionTimeline`.
- Update comment at line 49 ("The scene clock now spans…") to the strip wording.
- Add the two new spec-required assertions (spec §9, "New"): after publish, the tooltip — hover tick 4 (the published version): `page.locator(SELECTORS.vtTicks).nth(3).hover()` → `expect(page.locator(SELECTORS.vtTooltip)).toBeVisible()` and its text contains `v4`; and the published-dot marker: `expect(page.locator(`${SELECTORS.vtTicks}.vt-tick-published`)).toHaveCount(1)`. (Strip-hidden-with-no-asset is covered by the unit test; skip a separate E2E for it.)

- [ ] **Step 4: Update `e2e/README.md:157-161`**

Rewrite the spec-04 walkthrough lines to the strip (`#versionTimeline`, active tick text, Home/End scrubbing) and swap `scene-clock.ts` for `version-timeline.ts` in the "Why it matters" line.

- [ ] **Step 5: Run the spec**

Run: `bun run test:e2e -- --project=chromium e2e/specs/04-parametric-version.spec.js` — PASS (both tests).
Then: `git checkout -- blockchain/deployments`.

- [ ] **Step 6: Commit** — `test(e2e): migrate spec 04 to the version timeline strip (#85)` with the trailer.

---

### Task 6: Delete the dial stack + docs

**Files:**
- Delete: `frontend/src/js/ui/scene-clock.ts`, `frontend/src/js/ui/version-clock.ts`, `frontend/src/scss/components/_version-clock.scss`, `test/frontend/scene-clock.test.js`, `test/frontend/version-clock.test.js`
- Modify: `frontend/src/js/app-entry.ts:17` (remove the scene-clock import)
- Modify: `frontend/src/scss/styles.scss:28` (remove the version-clock `@use`)
- Modify: `test/frontend/theme-contrast.test.js:112` (comment only — the warning-22% pair is shared with `_library-grid` statuses; drop ", _version-clock hover badge" from the comment, keep the pair)
- Modify docs: `docs/CURRENT_STATUS.md:178`, `docs/ARCHITECTURE.md:178` and `:389`, `docs/hig/implementation.md:69` and `:191`, `.agents/skills/edit-ui/references/deep-dive.md:42-43`

- [ ] **Step 1: Delete and unwire**

`git rm` the five files; remove the app-entry import and the styles.scss `@use`; fix the theme-contrast comment.

- [ ] **Step 2: Update docs references** (each keeps the model-clock mention, swaps the scene-clock/stack mention for the strip):

- `docs/CURRENT_STATUS.md:178` — the ui/ tree line becomes `version-timeline.ts / model-clock-gizmo.ts  # Version timeline strip + selected-node 3D ring`.
- `docs/ARCHITECTURE.md:178` — table row: `ui/version-timeline.ts`, `ui/model-clock-gizmo.ts` | Version history store + timeline strip / model clock.
- `docs/ARCHITECTURE.md:389` — swap `ui/scene-clock.ts` → `ui/version-timeline.ts` and "scene/model version clocks" → "the version timeline strip and the per-node model clock".
- `docs/hig/implementation.md:69` — `Version-control UI (#versionTimeline version timeline strip, #modelClock per-model clock)`.
- `docs/hig/implementation.md:191` — same swap as ARCHITECTURE.md:178 (note: this line also names `ui/model-clock.js` — leave that pre-existing naming slip alone or fix to `model-clock-gizmo.ts` while touching the line; fixing is in-scope here).
- `.agents/skills/edit-ui/references/deep-dive.md:42-43` — replace the two rows with `frontend/src/js/ui/version-timeline.ts | Version timeline strip (APG slider)`.
- Grep `.agents/skills/edit-ui/references/e2e-sync.md` for clock references — update if present (earlier grep found none; re-verify).

- [ ] **Step 3: Verify nothing references the dead ids**

Run: `rg -n "scene-clock|version-clock|sceneClock" frontend/src test e2e docs .agents/skills` — expect zero hits outside `docs/superpowers/` historical plans/specs (those stay as history).

- [ ] **Step 4: Build + unit sweep**

Run: `cd frontend && bun run build` — clean.
Run: `bun run test:frontend` — failing-file set identical to the 17-file `origin/main` baseline MINUS `scene-clock.test.js`/`version-clock.test.js` if they were in it (check: they were passing, so the set must simply not grow).
Run: `npx tsc --noEmit -p frontend/tsconfig.json` — clean.

- [ ] **Step 5: Commit** — `refactor(ui): retire the scene-clock dial stack (#85)` with the trailer.

---

### Task 7: Full verification + PR

- [ ] **Step 1: Lint + typecheck**

`bun run lint` on touched files (or repo lint if fast); `npx tsc --noEmit -p frontend/tsconfig.json`; `bun run typecheck` (backend untouched — run anyway, cheap).

- [ ] **Step 2: Unit suites**

`bun run test` — compare failing-file set against the 17-file `origin/main` baseline; no growth.

- [ ] **Step 3: Full E2E**

`bun run test:e2e -- --project=chromium` (~2 min on GPU). Known pre-existing order flakes: `18-chat-provenance`, `25-public-profile` — rerun solo if only those fail. Then `git checkout -- blockchain/deployments`.

- [ ] **Step 4: Browser check at 1440×900** (spec §12 risk)

Playwright MCP against the dev stack (`./scripts/start-dev.sh`): generate 3+ versions of one asset, confirm the strip renders ticks, active/published markers, tooltip not clipped by the strip's `overflow-x`, and ArrowLeft/Right/Home/End scrub with `aria-valuenow` tracking. Screenshot to the worktree `.playwright-mcp/` (screenshots land in the main checkout cwd — move them).

- [ ] **Step 5: Push + PR + merge**

`git push -u origin feat/version-timeline` (spec branch commits are ancestors — they ride along). `gh pr create` with body closing #85, ending with the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line. `gh pr merge <N> --merge`.

- [ ] **Step 6: Handover**

Update `.worktrees/HANDOVER-ui-refresh-phase2.md`: #85 done (PR number), epic 19/20, only #86 (View/Edit mode) remains.

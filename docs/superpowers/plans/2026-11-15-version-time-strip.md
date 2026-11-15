# Version Time Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the numbers-only version strip under the Studio viewport into a time strip: ticks spaced by time between saves, day dividers, and the active version's details always visible.

**Architecture:** Pure time/layout helpers live in a new `version-timeline-layout.ts` (no DOM). `version-timeline.ts` keeps its store subscription, slider keyboard handling and tooltip, and renders two persistent regions inside `#versionTimeline`: a scrolling `.vt-track` of day groups and a fixed `.vt-current` details block. Spacing is pure CSS flex (each gap's ideal width comes from a `--vt-gap` custom property), so nothing is measured in JS.

**Tech Stack:** TypeScript (frontend, Bun.build), SCSS with theme tokens, `bun test` with `// @test-env dom`, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-15-version-time-strip-design.md` (read it; this plan argues from it)

## Global Constraints

- Work on branch `feat/version-time-strip`, in a worktree created with the repo's `arbesk-worktree` skill. Never commit to `main`.
- Read `.agents/skills/edit-ui/SKILL.md` before touching `frontend/src/`. Rebuild with `bun run build:frontend` after every frontend change; the backend serves `dist/`.
- Tokens only in `frontend/src/scss/components/`: no hex colours, no `text-transform: uppercase`, no hand-written mono stack (`test/frontend/style-guards.test.js`, `theme-contrast.test.js`).
- E2E contract stays intact: `#versionTimeline` keeps `role="slider"` and its `aria-value*`; each version is a `button.vt-tick` whose `textContent` is exactly the 1-based number; `vt-tick-published`, `aria-current="true"` and `.vt-tooltip` behave as today.
- Every tick keeps a minimum 24px slot.
- Day labels: `Today`, `Yesterday`, otherwise `Fri 13 Nov`; add the year (`Wed 31 Dec 2025`) when it is not the current year. Sentence case. Local time zone.
- Active details time format: `Today 20:01`, `Yesterday 16:45`, `Fri 13 Nov 21:40`. Never a relative age.
- Import specifiers match the on-disk file (`.ts` inside `frontend/src/js/`); type-only imports use `import type`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Manifests without `timestamp`** (the schema makes it optional): the strip must still render, pack those ticks together, show no day label for an all-undated chain, and show `v3` alone in the details. Pinned in Task 1 and Task 2.
2. **Long chains** (100+ versions): ticks never overlap, the track scrolls, the active tick is in view. Pinned in Task 2 (scroll-into-view test) plus the browser check.
3. **Timestamps as ISO strings, not numbers** (older fixtures and the existing unit test use strings): treated the same as epoch milliseconds. Pinned in Task 1.
4. **Prompt text containing markup or very long text**: rendered as text, one line, never as HTML. Pinned in Task 2.
5. **Day edges**: saves at 23:59 and 00:01 are different days though two minutes apart; a save from a previous year shows the year; a timestamp in the future (clock skew) is never labelled `Today`. Pinned in Task 1.

---

### Task 1: Time and layout helpers

**Files:**
- Create: `frontend/src/js/ui/version-timeline-layout.ts`
- Test: `test/frontend/version-timeline-layout.test.js`

**Interfaces:**
- Produces:
  - `gapWeights(timestamps: unknown[]): number[]` — same length as the input. `[0]` is `0`. `[i]` is `Math.log(1 + minutesBetween(i-1, i))` rounded to 3 decimals, or `0` when either timestamp is unusable or the later one is older.
  - `interface TimelineDay { label: string; start: number; end: number }` — `end` exclusive.
  - `splitDays(timestamps: unknown[], now: Date): TimelineDay[]` — consecutive runs of versions on the same local calendar day. A version with no usable timestamp never starts a new run. `label` is the day label of the run's first usable timestamp, or `""` if it has none. Empty input gives `[]`.
  - `savedLabel(ts: unknown, now: Date): string` — `"<day label> HH:MM"`, or `""` for an unusable timestamp.
  - A usable timestamp is a finite number (epoch ms) or a string `Date` can parse.

- [ ] **Step 1: Write the failing tests**

```js
import { expect, test } from "bun:test";
import {
  gapWeights,
  savedLabel,
  splitDays,
} from "../../frontend/src/js/ui/version-timeline-layout.js";

// Local-time constructors keep these independent of the runner's time zone.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = new Date(2026, 10, 15, 20, 3); // Sun 15 Nov 2026 20:03

test("gap weight grows with the log of the minutes between saves", () => {
  expect(gapWeights([at(2026, 11, 14, 10, 0), at(2026, 11, 14, 10, 5), at(2026, 11, 14, 13, 5)]))
    .toEqual([0, 1.792, 5.198]);
});

test("unusable or out-of-order timestamps get the minimum gap", () => {
  expect(gapWeights([at(2026, 11, 14, 10, 0), undefined, at(2026, 11, 14, 11, 0)])).toEqual([0, 0, 0]);
  expect(gapWeights([at(2026, 11, 14, 10, 0), "nope"])).toEqual([0, 0]);
  expect(gapWeights([at(2026, 11, 14, 11, 0), at(2026, 11, 14, 10, 0)])).toEqual([0, 0]);
  expect(gapWeights([])).toEqual([]);
});

test("ISO strings count the same as epoch milliseconds", () => {
  const iso = (ms) => new Date(ms).toISOString();
  expect(gapWeights([iso(at(2026, 11, 14, 10, 0)), iso(at(2026, 11, 14, 10, 5))])).toEqual([0, 1.792]);
});

test("versions split into runs per local day, labelled relative to now", () => {
  const ts = [at(2026, 11, 13, 21, 10), at(2026, 11, 13, 21, 40), at(2026, 11, 14, 10, 5), at(2026, 11, 15, 19, 20), at(2026, 11, 15, 20, 1)];
  expect(splitDays(ts, NOW)).toEqual([
    { label: "Fri 13 Nov", start: 0, end: 2 },
    { label: "Yesterday", start: 2, end: 3 },
    { label: "Today", start: 3, end: 5 },
  ]);
});

test("two minutes across midnight are two days", () => {
  expect(splitDays([at(2026, 11, 14, 23, 59), at(2026, 11, 15, 0, 1)], NOW).map((d) => d.label))
    .toEqual(["Yesterday", "Today"]);
});

test("another year shows the year; a future day is never Today", () => {
  expect(splitDays([at(2025, 12, 31, 23, 0)], NOW)[0].label).toBe("Wed 31 Dec 2025");
  expect(splitDays([at(2026, 11, 16, 8, 0)], NOW)[0].label).toBe("Mon 16 Nov");
});

test("undated versions never start a day", () => {
  expect(splitDays([at(2026, 11, 14, 10, 0), undefined, at(2026, 11, 14, 11, 0), undefined, at(2026, 11, 15, 9, 0)], NOW))
    .toEqual([{ label: "Yesterday", start: 0, end: 4 }, { label: "Today", start: 4, end: 5 }]);
  expect(splitDays([undefined, at(2026, 11, 15, 9, 0)], NOW)).toEqual([{ label: "Today", start: 0, end: 2 }]);
  expect(splitDays([undefined, null, "nope"], NOW)).toEqual([{ label: "", start: 0, end: 3 }]);
  expect(splitDays([], NOW)).toEqual([]);
});

test("savedLabel is the day label plus zero-padded local time", () => {
  expect(savedLabel(at(2026, 11, 15, 9, 5), NOW)).toBe("Today 09:05");
  expect(savedLabel(at(2026, 11, 14, 16, 45), NOW)).toBe("Yesterday 16:45");
  expect(savedLabel(at(2026, 11, 13, 21, 40), NOW)).toBe("Fri 13 Nov 21:40");
  expect(savedLabel(undefined, NOW)).toBe("");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun run test -- test/frontend/version-timeline-layout`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three exports in `frontend/src/js/ui/version-timeline-layout.ts`**

Weekday and month names come from fixed English arrays (`Sun…Sat`, `Jan…Dec`), not `toLocaleDateString`, so the output never varies with the browser locale. "Today"/"Yesterday" compare local calendar dates (difference of exactly 0 or 1 day before `now`), not elapsed hours. Keep the timestamp-parsing and day-label helpers module-private. File header and JSDoc on each export, per AGENTS.md.

- [ ] **Step 4: Run to verify they pass**

Run: `bun run test -- test/frontend/version-timeline-layout`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/version-timeline-layout.ts test/frontend/version-timeline-layout.test.js docs/superpowers/specs/2026-11-15-version-time-strip-design.md docs/superpowers/plans/2026-11-15-version-time-strip.md
git commit -m "feat(history): time and day helpers for the version time strip"
```

---

### Task 2: Render the time strip

**Files:**
- Modify: `frontend/src/js/ui/version-timeline.ts` (the `render` and `initVersionTimeline` functions; tooltip, `formatTimestamp`, `KEYS`, `onKeydown` stay as they are)
- Modify: `frontend/src/scss/components/_version-timeline.scss`
- Test: `test/frontend/version-timeline.test.js` (add tests; do not change existing ones)

**Interfaces:**
- Consumes: `gapWeights`, `splitDays`, `savedLabel`, `TimelineDay` from Task 1 (import from `./version-timeline-layout.ts`).
- Produces this DOM, which Task 3 and the E2E selectors rely on:

```
#versionTimeline                      role="slider", aria-* exactly as today
  div.vt-track                        created once in init, children replaced per render
    div.vt-day                        one per TimelineDay
      div.vt-day-ticks
        span.vt-gap                   style: --vt-gap: <weight>
        button.vt-tick.tabular        text = number; classes/attrs/listeners as today
      div.vt-day-label                text = day label; element omitted when label is ""
  div.vt-current                      created once in init, children replaced per render
    div.vt-current-meta.tabular       "v14 · Today 20:01"  (just "v14" when undated)
      span.vt-current-published       "Published", only when the active version is the published one
    div.vt-current-prompt             first line of entry.chat[0].prompt; omitted when absent
```

Gap rule: inside a day, every tick except the day's first is preceded by a `span.vt-gap` carrying that tick's weight. At a boundary between two days the weight is split in half: the earlier day's `.vt-day-ticks` ends with a gap of half the weight and the later day's begins with a gap of the other half. So the gap count is `(ticks − 1) + (days − 1)`.

- [ ] **Step 1: Add the failing tests** to `test/frontend/version-timeline.test.js`

Add next to the existing `ticks` helper:

```js
const q = (sel) => strip().querySelector(sel);
const gaps = () => [...strip().querySelectorAll(".vt-gap")].map((g) => g.style.getPropertyValue("--vt-gap"));
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
function setTimes(times, opts) {
  setChain(times.length, opts);
  versionStore.entries.forEach((e, i) => { e.timestamp = times[i]; });
  notify();
}
```

Tests:

```js
test("gaps between ticks carry the time weight", () => {
  setTimes([local(2026, 10, 3, 10, 0), local(2026, 10, 3, 10, 5), local(2026, 10, 3, 13, 5)]);
  expect(gaps()).toEqual(["1.792", "5.198"]);
});

test("a day change starts a new day group and splits the gap across the divider", () => {
  setTimes([local(2026, 7, 14, 10, 0), local(2026, 7, 15, 10, 0)]); // July: no DST change anywhere
  expect(strip().querySelectorAll(".vt-day").length).toBe(2);
  expect(strip().querySelectorAll(".vt-day-label").length).toBe(2);
  expect(gaps().map(Number)).toEqual([3.6365, 3.6365]);
  expect(ticks().map((t) => t.textContent.trim())).toEqual(["1", "2"]);
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
  HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  setChain(3, { active: 1 });
  expect(scrolled.at(-1)).toBe(ticks()[1]);
  delete HTMLElement.prototype.scrollIntoView;
});

test("track and details elements persist across renders", () => {
  setChain(2);
  const track = q(".vt-track");
  const current = q(".vt-current");
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
```

- [ ] **Step 2: Run to verify the new tests fail and the old ones still pass**

Run: `bun run test -- test/frontend/version-timeline.test`
Expected: the 10 new tests FAIL; the 12 existing tests PASS.

- [ ] **Step 3: Implement the rendering in `version-timeline.ts`**

- `initVersionTimeline()` appends `.vt-track` and `.vt-current` to the root once, before the first `render`.
- `render(root, s)` computes `new Date()` once per call, builds the DOM above with `splitDays`/`gapWeights` over `s.entries.map((e) => e.timestamp)`, and fills `.vt-current` from `s.entries[store.activeIndex()]`. When the chain is empty it clears both regions and returns after setting `hidden`.
- Set gaps with `gap.style.setProperty("--vt-gap", String(weight))`.
- Set all text with `textContent`. The prompt element also gets `title` = the full first line.
- After building, call `activeTick?.scrollIntoView?.({ block: "nearest", inline: "nearest" })`.
- Tick creation (class, `tabIndex = -1`, `disabled`, `aria-current`, `vt-tick-published`, click and tooltip listeners) is unchanged; move it into a small `createTick(entry, i, s, active)` helper so `render` stays short (the pre-commit `fallow audit` gate flags complexity).
- Update the file header comment: it describes "numbered ticks"; it now describes the time strip.

- [ ] **Step 4: Run to verify all tests pass**

Run: `bun run test -- test/frontend/version-timeline`
Expected: PASS for both `version-timeline.test.js` (22 tests) and `version-timeline-layout.test.js` (8 tests).

- [ ] **Step 5: Restyle `_version-timeline.scss`**

Keep `.vt-tooltip` as it is. Replace the `.version-timeline`, `.vt-tick` and `.vt-tick-published` rules. These are the decisions; fill in the rest in the file's existing style:

```scss
.version-timeline {
  display: flex;
  align-items: stretch;
  gap: var(--size-3);
  min-height: 56px;
  padding: 0 var(--size-2);
  background: var(--sidebar-bg);
  border-top: var(--border-size-1) solid var(--border-hairline);
  container-type: inline-size; // lets .vt-current hide on a narrow stage

  &[hidden] { display: none; }
}

.vt-track { flex: 1 1 auto; min-width: 0; display: flex; overflow-x: auto; }

.vt-day {
  flex: 0 1 auto;
  min-width: min-content; // ticks and the label never get squeezed; only gaps shrink
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 var(--size-1);

  & + & { border-left: var(--border-size-1) solid var(--border-hairline); }
}

.vt-day-ticks { display: flex; align-items: flex-end; }

// Ideal width = weight × 2rem; shrinks proportionally to 0 before the track scrolls.
.vt-gap { flex: 0 1 calc(var(--vt-gap, 0) * var(--size-7)); }

.vt-day-label { font-size: var(--font-size-0); color: var(--dim-fg); white-space: nowrap; }

.vt-current {
  flex: 0 1 260px;
  min-width: 0;
  align-self: center;
  padding-left: var(--size-3);
  border-left: var(--border-size-1) solid var(--border-hairline);
}

@container (max-width: 480px) {
  .vt-current { display: none; }
}
```

Remaining rules to write:

- `.vt-tick`: `flex: 0 0 auto`, `min-width: 24px`, column layout with the number above an 8px round dot drawn with `::after`; number in `--font-size-0` and `--dim-fg`; dot in `--border-color`; no border, transparent background, pointer cursor; `:disabled` as today.
- A hairline joins the dots along each day (draw it on `.vt-gap`, vertically centred on the dots).
- `.vt-tick[aria-current="true"]`: number in `--accent-text` and `--font-weight-6`; dot in `--accent-text` with a halo `box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-text) 25%, transparent)`. Remove the old underline `box-shadow`.
- `.vt-tick-published::after`: a ring, `background: var(--sidebar-bg)` with a 2px `--success` border, same outer size as the other dots. Remove the old `::before` dot.
- `.vt-current-meta`: `--font-size-0`, `--dim-fg`. `.vt-current-published`: `--success`, `--font-weight-6`, `margin-left: var(--size-2)`. `.vt-current-prompt`: `--font-size-1`, one line, `text-overflow: ellipsis`.
- Keep a visible `:focus-visible` on ticks using `--focus-ring`.

This is the first `@container` query in the codebase; that is intended (the stage width depends on which sidebars are open, which a media query cannot see).

- [ ] **Step 6: Build and run the style and type gates**

Run: `bun run build:frontend && bun run test -- test/frontend/theme-contrast test/frontend/style-guards && bun run typecheck:frontend && bun run lint`
Expected: build succeeds; both test files PASS; typecheck and lint report no errors.

- [ ] **Step 7: Check it in a real browser**

Use the repo's `run` skill (or the worktree's dev stack per `arbesk-worktree`) to open Studio on an asset with at least 3 versions. Confirm, in Graphite and in Paper:
- ticks sit on a joined baseline, never overlap, and a longer pause leaves a visibly larger gap;
- a day divider and label appear where the day changes, and labels do not overlap;
- the details on the right name the active version and update when you click a tick or press ←/→/Home/End;
- the published tick is a ring;
- hovering a tick still shows the tooltip above the strip;
- narrowing the window hides the details and leaves the ticks usable.

Then check a long chain without creating one: in the browser console, clone ticks until there are 120 (`const d = document.querySelector(".vt-day-ticks"); for (let i = 0; i < 110; i++) d.append(d.querySelector(".vt-tick").cloneNode(true));`) and confirm the track scrolls horizontally and no tick is narrower than 24px. Fix what you find before committing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/js/ui/version-timeline.ts frontend/src/scss/components/_version-timeline.scss test/frontend/version-timeline.test.js
git commit -m "feat(history): space versions by time, mark days, show the active version"
```

---

### Task 3: E2E coverage and docs

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs:100-103` (add one selector)
- Modify: `e2e/specs/04-parametric-version.spec.js:52,80` (two assertions)
- Modify: `.agents/skills/edit-ui/references/e2e-sync.md:41`, `.agents/skills/edit-ui/references/deep-dive.md:42`, `docs/ARCHITECTURE.md:178,413`, `docs/hig/implementation.md:69,191`, `e2e/README.md:156`

**Interfaces:**
- Consumes: `.vt-current` and `.vt-current-meta` from Task 2.
- Produces: `SELECTORS.vtCurrent = "#versionTimeline .vt-current"`.

- [ ] **Step 1: Add the selector and the failing assertions**

In `studio-selectors.mjs`, after `vtTooltip`: `vtCurrent: "#versionTimeline .vt-current",`

In spec 04, directly after the `vtActiveTick` `toHaveText("3")` assertion in step 5:

```js
    await expect(page.locator(SELECTORS.vtCurrent)).toContainText("v3 · Today");
```

and directly after the `vtActiveTick` `toHaveText("1")` assertion in step 6:

```js
    await expect(page.locator(SELECTORS.vtCurrent)).toContainText("v1 · Today");
```

- [ ] **Step 2: Run the two specs that touch the strip**

Run: `bun run test:e2e -- --project=chromium e2e/specs/04-parametric-version.spec.js e2e/specs/30-representations.spec.js`
Expected: PASS (the frontend from Task 2 is already built; if `dist/` is stale, run `bun run build:frontend` first). If a run starts within a minute of local midnight the `Today` assertions can miss; rerun.

- [ ] **Step 3: Update the docs**

- `e2e-sync.md:41`: add `vtCurrent` to the selector list for spec 04.
- `deep-dive.md:42`: describe `version-timeline.ts` as "Version time strip (APG slider): ticks spaced by time, day groups, active-version details", and add a row for `frontend/src/js/ui/version-timeline-layout.ts` — "Pure helpers: gap weights, day grouping, save-time labels".
- `docs/ARCHITECTURE.md:178` and `docs/hig/implementation.md:191`: add `ui/version-timeline-layout.ts` to the file list in those rows.
- `docs/ARCHITECTURE.md:413`, `docs/hig/implementation.md:69`, `e2e/README.md:156`: where the strip is described, say it is spaced by time and names the active version. One clause each; do not restructure.

- [ ] **Step 4: Run the full gates**

Run: `bun run test:frontend && bun run test:e2e -- --project=chromium`
Expected: PASS for both. AGENTS.md requires the full E2E suite before merging Studio UI changes.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/specs/04-parametric-version.spec.js .agents/skills/edit-ui/references docs/ARCHITECTURE.md docs/hig/implementation.md e2e/README.md
git commit -m "test(history): cover the time strip's active-version details; update docs"
```

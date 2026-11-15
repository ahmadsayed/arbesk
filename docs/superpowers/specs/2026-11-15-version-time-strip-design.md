# Version Time Strip — Design

**Date:** 2026-11-15 · **Status:** approved 2026-11-15 (amended the same day, see §5 items 6–8) · **Size:** small change (one UI component, no data or API changes)
**Supersedes:** §5 "Ticks" and the 36px row of `2026-10-04-version-timeline-design.md`. Everything else in that spec still holds.

## 1. Why

The strip under the viewport shows only the numbers `1 … 14`. The save time,
prompt and thumbnail of each version exist, but only inside a hover tooltip, so
the strip says nothing about *when* work happened or *what* the current version
is. Ahmed asked for "a better idea for the history" and, after comparing three
clickable mocks, picked the **time strip**.

(The diagnosis above is Claude's reading of the screenshot and code; Ahmed has
not stated a specific complaint beyond wanting something better.)

## 2. Goals, non-goals, anti-goals

**Goals**

- At a glance, see how the versions cluster in time: bursts of saves, long
  pauses, and which day each belongs to.
- Always see what the active version is (number, save time, prompt, published
  or not) without hovering.
- Stay slim: the strip is a navigation aid, not a panel.

**Non-goals**

- Thumbnails in the strip itself (they stay in the hover tooltip).
- Previewing a version in the viewport on hover.
- A history list in the sidebar.
- Drag-scrubbing, per-node history, deleting or reordering versions.

**Anti-goals** (failure even if it technically works)

- Two ticks overlapping, or a tick too small to click.
- Any regression of the keyboard slider or of the existing E2E selectors.
- Colours or sizes that are not theme tokens, or that fail contrast in Paper.

## 3. Approaches

| | What it is | Trade-off |
|---|---|---|
| A · Filmstrip | Thumbnail per version, active one expands, hover previews in viewport | Richest, but ~78px tall and depends on best-effort thumbnails. Claude's recommendation. |
| B · History panel | List in the right sidebar: thumbnail, prompt, time | Most readable, but takes sidebar space from Properties and loses left-to-right stepping |
| **C · Time strip** | Slim row, ticks spaced by time between saves, day dividers, active version's details on the right | Cheapest; no pictures until hover |

**Picked: C**, by Ahmed on 2026-11-15 after trying all three in the mock
(`.superpowers/brainstorm/15388-1794744311/content/history-options-v4.html`,
tab "C · Time strip"; that file is git-ignored, so it is a local reference only).

## 4. Design

Same element, same place: `#versionTimeline` in `studio-main.pug`, still hidden
when the chain is empty. It grows from 36px to about 56px and gains two regions:

```
┌────────────────────────────────────────────────────────────┬───────────────────┐
│  1  2  3  4  5  │   6  7   8    9   10      11  │  12  13  14 │ v14 · Today 20:01 │
│  ●──●──●──●──●──┼───●──●───●────●───●───────●───┼──○───●───◉  │ make the hat red  │
│  Fri 13 Nov     │ Yesterday                     │ Today       │                   │
└────────────────────────────────────────────────────────────┴───────────────────┘
        track (scrolls if it must)                                active version
```

### 4.1 Ticks

- Still one `<button class="vt-tick">` per version whose text is the 1-based
  number, so `vtTicks`, `vtActiveTick` and `toHaveText("3")` keep working.
- Each tick has a dot on a shared baseline under its number (drawn with a
  pseudo-element so the button's text stays just the number).
- Active: accent number and accent dot with a soft halo; `aria-current="true"`.
- Published: the dot is a `--success` ring instead of a filled dot, so it
  differs by shape and not only by colour (class `vt-tick-published` stays).
- Loading: all ticks disabled, `aria-busy` on the root, as today.
- Click loads that version; clicking the active one is a no-op, as today.

### 4.2 Spacing by time

- The gap between two neighbouring versions grows with the time between their
  saves, on a log scale: weight = `log(1 + minutes between saves)`. A 7-minute
  gap and an overnight gap are both readable; linear spacing would crush every
  same-session save into one pixel.
- Every tick keeps a minimum 24px slot, so ticks never overlap.
- Each gap has an ideal width proportional to its weight. A short history sits
  compact at the left; a longer one compresses its gaps proportionally to fit;
  once the gaps are gone (long chains) the track scrolls horizontally and the
  active tick is scrolled into view on every render.
- A version with a missing or invalid `timestamp`, or one older than its
  predecessor, gets the minimum gap.

### 4.3 Day dividers

- Where two neighbouring versions fall on different local calendar days, a
  hairline divider sits in the gap between them, with the newer day's label
  after it. The first day's label sits at the start of the track.
- Labels: `Today`, `Yesterday`, otherwise `Fri 13 Nov` (weekday, day, month;
  add the year when it is not the current year). Sentence case, dim, smallest type size.
- Labels never overlap each other; a day needs enough width for its label.
- Versions with no usable timestamp do not start a new day.

### 4.4 Active version details

A fixed region on the right, outside the scrolling track:

- Line 1: `v14 · Today 20:01`, plus a `Published` mark when the active version
  is the published one.
- Line 2: the first line of the version's first chat prompt, one line, ellipsis
  on overflow. Omitted when there is no prompt.
- It hides when the stage is too narrow to leave the track usable space.

### 4.5 Unchanged

- Keyboard: the root stays the single-tab-stop APG slider (←/↓ older, →/↑
  newer, Home, End), with the same `aria-value*` attributes.
- Hover/focus tooltip: thumbnail, `v9 · time`, prompt. Escape dismisses.
- Store contract (`getState`, `activeIndex`, `subscribe`, `loadVersion`).

## 5. Claude's calls (not discussed; say if any is wrong)

1. **Absolute day-relative time, not "2 min ago".** The mock showed "2 min ago",
   but the strip only re-renders when the store changes, so a relative age would
   go stale while you look at it. `Today 20:01` is always true.
2. **Log scale** for the gaps, as in the mock.
3. **Long chains scroll** rather than squeezing ticks below 24px.
4. **Details region hides on narrow stages** instead of wrapping to a second row.
5. **Local time zone** decides which day a version belongs to.

Added while planning, after approval:

6. **Day labels are sentence case, not uppercase.** The mock used uppercase, but
   `test/frontend/style-guards.test.js` forbids `text-transform: uppercase` in
   components (design language: sentence case).
7. **Published is a ring, not just a green dot.** Every tick now has a dot, so
   colour alone would be the only difference (WCAG 1.4.1).
8. **Short histories stay compact** instead of stretching across the strip. Two
   versions saved three minutes apart should not sit at opposite ends.

## 6. Constraints

- Tokens only, in both Graphite and Paper; any new derived text/background pair
  goes into `DERIVED_TEXT_PAIRS` in `test/frontend/theme-contrast.test.js`.
- Tick dots are non-text UI and need 3:1 against the strip background.
- Frontend changes follow the `edit-ui` skill (Pug/SCSS/JS conventions, rebuild).

## 7. Tests and docs

- `test/frontend/version-timeline.test.js`: keep every existing contract test;
  add: a longer time gap produces a larger gap weight; missing/out-of-order
  timestamps fall back to the minimum; one divider per calendar-day change with
  the right label; details region shows number, time, prompt and the published
  mark, and omits the prompt line when there is none.
- E2E: existing selectors unchanged. Add `vtCurrent` to `studio-selectors.mjs`
  and one assertion in spec 04 that it names the active version after a switch.
- Update the strip's description in `docs/ARCHITECTURE.md`,
  `docs/hig/implementation.md` and the edit-ui skill's `deep-dive.md`.

## 8. Left to the builder

- Exact pixel sizes, and whether spacing is done with flex weights or measured
  positions, as long as §4.2 holds.
- The breakpoint at which the details region hides.
- Class names for the new parts (`vt-track`, `vt-day`, `vt-current` suggested).

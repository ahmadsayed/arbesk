# Version Timeline Strip — Design (UI refresh Phase 4, issue #85)

**Date:** 2026-10-04 · **Status:** approved in brainstorm · **Issue:** #85 · **Epic:** #87

## 1. Why

Version history is Arbesk's hero feature, but its main entry is a collapsed
watch-face dial (the scene clock) that hides in the viewport's corner and
expands only on hover, plus a per-node 3D ring reachable through the V-key
"time mode". Neither reads as a timeline, and the dial's radial layout wastes
the mental model users already have from git/video editors: a horizontal
strip of versions under the viewport.

This phase adds a slim, always-visible, keyboard-operable timeline strip under
the viewport and retires the scene clock dial. The V-key time mode and its
per-node ring gizmo stay untouched — the strip is the whole-asset timeline;
the ring remains the per-node timeline.

## 2. What exists

- `@arbesk/asset-core/domain/version-history-store.js` — `getState()`
  (`entries` oldest→newest, `activeCid`, `publishedCid`, `isLoading`),
  `activeIndex()`, `subscribe(fn)`, `loadVersion(cid)`.
- `ui/scene-clock.ts` — viewport-corner host for `createVersionClock`
  (`ui/version-clock.ts`, 316 lines of radial SVG dial), hidden when the
  chain is empty; commits via `loadVersion`.
- `ui/model-clock-gizmo.ts` — 3D ring around a selected node (per-node
  versions), entered via the toolbar's Time mode / V key. **Unchanged.**
- Each manifest version carries `metadata.chat` (version-scoped prompts) and
  a best-effort `thumbnail`.
- E2E: spec 04 drives the dial via `sceneClock` / `sceneClockBadge` /
  `sceneClockDial` and a `flows.mjs` dial helper (~line 371).
- Layout: `#mainStage` is a flex column holding `#viewport`; the bottom bar
  spans the app below it.

## 3. Decisions (locked in brainstorm)

1. **Scope:** the strip replaces the scene clock only. Time mode, the V key,
   and the per-node model ring are untouched.
2. **Content:** numbered ticks (`1 · 2 · 3 · …` in `.tabular`), active
   version highlighted, published version marked, hover/focus tooltip with
   thumbnail + timestamp + chat prompt.
3. **Keyboard:** WAI-ARIA APG slider pattern on the strip container.
4. **Implementation:** new `ui/version-timeline.ts`; the dial stack
   (`scene-clock.ts`, `version-clock.ts`, `_version-clock.scss`, their unit
   tests) is deleted.

## 4. Component & placement

`ui/version-timeline.ts` creates `#versionTimeline` — but mounted declaratively:
a Pug sibling in `studio-main.pug` right after `#viewport` inside
`#mainStage`, so layout, theme, and tab order come free:

```pug
#viewport.viewport …
#versionTimeline.version-timeline(hidden)
```

The row is ~36px, `border-top` hairline, `--sidebar-bg` background (the
chrome surface token), horizontally scrollable if versions overflow
(`overflow-x: auto`; ticks never shrink below touch/click sanity).

Visibility: `hidden` only when `entries.length === 0` (same rule as the
scene clock). No Library-view logic is needed — the strip lives inside
`#studioView`, which the router already `display:none`s in Library.

## 5. Ticks

Each version renders a `<button class="vt-tick">` with its 1-based number
(`.tabular`):

- **Active**: `--accent-bg` text + 2px underline bar (`aria-current="true"`).
- **Published**: a small `--success` dot above the number on the published
  tick, whether or not it is the active one.
- **Loading** (`isLoading`): all ticks `disabled` + the row gets an
  `aria-busy="true"`.
- Click → `loadVersion(entry.cid)` — identical semantics to the dial's
  commit (no-op when clicking the active version, matching
  `loadVersion`'s own guard).

## 6. Keyboard (APG slider)

The row container is the single tab stop:

- `role="slider"`, `tabindex="0"`, `aria-label="Version timeline"`,
  `aria-orientation="horizontal"`, `aria-valuemin="1"`,
  `aria-valuemax={entries.length}`, `aria-valuenow={activeIndex+1}`,
  `aria-valuetext="v3 of 12 · saved 2026-10-04 14:32"` (tabular date via the
  entry timestamp).
- ←/↓ = older, →/↑ = newer, Home = oldest, End = newest. Keys are handled
  only when the slider has focus; `preventDefault` on handled keys.
- Tick buttons are `tabindex="-1"` (APG single-stop slider); they remain
  click/Enter targets for pointer users and screen-reader browse mode.

## 7. Tooltip

Hover or keyboard-focus on a tick shows a fixed-positioned card above the
strip (the Phase 1 `menu-button.ts` overflow lesson — never inside the
scrollable row):

- thumbnail `<img>` when the version's manifest has one (tolerate missing:
  hide the img, keep the text);
- `v3` + save timestamp (`2026-10-04 14:32`, `.tabular`);
- the version's first `metadata.chat` prompt line, truncated to ~80 chars,
  when present.

Dismiss on pointer-leave/blur/Esc. One tooltip at a time; content is rebuilt
per tick.

## 8. Removals & migrations

- Delete: `frontend/src/js/ui/scene-clock.ts`, `frontend/src/js/ui/version-clock.ts`,
  `frontend/src/scss/components/_version-clock.scss` (and its `@use` in
  `styles.scss`), `test/frontend/scene-clock.test.js`,
  `test/frontend/version-clock.test.js`.
- `_version-clock.scss`'s `--success`/`--warning` derived pairs in
  `DERIVED_TEXT_PAIRS` (`theme-contrast.test.js`) drop the version-clock
  entries (check each: the 22% warning tint pair is shared with library-grid
  statuses — keep shared pairs, drop clock-only ones).
- `docs/CURRENT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/hig/implementation.md`,
  and the edit-ui skill's `deep-dive.md`/`e2e-sync.md` references update to
  the strip.
- `keyboard-help.ts`: no change (V stays documented — it enters time mode,
  which survives).

## 9. E2E

- `studio-selectors.mjs`: replace `sceneClock` / `sceneClockDial` /
  `sceneClockBadge` with `versionTimeline: "#versionTimeline"`,
  `vtTicks: "#versionTimeline .vt-tick"`,
  `vtActiveTick: "#versionTimeline .vt-tick[aria-current='true']"`,
  `vtTooltip: ".vt-tooltip"`. `modelClock*` selectors stay.
- `flows.mjs`: the dial helper (~line 371, "keyboard contract of
  version-clock.js") becomes `gotoVersion(page, n)` — focus the slider,
  `Home`, then ArrowRight × (n−1)… or simply click tick `n`; keep the
  keyboard path in a dedicated assertion instead.
- Spec 04 (`04-parametric-version.spec.js`) migrates: badge `v3`/`v1`
  assertions become `aria-valuenow` / active-tick text assertions on the
  strip; the dial keyboard contract becomes slider keyboard assertions
  (ArrowLeft/Right change `aria-valuenow`; Home/End jump).
- New: strip hidden with no asset / single version; tooltip appears on
  hover with the prompt text.

## 10. Testing (unit)

`test/frontend/version-timeline.test.js` (`// @test-env dom`, mock the
version-history store like `asset-chrome.test.js` does):

- renders N ticks from store entries; hidden when empty;
- active tick marked (`aria-current`), published dot present on the right tick;
- click commits `loadVersion(cid)`; click on active is a no-op;
- slider aria attrs (`valuemin/max/now/valuetext`) track the store;
- ArrowRight/ArrowLeft/Home/End move and commit;
- `isLoading` disables ticks;
- tooltip content: thumbnail shown when present, prompt truncated, timestamp
  formatted.

## 11. Out of scope

- Per-node version history in the strip (stays on the model ring).
- Editing the chain from the strip (delete/reorder versions — not a thing).
- Visible unsaved-draft state (that's #86).
- Touch gestures / drag scrubbing on the strip.

## 12. Risks

- **Spec 04 is the deepest clock consumer** — its migration is the bulk of
  the E2E work; keep the assertions behavior-identical (v1/v3 flow).
- **The tooltip and the strip's horizontal scroll** interact (clipping):
  fixed positioning sidesteps it; verify in the browser check at 1440×900
  with a long chain (generate 3+ versions).
- **Deleting version-clock deletes its test coverage of loadVersion commit
  semantics** — the strip's unit tests must cover the same contract (commit
  on click, keyboard commit, no-op on active).

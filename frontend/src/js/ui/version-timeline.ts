/**
 * Version time strip under the viewport.
 * @remarks One numbered tick per manifest version, keyboard-operable as an
 *   APG slider. Ticks are spaced by the time between saves and grouped into
 *   local calendar days (`.vt-track`); the active version's number, save time
 *   and prompt are always shown beside them (`.vt-current`). Hidden when the
 *   chain is empty; the router's Library view hides the whole Studio view, so
 *   no per-view visibility logic lives here.
 */

import * as store from "@arbesk/asset-core/domain/version-history-store.js";
import type { VersionHistoryState } from "@arbesk/asset-core/domain/version-history-store.js";
import { gatewayBase } from "../ipfs/remote-ipfs.ts";
import { gapWeights, savedLabel, splitDays } from "./version-timeline-layout.ts";

const ROOT_ID = "versionTimeline";

let tooltip: HTMLElement | null = null;

/** @returns a new element with the given class and, optionally, text. */
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @returns the first line of the version's first chat prompt, if any.
 * @remarks `metadata.chat` comes from the manifest unvalidated, so anything
 *   but a string is ignored rather than allowed to throw mid-render.
 */
function firstPromptLine(entry: any): string | undefined {
  const prompt = entry.chat?.[0]?.prompt;
  return typeof prompt === "string" ? prompt.split("\n")[0] : undefined;
}

function hideTooltip(): void {
  tooltip?.remove();
  tooltip = null;
}

/** Fixed-position card above a tick — never inside the scrollable strip. */
async function showTooltip(
  tick: HTMLElement,
  entry: any,
  n: number
): Promise<void> {
  hideTooltip();
  const tip = document.createElement("div");
  tip.className = "vt-tooltip";
  tip.setAttribute("role", "tooltip");
  const title = document.createElement("div");
  title.className = "vt-tooltip-title tabular";
  const ts = formatTimestamp(entry.timestamp);
  title.textContent = `v${n}${ts ? ` · ${ts}` : ""}`;
  tip.appendChild(title);
  const prompt = firstPromptLine(entry);
  if (prompt) {
    const p = document.createElement("div");
    p.className = "vt-tooltip-prompt";
    p.textContent = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
    tip.appendChild(p);
  }
  document.body.appendChild(tip);
  const r = tick.getBoundingClientRect();
  tip.style.left = `${r.left + r.width / 2}px`;
  tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
  tooltip = tip;
  // Thumbnail last: async gateway resolution must not block the card.
  if (entry.thumbnail?.cid) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `${await gatewayBase()}${entry.thumbnail.cid}`;
    tip.prepend(img);
  }
}

/** @returns `YYYY-MM-DD HH:MM` local time, or "" for missing/invalid input. */
function formatTimestamp(ts: unknown): string {
  if (ts == null) return "";
  const d = new Date(ts as string | number);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const KEYS: Record<string, (i: number, n: number) => number> = {
  ArrowLeft: (i) => i - 1,
  ArrowDown: (i) => i - 1,
  ArrowRight: (i) => i + 1,
  ArrowUp: (i) => i + 1,
  Home: () => 0,
  End: (_i, n) => n - 1,
};

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    if (tooltip) e.preventDefault();
    hideTooltip();
    return;
  }
  const move = KEYS[e.key];
  if (!move) return;
  const { entries, activeCid } = store.getState();
  if (entries.length === 0) return;
  const next = Math.min(
    Math.max(move(store.activeIndex(), entries.length), 0),
    entries.length - 1
  );
  e.preventDefault();
  const entry = entries[next];
  if (entry && entry.cid !== activeCid) store.loadVersion(entry.cid);
}

/** One version's tick: its 1-based number; click loads it, hover/focus shows the card. */
function createTick(
  entry: any,
  i: number,
  s: VersionHistoryState,
  active: number
): HTMLButtonElement {
  const tick = document.createElement("button");
  tick.type = "button";
  tick.className = "vt-tick tabular";
  tick.tabIndex = -1;
  tick.disabled = s.isLoading;
  tick.textContent = String(i + 1);
  if (i === active) tick.setAttribute("aria-current", "true");
  if (entry.cid === s.publishedCid) tick.classList.add("vt-tick-published");
  tick.addEventListener("click", () => {
    if (entry.cid !== s.activeCid) store.loadVersion(entry.cid);
  });
  tick.addEventListener("pointerenter", () => showTooltip(tick, entry, i + 1));
  tick.addEventListener("focus", () => showTooltip(tick, entry, i + 1));
  tick.addEventListener("pointerleave", hideTooltip);
  tick.addEventListener("blur", hideTooltip);
  return tick;
}

/** Spacer whose ideal width the stylesheet derives from `--vt-gap`. */
function createGap(weight: number): HTMLElement {
  const gap = el("span", "vt-gap");
  gap.style.setProperty("--vt-gap", String(weight));
  return gap;
}

/**
 * Fills the track with one group per calendar day.
 * @remarks Inside a day each tick is preceded by its time gap. Across a day
 *   boundary the gap is split in half on either side of the divider. Each
 *   group carries `--vt-ticks` (tick count) and `--vt-span` (sum of its gap
 *   weights): the stylesheet sizes the group from them, because a flex
 *   container's intrinsic width ignores its items' flex-basis.
 */
function renderTrack(
  track: HTMLElement,
  s: VersionHistoryState,
  active: number,
  now: Date
): void {
  const stamps = s.entries.map((entry) => entry.timestamp);
  const weights = gapWeights(stamps);
  const days = splitDays(stamps, now);
  track.replaceChildren(
    ...days.map((day, d) => {
      const row = el("div", "vt-day-ticks");
      let span = 0;
      const addGap = (weight: number) => {
        span += weight;
        row.appendChild(createGap(weight));
      };
      for (let i = day.start; i < day.end; i++) {
        if (i > 0) addGap(i === day.start ? weights[i] / 2 : weights[i]);
        row.appendChild(createTick(s.entries[i], i, s, active));
      }
      const next = days[d + 1];
      if (next) addGap(weights[next.start] / 2);
      const group = el("div", "vt-day");
      group.style.setProperty("--vt-ticks", String(day.end - day.start));
      group.style.setProperty("--vt-span", String(span));
      group.appendChild(row);
      if (day.label) group.appendChild(el("div", "vt-day-label", day.label));
      return group;
    })
  );
  track
    .querySelector('.vt-tick[aria-current="true"]')
    ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** Fills the details block: `v14 · Today 20:01`, published mark, prompt line. */
function renderCurrent(
  current: HTMLElement,
  s: VersionHistoryState,
  active: number,
  now: Date
): void {
  const entry = s.entries[active];
  if (!entry) {
    current.replaceChildren();
    return;
  }
  const saved = savedLabel(entry.timestamp, now);
  const meta = el(
    "div",
    "vt-current-meta tabular",
    `v${active + 1}${saved ? ` · ${saved}` : ""}`
  );
  if (entry.cid === s.publishedCid)
    meta.appendChild(el("span", "vt-current-published", "Published"));
  current.replaceChildren(meta);
  const prompt = firstPromptLine(entry);
  if (prompt) {
    const line = el("div", "vt-current-prompt", prompt);
    line.title = prompt;
    current.appendChild(line);
  }
}

function render(
  root: HTMLElement,
  track: HTMLElement,
  current: HTMLElement,
  s: VersionHistoryState
): void {
  root.hidden = s.entries.length === 0;
  if (root.hidden) {
    track.replaceChildren();
    current.replaceChildren();
    return;
  }
  const active = store.activeIndex();
  root.setAttribute("aria-busy", String(s.isLoading));
  root.setAttribute("aria-valuemin", "1");
  root.setAttribute("aria-valuemax", String(s.entries.length));
  root.setAttribute("aria-valuenow", String(active + 1));
  const ts = formatTimestamp(s.entries[active]?.timestamp);
  root.setAttribute(
    "aria-valuetext",
    `v${active + 1} of ${s.entries.length}${ts ? ` · saved ${ts}` : ""}`
  );
  const now = new Date();
  renderTrack(track, s, active, now);
  renderCurrent(current, s, active, now);
}

function initVersionTimeline(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  // Both regions persist across renders so the track keeps its scroll position.
  const track = el("div", "vt-track");
  const current = el("div", "vt-current");
  root.replaceChildren(track, current);
  root.addEventListener("keydown", onKeydown);
  store.subscribe((s) => render(root, track, current, s));
  render(root, track, current, store.getState());
}

initVersionTimeline();

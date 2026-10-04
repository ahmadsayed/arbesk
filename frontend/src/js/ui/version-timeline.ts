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

function render(root: HTMLElement, s: VersionHistoryState): void {
  root.hidden = s.entries.length === 0;
  if (root.hidden) return;
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
  root.addEventListener("keydown", onKeydown);
  store.subscribe((s) => render(root, s));
  render(root, store.getState());
}

initVersionTimeline();

export { initVersionTimeline };

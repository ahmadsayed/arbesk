/**
 * Version timeline strip under the viewport.
 * @remarks Replaces the scene-clock dial: numbered ticks for each manifest
 *   version, keyboard-operable as an APG slider. Hidden when the chain is
 *   empty; the router's Library view hides the whole Studio view, so no
 *   per-view visibility logic lives here.
 */

import * as store from "@arbesk/asset-core/domain/version-history-store.js";
import type { VersionHistoryState } from "@arbesk/asset-core/domain/version-history-store.js";
import { gatewayBase } from "../ipfs/remote-ipfs.ts";

const ROOT_ID = "versionTimeline";

let tooltip: HTMLElement | null = null;

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
  const prompt = entry.chat?.[0]?.prompt?.split("\n")[0];
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
      tick.addEventListener("pointerenter", () => showTooltip(tick, entry, i + 1));
      tick.addEventListener("focus", () => showTooltip(tick, entry, i + 1));
      tick.addEventListener("pointerleave", hideTooltip);
      tick.addEventListener("blur", hideTooltip);
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

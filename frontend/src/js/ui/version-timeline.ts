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

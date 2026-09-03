/**
 * Version dial for the viewport, bottom-right.
 * @remarks Collapsed to a watch face and expands on hover/focus/click; hidden
 *   when no version chain is loaded.
 */

import * as store from "@arbesk/asset-core/domain/version-history-store.js";
import type { VersionHistoryState } from "@arbesk/asset-core/domain/version-history-store.js";
import { createVersionClock } from "./version-clock.ts";

const ROOT_ID = "sceneClock";

function initSceneClock(): void {
  const viewport = document.getElementById("viewport");
  if (!viewport || document.getElementById(ROOT_ID)) return;

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "scene-clock";
  root.hidden = true;

  const clock = createVersionClock({
    onCommit(index: number) {
      const { entries, activeCid } = store.getState();
      const entry = entries[index];
      if (entry && entry.cid !== activeCid) store.loadVersion(entry.cid);
    },
  });
  root.appendChild(clock.el);
  viewport.appendChild(root);

  // Collapsed ↔ expanded
  root.addEventListener("pointerenter", () => root.classList.add("expanded"));
  root.addEventListener("pointerleave", () => {
    if (!root.contains(document.activeElement)) {
      root.classList.remove("expanded");
    }
  });
  root.addEventListener("focusin", () => root.classList.add("expanded"));
  root.addEventListener("focusout", () => root.classList.remove("expanded"));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      root.classList.remove("expanded");
      clock.el.blur();
    }
  });

  function render(s: VersionHistoryState): void {
    root.hidden = s.entries.length === 0;
    if (root.hidden) return;
    clock.update({
      entries: s.entries,
      activeIndex: store.activeIndex(),
      publishedIndex: s.entries.findIndex((e) => e.cid === s.publishedCid),
      loading: s.isLoading,
    });
  }

  store.subscribe(render);
  render(store.getState());
}

initSceneClock();

export { initSceneClock };

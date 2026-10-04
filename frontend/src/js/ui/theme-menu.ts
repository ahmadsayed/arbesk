/**
 * Header theme picker (System / Graphite / Paper).
 * @remarks Menu-button popup with menuitemradio items; the checked item
 *   tracks the stored preference, not the resolved theme.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getThemePref, setThemePref, type ThemePref } from "../engine/theme.ts";
import { initMenuButton } from "./menu-button.ts";

const PREFS: readonly ThemePref[] = ["system", "graphite", "paper"];

export function initThemeMenu(): void {
  const button = document.getElementById("themeMenuBtn");
  const menu = document.getElementById("themeMenu");
  if (!button || !menu) return;

  const sync = () => {
    const pref = getThemePref();
    menu.querySelectorAll<HTMLElement>("[data-theme-pref]").forEach((el) => {
      el.setAttribute("aria-checked", String(el.dataset.themePref === pref));
    });
  };

  initMenuButton(button, menu, {
    onSelect(item) {
      const pref = item.dataset.themePref as ThemePref | undefined;
      if (pref && PREFS.includes(pref)) setThemePref(pref);
    },
  });

  on(EVENTS.THEME_CHANGED, sync);
  sync();
}

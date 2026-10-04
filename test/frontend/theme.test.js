// @test-env dom
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const KEY = "arbesk-theme";

/** @param {boolean} dark */
function stubMatchMedia(dark) {
  /** @type {Array<() => void>} */
  const listeners = [];
  const mql = {
    matches: dark,
    addEventListener: (_t, fn) => listeners.push(fn),
    removeEventListener: () => {},
  };
  window.matchMedia = jest.fn(() => mql);
  globalThis.matchMedia = window.matchMedia;
  return {
    flip(nextDark) {
      mql.matches = nextDark;
      listeners.forEach((fn) => fn());
    },
  };
}

async function load() {
  resetModules();
  const bus = await import("@arbesk/asset-core/events/bus.js");
  const theme = await import("../../frontend/src/js/engine/theme.js");
  return { bus, theme };
}

const html = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  html().removeAttribute("data-theme");
  html().removeAttribute("data-scheme");
});

describe("readStoredPref", () => {
  test("missing value means system", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    expect(theme.readStoredPref()).toBe("system");
  });

  test("migrates legacy dark/light and rewrites storage", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    localStorage.setItem(KEY, "dark");
    expect(theme.readStoredPref()).toBe("graphite");
    expect(localStorage.getItem(KEY)).toBe("graphite");
    localStorage.setItem(KEY, "light");
    expect(theme.readStoredPref()).toBe("paper");
    expect(localStorage.getItem(KEY)).toBe("paper");
  });

  test("garbage value means system", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    localStorage.setItem(KEY, "neon");
    expect(theme.readStoredPref()).toBe("system");
  });

  test("object-prototype keys mean system", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    localStorage.setItem(KEY, "constructor");
    expect(theme.readStoredPref()).toBe("system");
    expect(localStorage.getItem(KEY)).toBe("constructor");
  });
});

describe("initTheme / setThemePref", () => {
  test("system resolves from prefers-color-scheme and follows changes", async () => {
    const mm = stubMatchMedia(true);
    const { theme } = await load();
    theme.initTheme();
    expect(html().getAttribute("data-theme")).toBe("graphite");
    expect(html().getAttribute("data-scheme")).toBe("dark");
    mm.flip(false);
    expect(html().getAttribute("data-theme")).toBe("paper");
    expect(html().getAttribute("data-scheme")).toBe("light");
  });

  test("explicit choice ignores OS changes and persists", async () => {
    const mm = stubMatchMedia(true);
    const { theme } = await load();
    theme.initTheme();
    theme.setThemePref("paper");
    expect(localStorage.getItem(KEY)).toBe("paper");
    mm.flip(true);
    expect(html().getAttribute("data-theme")).toBe("paper");
    expect(theme.getThemePref()).toBe("paper");
  });

  test("choosing system clears storage", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    theme.initTheme();
    theme.setThemePref("graphite");
    theme.setThemePref("system");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(html().getAttribute("data-theme")).toBe("paper");
  });

  test("emits THEME_CHANGED with theme and pref", async () => {
    stubMatchMedia(false);
    const { bus, theme } = await load();
    const seen = [];
    bus.on(bus.EVENTS.THEME_CHANGED, (p) => seen.push(p));
    theme.initTheme();
    theme.setThemePref("graphite");
    expect(seen.at(-1)).toEqual({ theme: "graphite", pref: "graphite" });
  });
});

describe("theme-init (pre-paint)", () => {
  async function runInit() {
    resetModules();
    await import("../../frontend/src/js/engine/theme-init.ts");
  }

  test("migrates legacy dark to graphite", async () => {
    stubMatchMedia(false);
    localStorage.setItem(KEY, "dark");
    await runInit();
    expect(html().getAttribute("data-theme")).toBe("graphite");
    expect(html().getAttribute("data-scheme")).toBe("dark");
  });

  test("explicit paper wins over a dark OS", async () => {
    stubMatchMedia(true);
    localStorage.setItem(KEY, "paper");
    await runInit();
    expect(html().getAttribute("data-theme")).toBe("paper");
    expect(html().getAttribute("data-scheme")).toBe("light");
  });

  test("no stored value follows the OS", async () => {
    stubMatchMedia(true);
    await runInit();
    expect(html().getAttribute("data-theme")).toBe("graphite");
  });

  test("ignores object-prototype keys like constructor", async () => {
    stubMatchMedia(false);
    localStorage.setItem(KEY, "constructor");
    await runInit();
    expect(html().getAttribute("data-theme")).toBe("paper");
    expect(html().getAttribute("data-scheme")).toBe("light");
  });
});

/**
 * Reads CSS custom properties from `:root` and converts them to Babylon.js
 * Color3/Color4 values.
 * @remarks Lets the SCSS token system drive 3D scene colors, so one token
 *   change themes the entire studio.
 */

import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";

/**
 * Reads a CSS custom property from :root, trimmed of whitespace.
 * @returns empty string when the variable is undefined.
 */
export function getCssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Parses a 6-digit hex string ("#RRGGBB" or "RRGGBB") to normalized
 * [r, g, b] floats.
 * @returns null when invalid.
 */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/**
 * Parses a 6-digit hex string to a BABYLON.Color3.
 * @returns null when the hex is invalid.
 */
export function hexToColor3(hex: string): BABYLON.Color3 | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return new BABYLON.Color3(rgb[0], rgb[1], rgb[2]);
}

/**
 * Parse a 6-digit hex string to a BABYLON.Color4 with the given alpha.
 */
export function hexToColor4(hex: string, alpha = 1): BABYLON.Color4 | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return new BABYLON.Color4(rgb[0], rgb[1], rgb[2], alpha);
}

export interface ViewportTheme {
  bg: string;
  grid: string;
  selection: string;
}

const VIEWPORT_FALLBACK: ViewportTheme = {
  bg: "#2a2b2f",
  grid: "#3c3e44",
  selection: "#f0a64b",
};

/**
 * The active theme's 3D viewport colours as "#rrggbb".
 * @param read token reader (injectable for tests); defaults to getCssVar.
 */
export function readViewportTheme(
  read: (name: string) => string = getCssVar,
): ViewportTheme {
  const pick = (name: string, fallback: string) => {
    const h = normalizeHex(read(name).trim());
    return h ? `#${h}` : fallback;
  };
  return {
    bg: pick("--viewport-bg", VIEWPORT_FALLBACK.bg),
    grid: pick("--viewport-grid", VIEWPORT_FALLBACK.grid),
    selection: pick("--selection", VIEWPORT_FALLBACK.selection),
  };
}

/**
 * Strips a leading "#" and requires 6 hex digits.
 * @returns null when invalid.
 */
function normalizeHex(hex: string): string | null {
  if (typeof hex !== "string") return null;
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return h.toLowerCase();
}

// ── Theme preference ─────────────────────────────────────────────────

const THEME_STORAGE_KEY = "arbesk-theme";

export type ThemeName = "graphite" | "paper";
export type ThemePref = "system" | ThemeName;

const THEME_SCHEME: Record<ThemeName, "dark" | "light"> = {
  graphite: "dark",
  paper: "light",
};

// Pre-Graphite builds stored "dark" / "light".
const LEGACY_THEME = new Map<string, ThemeName>([
  ["dark", "graphite"],
  ["light", "paper"],
]);

const DARK_QUERY = "(prefers-color-scheme: dark)";

let _pref: ThemePref = "system";

/**
 * Reads the stored preference, migrating legacy values in place.
 * @returns "system" when storage is empty, invalid, or unavailable.
 */
export function readStoredPref(): ThemePref {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return "system";
  }
  const migrated = LEGACY_THEME.get(raw ?? "");
  if (migrated) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, migrated);
    } catch {
      // storage blocked — the in-memory value still applies
    }
    return migrated;
  }
  if (raw === "graphite" || raw === "paper") return raw;
  return "system";
}

/** Resolves "system" against the OS colour scheme. */
export function resolveTheme(pref: ThemePref): ThemeName {
  if (pref !== "system") return pref;
  return window.matchMedia(DARK_QUERY).matches ? "graphite" : "paper";
}

/** The user's current preference (not the resolved theme). */
export function getThemePref(): ThemePref {
  return _pref;
}

function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-scheme", THEME_SCHEME[theme]);
  emit(EVENTS.THEME_CHANGED, { theme, pref: _pref });
}

/** Persist and apply a preference; "system" clears storage. */
export function setThemePref(pref: ThemePref) {
  _pref = pref;
  try {
    if (pref === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // storage blocked — preference lasts for this page only
  }
  applyTheme(resolveTheme(pref));
}

/** Initializes the theme on page load and follows OS changes while on "system". */
export function initTheme() {
  _pref = readStoredPref();
  applyTheme(resolveTheme(_pref));
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (_pref === "system") applyTheme(resolveTheme("system"));
  });
}

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

// ── Theme toggle ─────────────────────────────────────────────────────

const THEME_STORAGE_KEY = "arbesk-theme";

type ThemeName = "light" | "dark";

/**
 * Initializes the theme on page load.
 */
export function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
  } else {
    applySystemTheme();
  }

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        applySystemTheme();
      }
    });
}

function applySystemTheme() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(isDark ? "dark" : "light");
}

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute("data-theme", theme);
  emit(EVENTS.THEME_CHANGED, { theme });
}

/** Persist and apply a specific theme ("light" or "dark"). */
function setTheme(theme: ThemeName) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Toggle between light and dark. */
export function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
}

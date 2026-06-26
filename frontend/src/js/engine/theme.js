// @ts-nocheck
/**
 * Arbesk Theme Helpers
 *
 * Read CSS custom properties from `:root` and convert them to Babylon.js
 * Color3 / Color4 values. This lets the SCSS token system drive 3D scene
 * colors so a single token change themes the entire studio.
 */

import { emit, EVENTS } from "../events/bus.js";

/**
 * Read a CSS custom property from :root, trimmed of whitespace.
 * Returns the empty string if the variable is undefined.
 */
export function getCssVar(name) {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Parse a 6-digit hex string ("#RRGGBB" or "RRGGBB") to a BABYLON.Color3.
 * Returns the engine fallback if Babylon is unavailable.
 */
export function hexToColor3(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return new BABYLON.Color3(r, g, b);
}

/**
 * Parse a 6-digit hex string to a BABYLON.Color4 with the given alpha.
 */
export function hexToColor4(hex, alpha = 1) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return new BABYLON.Color4(r, g, b, alpha);
}

/**
 * Strip a leading "#" and ensure 6 hex digits. Returns null if invalid.
 */
function normalizeHex(hex) {
  if (typeof hex !== "string") return null;
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return h.toLowerCase();
}

// ── Theme toggle ─────────────────────────────────────────────────────

const THEME_STORAGE_KEY = "arbesk-theme";

/**
 * Initialize theme on page load. Reads saved preference from localStorage,
 * falls back to system preference, and sets data-theme on <html>.
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

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  emit(EVENTS.THEME_CHANGED, { theme });
}

/** Persist and apply a specific theme ("light" or "dark"). */
export function setTheme(theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Clear saved preference and revert to system preference. */
export function clearTheme() {
  localStorage.removeItem(THEME_STORAGE_KEY);
  applySystemTheme();
}

/** Toggle between light and dark. */
export function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") || "light";
  setTheme(current === "dark" ? "light" : "dark");
}

/** Return the currently applied theme. */
export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

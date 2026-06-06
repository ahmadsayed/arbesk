/**
 * Arbesk Theme Helpers
 *
 * Read CSS custom properties from `:root` and convert them to Babylon.js
 * Color3 / Color4 values. This lets the SCSS token system drive 3D scene
 * colors so a single token change themes the entire studio.
 */

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

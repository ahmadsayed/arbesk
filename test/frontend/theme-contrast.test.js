/**
 * Theme token contract + WCAG 2.2 AA contrast guard.
 *
 * Parses the literal `--token: #rrggbb;` lines of each theme file (no Sass
 * compile needed) and checks every required token exists and every
 * text/non-text pair meets its minimum ratio.
 */
import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCSS = path.resolve(__dirname, "../../frontend/src/scss");

const THEMES = ["graphite", "paper"];

const CONTRACT = [
  "window-bg", "window-fg", "view-bg", "view-fg", "headerbar-bg", "headerbar-fg",
  "sidebar-bg", "sidebar-fg", "card-bg", "card-fg", "popover-bg", "popover-fg",
  "raised-bg", "border-color", "hairline", "dim-fg",
  "accent-bg", "accent-fg", "accent-text",
  "destructive-bg", "destructive-fg", "danger-text", "success", "warning", "info",
  "viewport-bg", "viewport-grid", "selection",
];

const SURFACES = ["window-bg", "sidebar-bg", "raised-bg", "popover-bg"];
const TEXT_ON_SURFACE = ["window-fg", "dim-fg", "accent-text", "danger-text", "success", "info"];

/** @param {string} name */
export function parseTheme(name) {
  const src = fs.readFileSync(path.join(SCSS, "themes", `_${name}.scss`), "utf-8");
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const m of src.matchAll(/^\s*--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/gm)) {
    tokens[m[1]] = m[2].toLowerCase();
  }
  return tokens;
}

/** @param {string} hex */
function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** @param {string} a @param {string} b */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast()", () => {
  test("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

for (const name of THEMES) {
  describe(`theme: ${name}`, () => {
    const t = parseTheme(name);

    test("defines every contract token", () => {
      const missing = CONTRACT.filter((k) => !t[k]);
      expect(missing).toEqual([]);
    });

    for (const surface of SURFACES) {
      for (const fg of TEXT_ON_SURFACE) {
        test(`${fg} on ${surface} ≥ 4.5:1`, () => {
          expect(contrast(t[fg], t[surface])).toBeGreaterThanOrEqual(4.5);
        });
      }
      test(`border-color on ${surface} ≥ 3:1`, () => {
        expect(contrast(t["border-color"], t[surface])).toBeGreaterThanOrEqual(3);
      });
    }

    test("accent-fg on accent-bg ≥ 4.5:1", () => {
      expect(contrast(t["accent-fg"], t["accent-bg"])).toBeGreaterThanOrEqual(4.5);
    });
    test("destructive-fg on destructive-bg ≥ 4.5:1", () => {
      expect(contrast(t["destructive-fg"], t["destructive-bg"])).toBeGreaterThanOrEqual(4.5);
    });
    test("selection on viewport-bg ≥ 3:1", () => {
      expect(contrast(t.selection, t["viewport-bg"])).toBeGreaterThanOrEqual(3);
    });
    // The 3D stage must read as its own surface, not blend into the chrome.
    for (const surface of ["window-bg", "sidebar-bg"]) {
      test(`viewport-bg stands apart from ${surface} (≥ 1.15:1)`, () => {
        expect(contrast(t["viewport-bg"], t[surface])).toBeGreaterThanOrEqual(1.15);
      });
    }
    test("accent-text (focus ring) on window-bg ≥ 3:1", () => {
      expect(contrast(t["accent-text"], t["window-bg"])).toBeGreaterThanOrEqual(3);
    });
  });
}

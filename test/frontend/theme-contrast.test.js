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

/** color-mix(in srgb, a p%, b) for two #rrggbb values. */
function mix(a, b, p) {
  return "#" + [1, 3, 5]
    .map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

// Text pairs that components build with color-mix(): keep in step with the SCSS.
const DERIVED_TEXT_PAIRS = [
  // _library-grid .status-uploading/.status-pending
  ["window-fg on warning 22% tint", (t) => [t["window-fg"], mix(t.warning, t["card-bg"], 0.22)]],
  // owner badge, metadata chip, .status-besked (accent tint, #71)
  ["window-fg on accent 18% tint", (t) => [t["window-fg"], mix(t["accent-bg"], t["card-bg"], 0.18)]],
  // _testnet-banner
  ["window-fg on warning 18% banner", (t) => [t["window-fg"], mix(t.warning, t["window-bg"], 0.18)]],
  // _cards warning / error states
  ["warning on warning 8% card", (t) => [t.warning, mix(t.warning, t["card-bg"], 0.08)]],
  ["danger-text on danger 8% card", (t) => [t["danger-text"], mix(t["danger-text"], t["card-bg"], 0.08)]],
  // _chat success chip, _wallet-popover connected state
  ["window-bg on success", (t) => [t["window-bg"], t.success]],
  // _metadata-editor print badge (window-fg text on ok/warn tint, banner idiom)
  ["window-fg on success 18% sidebar tint", (t) => [t["window-fg"], mix(t.success, t["sidebar-bg"], 0.18)]],
  ["window-fg on warning 18% sidebar tint", (t) => [t["window-fg"], mix(t.warning, t["sidebar-bg"], 0.18)]],
  // _landing bands: --landing-on-dark text / hint line on --landing-dark
  ["landing band text", (t) => [band(t).onDark, band(t).bg]],
  ["landing band hint line", (t) => [mix(band(t).onDark, t["accent-text"], 0.45), band(t).bg]],
];

/** _landing.scss band colours: inverted on light themes, one step up on dark. */
function band(t) {
  const dark = luminance(t["window-bg"]) < 0.5;
  return dark
    ? { bg: t["view-bg"], onDark: t["window-fg"] }
    : { bg: t["window-fg"], onDark: t["window-bg"] };
}

for (const name of THEMES) {
  describe(`derived text pairs: ${name}`, () => {
    const t = parseTheme(name);
    for (const [label, pair] of DERIVED_TEXT_PAIRS) {
      test(`${label} ≥ 4.5:1`, () => {
        const [fg, bg] = pair(t);
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    // Band headings are large text (≥ 2.2rem bold): 3:1.
    test("landing band heading (accent-text) ≥ 3:1", () => {
      expect(contrast(t["accent-text"], band(t).bg)).toBeGreaterThanOrEqual(3);
    });
  });
}

describe("component colour leaks", () => {
  const dir = path.join(SCSS, "components");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".scss"));
  const RAW = /var\(--(choco|gold|red|green|yellow)-\d+|--accent-bg-rgb|--highlight-amber|--error-bg|--success-bg|--bs-warning/;
  const HEX = /#[0-9a-fA-F]{3,8}\b/;

  for (const f of files) {
    test(`${f} uses only theme tokens`, () => {
      const lines = fs.readFileSync(path.join(dir, f), "utf-8").split("\n");
      const bad = lines
        .map((l, i) => ({ l: l.replace(/\/\/.*$/, ""), n: i + 1 }))
        .filter(({ l }) => HEX.test(l) || RAW.test(l))
        .map(({ l, n }) => `${f}:${n}: ${l.trim()}`);
      expect(bad).toEqual([]);
    });
  }
});

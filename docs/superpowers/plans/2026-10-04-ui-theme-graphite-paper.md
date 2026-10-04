# Phase 1 — Theme System & Re-skin (Graphite / Paper) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brown/gold palette with Graphite (dark) and Paper (light) themes, a System/Graphite/Paper picker, self-hosted Inter + JetBrains Mono, flat modern styling and a neutral 3D viewport. WCAG 2.2 AA contrast is enforced by tests.

**Architecture:** Each theme is one SCSS file that defines the full token contract with literal hex values under `:root[data-theme="…"]`. Components keep using the existing alias names (`--window-bg`, `--accent-bg`, …). JS resolves System → a concrete theme and sets `data-theme` (graphite|paper) plus `data-scheme` (dark|light) on `<html>`. The Babylon viewport reads its colours from tokens on `THEME_CHANGED`.

**Tech Stack:** SCSS (dart-sass `renderSync`), Pug, TypeScript (esbuild bundle), Bun test with a jsdom preload (`// @test-env dom`), Babylon.js.

**Spec:** `docs/superpowers/specs/2026-10-04-ui-theme-graphite-paper-design.md`
**Roadmap:** `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md`

## Global Constraints

- Design authority, in order: **WCAG 2.2 AA** → web platform conventions (WAI-ARIA APG, browser defaults) → Arbesk design language. GNOME HIG is non-binding.
- Theme files contain **only literal `#rrggbb` values**, one `--token: #hex;` per line.
- Text pairs ≥ 4.5:1; control borders, focus indicator and selection ≥ 3:1.
- No `#rrggbb` literals and no raw-palette tokens (`--choco-*`, `--gold-*`, `--red-*`, `--green-*`, `--yellow-*`) in `frontend/src/scss/components/` once Task 4 lands.
- Mono font only for data (sizes, CIDs, versions, addresses), with tabular figures.
- Desktop/laptop only; don't add mobile work.
- Fonts are self-hosted under `/fonts`, SIL OFL 1.1, with no third-party font CDN.
- Run frontend tests with `bun run test:frontend` (or `bun scripts/run-tests.mjs <file>`). Rebuild the frontend with `cd frontend && bun run build`.

### Deviations from the spec (decided while planning)

1. **`data-scheme` attribute.** Components today use `[data-theme="dark"]` selectors (logo swap, theme icons, testnet banner). Rather than hard-coding theme names, `<html>` also gets `data-scheme="dark|light"`, and components key off that. Future community themes then work without touching components.
2. **No `themes/_index.scss`.** `_paper.scss` uses the selector `:root, :root[data-theme="paper"]`, so it's the fallback when no attribute is present. `:root[data-theme="graphite"]` has higher specificity and wins.
3. **Focus ring is a solid two-ring `box-shadow`,** not `outline`. The 64 existing `:focus-visible` rules already use `var(--focus-ring)`, so redefining the token to `0 0 0 2px var(--window-bg), 0 0 0 4px var(--accent-text)` gives a solid ≥3:1 indicator with a 2px gap without touching 64 rules. A `forced-colors` block adds a real `outline` because forced-colors mode strips box-shadows.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/scss/themes/_graphite.scss` (new) | Graphite token values |
| `frontend/src/scss/themes/_paper.scss` (new) | Paper token values, plus the `:root` fallback |
| `frontend/src/scss/base/_tokens.scss` (rewrite) | Scales, derived tokens, a11y media blocks; no colours |
| `frontend/src/scss/base/_fonts.scss` (new) | `@font-face` declarations |
| `frontend/src/scss/styles.scss` | `@use` order |
| `frontend/public/fonts/*` (new) | Vendored woff2 files and OFL licences |
| `frontend/src/js/engine/theme.ts` | Preference model, resolution, migration, viewport colours |
| `frontend/src/js/engine/theme-init.ts` | Pre-paint theme application (classic script) |
| `frontend/src/js/ui/menu-button.ts` (new) | Reusable WAI-ARIA menu-button behaviour (reused by Phase 2 New ▾) |
| `frontend/src/js/ui/theme-menu.ts` (new) | Theme picker wiring |
| `frontend/src/js/engine/scene-graph.ts`, `scene-selection.ts` | Viewport colours from tokens |
| `test/frontend/theme-contrast.test.js` (new) | Token contract, WCAG ratios, component colour-leak guard |
| `test/frontend/theme.test.js` (new) | Preference/resolution/migration |
| `test/frontend/menu-button.test.js` (new) | APG keyboard behaviour |
| `test/frontend/style-guards.test.js` (new) | No gradients, uppercase, or hand-written mono stacks in components |

---

### Task 1: Theme files, token rewrite, and contrast test

**Files:**
- Create: `frontend/src/scss/themes/_graphite.scss`
- Create: `frontend/src/scss/themes/_paper.scss`
- Create: `test/frontend/theme-contrast.test.js`
- Modify: `frontend/src/scss/base/_tokens.scss` (Layers 1–3, the `prefers-color-scheme` block, the manual override blocks, the hybrid-flourish block, the `prefers-contrast` block)
- Modify: `frontend/src/scss/styles.scss`

**Interfaces:**
- Produces: the token contract (names below), used by every later task and by Phase 2.
- Produces: transitional legacy selectors `:root[data-theme="dark"]` / `:root[data-theme="light"]`, removed in Task 2.
- Produces: the transitional legacy raw palette in `_tokens.scss` (`--choco-*`, `--gold-*`, `--red-*`, `--green-*`, `--yellow-*`, `--accent-bg-rgb`, `--highlight-amber`), removed in Task 4.

- [ ] **Step 1: Write the failing contrast test**

Create `test/frontend/theme-contrast.test.js`:

```js
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
    test("accent-text (focus ring) on window-bg ≥ 3:1", () => {
      expect(contrast(t["accent-text"], t["window-bg"])).toBeGreaterThanOrEqual(3);
    });
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/theme-contrast.test.js`
Expected: FAIL with `ENOENT … themes/_graphite.scss`.

- [ ] **Step 3: Create the Graphite theme**

Create `frontend/src/scss/themes/_graphite.scss`:

```scss
// ═══════════════════════════════════════════════════════════════════
// Graphite — dark theme
// Literal #rrggbb only: test/frontend/theme-contrast.test.js parses this file.
// Contrast ratios: docs/superpowers/specs/2026-10-04-ui-theme-graphite-paper-design.md §3.2
// ═══════════════════════════════════════════════════════════════════

// TRANSITIONAL: [data-theme="dark"] is removed in Task 2 once theme.ts writes "graphite".
:root[data-theme="graphite"],
:root[data-theme="dark"] {
  color-scheme: dark;

  --window-bg: #141416;
  --window-fg: #e6e6e3;
  --view-bg: #1b1c1f;
  --view-fg: #e6e6e3;
  --headerbar-bg: #1b1c1f;
  --headerbar-fg: #e6e6e3;
  --sidebar-bg: #1b1c1f;
  --sidebar-fg: #e6e6e3;
  --card-bg: #1b1c1f;
  --card-fg: #e6e6e3;
  --popover-bg: #26272b;
  --popover-fg: #e6e6e3;
  --raised-bg: #26272b;

  --border-color: #70737b;
  --hairline: #2c2e33;
  --dim-fg: #8f9197;

  --accent-bg: #f0a64b;
  --accent-fg: #1a1206;
  --accent-text: #f0a64b;

  --destructive-bg: #c9343a;
  --destructive-fg: #ffffff;
  --danger-text: #ff6b6b;
  --success: #7fd88f;
  --warning: #f0a64b;
  --info: #5ccfe6;

  --viewport-bg: #2a2b2f;
  --viewport-grid: #3c3e44;
  --selection: #f0a64b;
}
```

- [ ] **Step 4: Create the Paper theme**

Create `frontend/src/scss/themes/_paper.scss`:

```scss
// ═══════════════════════════════════════════════════════════════════
// Paper — light theme (also the fallback when <html> has no data-theme)
// Literal #rrggbb only: test/frontend/theme-contrast.test.js parses this file.
// Contrast ratios: docs/superpowers/specs/2026-10-04-ui-theme-graphite-paper-design.md §3.2
// ═══════════════════════════════════════════════════════════════════

// TRANSITIONAL: [data-theme="light"] is removed in Task 2 once theme.ts writes "paper".
:root,
:root[data-theme="paper"],
:root[data-theme="light"] {
  color-scheme: light;

  --window-bg: #f7f7f5;
  --window-fg: #1b1b1d;
  --view-bg: #ffffff;
  --view-fg: #1b1b1d;
  --headerbar-bg: #ffffff;
  --headerbar-fg: #1b1b1d;
  --sidebar-bg: #ffffff;
  --sidebar-fg: #1b1b1d;
  --card-bg: #ffffff;
  --card-fg: #1b1b1d;
  --popover-bg: #ffffff;
  --popover-fg: #1b1b1d;
  --raised-bg: #f0f0ed;

  --border-color: #85858b;
  --hairline: #e4e4e0;
  --dim-fg: #6b6b70;

  --accent-bg: #a35a12;
  --accent-fg: #ffffff;
  --accent-text: #a35a12;

  --destructive-bg: #c01c28;
  --destructive-fg: #ffffff;
  --danger-text: #c01c28;
  --success: #2a7036;
  --warning: #a35a12;
  --info: #0e7490;

  --viewport-bg: #c9cacc;
  --viewport-grid: #b3b4b7;
  --selection: #a35a12;
}
```

- [ ] **Step 5: Run the contrast test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/theme-contrast.test.js`
Expected: PASS, with every theme describe block green.

- [ ] **Step 6: Rewrite the colour parts of `_tokens.scss`**

In `frontend/src/scss/base/_tokens.scss`:

1. Replace the file header comment and the whole **"Layer 1: Raw palette"** block with the following. The legacy palette stays only until Task 4 removes its last users. `--clock-accent` and the axis colours stay permanently.

```scss
// ═══════════════════════════════════════════════════════════════════
// Arbesk Design Tokens — scales + derived tokens
//
// Colours live in themes/_graphite.scss and themes/_paper.scss (the token
// contract). This file holds theme-independent scales and tokens derived
// from the contract via color-mix().
// ═══════════════════════════════════════════════════════════════════

// ── Theme-independent colour tokens ─────────────────────────────────

:root {
  // Blender axis convention — not chrome, identical in every theme.
  --axis-x: #e22b30;
  --axis-y: #43c142;
  --axis-z: #3478eb;

  // Model-clock badge: matches COLOR_ACTIVE in model-clock-gizmo.ts.
  // 5.2:1 with white text (AA normal size).
  --clock-accent: #2563eb;
  --clock-accent-fg: #ffffff;
}

// ── LEGACY raw palette — REMOVED IN TASK 4 (only leaking components use it) ──

:root {
  --choco-1: #faf6f2;
  --choco-2: #f0e6d8;
  --choco-5: #b89a7a;
  --choco-7: #8c6a4a;
  --choco-11: #3d2a18;
  --choco-12: #2a1a0e;
  --gold-6: #8c673c;
  --gold-7: #a07848;
  --red-3: #e01b24;
  --green-4: #2ec27e;
  --yellow-4: #e5a50a;
  --accent-bg-rgb: 140 103 60;
  --highlight-amber: #d4a017;
}
```

2. Delete these blocks entirely:
   - **"Layer 2: Per-surface variants"**
   - **"Layer 3: Theme-agnostic aliases"** and the `@media (prefers-color-scheme: dark)` block after it
   - **"Manual override"** (`:root[data-theme="light"]` and `:root[data-theme="dark"]`) at the bottom of the file

3. Replace the **"Hybrid web2/web3 flourish"** block with:

```scss
// ── Derived tokens (resolve per element; track the active theme) ────

:root {
  // Floating surfaces (popovers, floating viewport toolbar)
  --glass-blur: 12px;
  --popover-glass-bg: color-mix(in srgb, var(--popover-bg) 92%, transparent);

  // Translucent hover/active overlays
  --surface-overlay-hover: color-mix(in srgb, var(--window-fg) 6%, transparent);
  --surface-overlay-active: color-mix(in srgb, var(--window-fg) 10%, transparent);

  // Decorative divider (alias kept for existing component usage)
  --border-hairline: var(--hairline);

  // Focus indicator: solid 2px ring with a 2px gap (WCAG 2.4.7 / 2.4.13 ≥3:1 via --accent-text)
  --focus-ring: 0 0 0 2px var(--window-bg), 0 0 0 4px var(--accent-text);
  --glow-accent: none;
  --accent-shadow: none;

  // TRANSITIONAL flat aliases — usages and these tokens are removed in Task 5.
  --gradient-accent: var(--accent-bg);
  --gradient-headerbar: var(--headerbar-bg);
  --gradient-sidebar: var(--sidebar-bg);
}
```

4. Replace the `@media (prefers-contrast: more)` block with:

```scss
@media (prefers-contrast: more) {
  :root {
    --border-color: currentColor;
    --hairline: currentColor;
    --shadow-1: none;
    --shadow-2: none;
    --shadow-3: none;
    --shadow-4: none;
    --shadow-5: none;
    --popover-glass-bg: var(--popover-bg);
    --focus-ring: 0 0 0 3px var(--window-fg);
  }
}

// Forced colours (Windows High Contrast): box-shadows are stripped, so focus
// must use outline, and selection must use system colours.
@media (forced-colors: active) {
  :focus-visible {
    outline: 2px solid CanvasText !important;
    outline-offset: 2px;
  }
}
```

- [ ] **Step 7: Wire the theme files into `styles.scss`**

In `frontend/src/scss/styles.scss`, replace the Foundation block:

```scss
// ── Foundation ──────────────────────────────────────────────────────
@use 'themes/paper';
@use 'themes/graphite';
@use 'base/tokens';
@use 'base/reset';
```

- [ ] **Step 8: Build and run the frontend tests**

Run: `cd frontend && bun run build && cd .. && bun run test:frontend`
Expected: build succeeds; all tests PASS (no test asserts colour values today).

- [ ] **Step 9: Smoke-check visually**

Run `cd frontend/dist && python3 -m http.server 8765`, open `http://localhost:8765/app.html`, and toggle the existing sun/moon button. Expected: the dark state shows Graphite greys and the light state shows Paper. Some components still show old brown/gold leak colours; Task 4 fixes those. Stop the server afterwards.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/scss/themes frontend/src/scss/base/_tokens.scss frontend/src/scss/styles.scss test/frontend/theme-contrast.test.js
git commit -m "feat(theme): Graphite/Paper token contract with WCAG contrast test"
```

---

### Task 2: Theme preference runtime (System / Graphite / Paper) and `data-scheme`

**Files:**
- Modify: `frontend/src/js/engine/theme.ts` (the "Theme toggle" section, lines ~66–115)
- Modify: `frontend/src/js/engine/theme-init.ts`
- Modify: `frontend/src/scss/components/_headerbar.scss:42` and `_sidebar.scss:213,217` (scheme selectors). `_testnet-banner.scss:25` also moves to `data-scheme` (it would otherwise go unreadable in Graphite); Task 4 deletes the rule.
- Modify: `frontend/src/scss/themes/_graphite.scss`, `_paper.scss` (remove the transitional legacy selectors)
- Test: `test/frontend/theme.test.js` (new)

**Interfaces:**
- Consumes: Task 1 theme selectors.
- Produces (in `engine/theme.ts`):
  - `type ThemeName = "graphite" | "paper"`
  - `type ThemePref = "system" | ThemeName`
  - `readStoredPref(): ThemePref`
  - `resolveTheme(pref: ThemePref): ThemeName`
  - `getThemePref(): ThemePref`
  - `setThemePref(pref: ThemePref): void`
  - `initTheme(): void`
  - The `toggleTheme` export is **removed** (Task 3 removes its only caller in the same PR. Until then, keep `toggleTheme` as a thin wrapper, see Step 3).
  - The `THEME_CHANGED` payload becomes `{ theme: ThemeName, pref: ThemePref }`.
  - `<html>` attributes: `data-theme="graphite|paper"` and `data-scheme="dark|light"`.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/theme.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/theme.test.js`
Expected: FAIL (`theme.readStoredPref is not a function`).

- [ ] **Step 3: Implement the preference model**

In `frontend/src/js/engine/theme.ts`, replace everything from `// ── Theme toggle ──` to the end of the file with:

```ts
// ── Theme preference ─────────────────────────────────────────────────

const THEME_STORAGE_KEY = "arbesk-theme";

export type ThemeName = "graphite" | "paper";
export type ThemePref = "system" | ThemeName;

const THEME_SCHEME: Record<ThemeName, "dark" | "light"> = {
  graphite: "dark",
  paper: "light",
};

// Pre-Graphite builds stored "dark" / "light".
const LEGACY_THEME: Record<string, ThemeName> = {
  dark: "graphite",
  light: "paper",
};

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
  if (raw && LEGACY_THEME[raw]) {
    const migrated = LEGACY_THEME[raw];
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

/**
 * TRANSITIONAL — removed in Task 3 with its only caller (#themeToggle).
 * Flips between the two concrete themes.
 */
export function toggleTheme() {
  setThemePref(resolveTheme(_pref) === "graphite" ? "paper" : "graphite");
}
```

- [ ] **Step 4: Update the pre-paint script**

Replace the body of `frontend/src/js/engine/theme-init.ts` with:

```ts
/**
 * Initializes the page theme.
 * @remarks Runs before page render to prevent a flash of the wrong theme.
 *   Mirrors readStoredPref/resolveTheme in theme.ts (this is a classic
 *   script, so it cannot import them).
 */
(function () {
  let s: string | null = null;
  try {
    s = localStorage.getItem("arbesk-theme");
  } catch {
    // storage blocked — fall through to system
  }
  if (s === "dark") s = "graphite";
  else if (s === "light") s = "paper";
  const t =
    s === "graphite" || s === "paper"
      ? s
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "graphite"
        : "paper";
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.setAttribute(
    "data-scheme",
    t === "graphite" ? "dark" : "light",
  );
})();
```

- [ ] **Step 5: Switch component selectors to `data-scheme`**

- `frontend/src/scss/components/_headerbar.scss:42`: `[data-theme="dark"] .headerbar-brand {` → `[data-scheme="dark"] .headerbar-brand {`
- `frontend/src/scss/components/_sidebar.scss:213`: `[data-theme="light"] .theme-icon-dark {` → `[data-scheme="light"] .theme-icon-dark {`
- `frontend/src/scss/components/_sidebar.scss:217`: `[data-theme="dark"] .theme-icon-light {` → `[data-scheme="dark"] .theme-icon-light {`

Then remove the transitional selectors: delete the line `:root[data-theme="dark"] {` from `_graphite.scss` (and the trailing comma on the line above it), and delete `:root[data-theme="light"] {` from `_paper.scss` the same way. Also delete both `// TRANSITIONAL:` comments.

- [ ] **Step 6: Verify no `data-theme="dark|light"` selectors remain, except the testnet banner (Task 4)**

Run: `grep -rn 'data-theme="\(dark\|light\)"' frontend/src/scss`
Expected: no matches (the testnet banner moved to `data-scheme` too).

- [ ] **Step 7: Run tests**

Run: `bun scripts/run-tests.mjs test/frontend/theme.test.js test/frontend/theme-contrast.test.js test/frontend/library-init.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/js/engine/theme.ts frontend/src/js/engine/theme-init.ts frontend/src/scss test/frontend/theme.test.js
git commit -m "feat(theme): system/graphite/paper preference with legacy migration and data-scheme"
```

---

### Task 3: Menu-button helper and theme picker

**Files:**
- Create: `frontend/src/js/ui/menu-button.ts`
- Create: `frontend/src/js/ui/theme-menu.ts`
- Create: `frontend/src/scss/components/_menu.scss`
- Modify: `frontend/src/pug/includes/header.pug` (the `button#themeToggle…` block)
- Modify: `frontend/src/js/app-init.ts:17,88-89`
- Modify: `frontend/src/js/engine/theme.ts` (delete `toggleTheme`)
- Modify: `frontend/src/scss/styles.scss` (add `@use 'components/menu';`)
- Modify: `test/frontend/library-build.test.js:43`
- Test: `test/frontend/menu-button.test.js` (new)

**Interfaces:**
- Consumes: `getThemePref`, `setThemePref`, `ThemePref` from Task 2.
- Produces (`ui/menu-button.ts`), **reused by Phase 2's New ▾ menu**:
  ```ts
  export interface MenuButtonOptions { onSelect: (item: HTMLElement) => void; onOpen?: () => void; align?: "start" | "end" }
  export interface MenuButtonHandle { open(focus?: "first" | "last"): void; close(): void; destroy(): void }
  export function initMenuButton(button: HTMLElement, menu: HTMLElement, opts: MenuButtonOptions): MenuButtonHandle
  ```
  `onOpen` runs just before the menu is shown, so callers can toggle item `hidden` state (Phase 2 hides the CAD item this way).
  As built: the menu is `position: fixed` and placed under the button in JS (`align`, default `"end"`), because the headerbar is `overflow: hidden`; item focus uses `preventScroll`; keys in the menu stop propagating so viewport shortcuts (Home, Escape, G…) don't fire; window resize closes it.
  Items are `menu` descendants matching `[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]` that are not `[aria-disabled="true"]` and not `[hidden]`.
- Produces: `initThemeMenu(): void` in `ui/theme-menu.ts`.
- Produces: the CSS class `.menu-popover` with `.menu-item` rows (styled in `_menu.scss`), reused by Phase 2.

- [ ] **Step 1: Write the failing test**

Create `test/frontend/menu-button.test.js`:

```js
// @test-env dom
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const FRAGMENT = `
  <button id="btn" aria-haspopup="menu" aria-expanded="false" aria-controls="m">Menu</button>
  <ul id="m" role="menu" hidden>
    <li role="menuitemradio" tabindex="-1" data-v="a">A</li>
    <li role="menuitemradio" tabindex="-1" data-v="b" aria-disabled="true">B</li>
    <li role="menuitemradio" tabindex="-1" data-v="c">C</li>
    <li role="menuitemradio" tabindex="-1" data-v="d" hidden>D</li>
  </ul>
  <button id="outside">x</button>`;

/** @type {typeof import("../../frontend/src/js/ui/menu-button.js")} */
let mod;
let onSelect;
const btn = () => document.getElementById("btn");
const menu = () => document.getElementById("m");
const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

beforeEach(async () => {
  resetModules();
  document.body.innerHTML = FRAGMENT;
  mod = await import("../../frontend/src/js/ui/menu-button.js");
  onSelect = jest.fn();
  mod.initMenuButton(btn(), menu(), { onSelect });
});

describe("menu button (WAI-ARIA APG)", () => {
  test("click opens, sets aria-expanded, focuses first enabled item", () => {
    btn().click();
    expect(menu().hidden).toBe(false);
    expect(btn().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.dataset.v).toBe("a");
  });

  test("ArrowUp on button opens on the last enabled item", () => {
    key(btn(), "ArrowUp");
    expect(document.activeElement?.dataset.v).toBe("c");
  });

  test("ArrowDown skips disabled and hidden items and wraps", () => {
    btn().click();
    key(document.activeElement, "ArrowDown");
    expect(document.activeElement?.dataset.v).toBe("c");
    key(document.activeElement, "ArrowDown");
    expect(document.activeElement?.dataset.v).toBe("a");
  });

  test("Home/End jump to first/last", () => {
    btn().click();
    key(document.activeElement, "End");
    expect(document.activeElement?.dataset.v).toBe("c");
    key(document.activeElement, "Home");
    expect(document.activeElement?.dataset.v).toBe("a");
  });

  test("Enter selects, closes, and returns focus to the button", () => {
    btn().click();
    key(document.activeElement, "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].dataset.v).toBe("a");
    expect(menu().hidden).toBe(true);
    expect(btn().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(btn());
  });

  test("Escape closes without selecting and returns focus", () => {
    btn().click();
    key(document.activeElement, "Escape");
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(btn());
  });

  test("clicking outside closes", () => {
    btn().click();
    document.getElementById("outside").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(menu().hidden).toBe(true);
  });

  test("onOpen runs before items are focused", async () => {
    resetModules();
    document.body.innerHTML = FRAGMENT;
    const m = await import("../../frontend/src/js/ui/menu-button.js");
    m.initMenuButton(btn(), menu(), {
      onSelect: jest.fn(),
      onOpen: () => { menu().querySelector('[data-v="a"]').hidden = true; },
    });
    btn().click();
    expect(document.activeElement?.dataset.v).toBe("c");
  });

  test("clicking a disabled item does nothing", () => {
    btn().click();
    menu().querySelector('[data-v="b"]').click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu().hidden).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/menu-button.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ui/menu-button.ts`**

```ts
/**
 * WAI-ARIA APG menu button: a button that opens a role="menu" popup.
 * @remarks Shared by the theme picker (Phase 1) and the New ▾ menu (Phase 2).
 *   Keyboard: Enter/Space (native click)/ArrowDown open on the first item, ArrowUp on the
 *   last; in the menu ArrowUp/Down cycle, Home/End jump, Enter/Space select,
 *   Escape/Tab close. Focus returns to the button on close-by-key or select.
 */

const ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

export interface MenuButtonOptions {
  onSelect: (item: HTMLElement) => void;
  /** Runs before the menu is shown (refresh item visibility here). */
  onOpen?: () => void;
}

export interface MenuButtonHandle {
  open(focus?: "first" | "last"): void;
  close(): void;
  destroy(): void;
}

export function initMenuButton(
  button: HTMLElement,
  menu: HTMLElement,
  opts: MenuButtonOptions,
): MenuButtonHandle {
  const items = (): HTMLElement[] =>
    Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
      (el) => !el.hidden && el.getAttribute("aria-disabled") !== "true",
    );

  const isOpen = () => !menu.hidden;

  function focusAt(index: number) {
    const list = items();
    if (!list.length) return;
    const i = ((index % list.length) + list.length) % list.length;
    list[i].focus();
  }

  function open(focus: "first" | "last" = "first") {
    opts.onOpen?.();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    focusAt(focus === "first" ? 0 : -1);
  }

  function close(returnFocus = false) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
  }

  function select(item: HTMLElement) {
    if (item.getAttribute("aria-disabled") === "true" || item.hidden) return;
    close(true);
    opts.onSelect(item);
  }

  const onButtonClick = () => (isOpen() ? close() : open("first"));

  // Enter/Space on a native <button> already fire "click" (handled above);
  // handling them here too would open-then-toggle-closed.
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      open("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      open("last");
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(-1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (current >= 0) select(list[current]);
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close();
        break;
    }
  };

  const onMenuClick = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
    if (item && menu.contains(item)) select(item);
  };

  const onDocPointer = (e: Event) => {
    const t = e.target as Node;
    if (isOpen() && !menu.contains(t) && !button.contains(t)) close();
  };

  button.addEventListener("click", onButtonClick);
  button.addEventListener("keydown", onButtonKey);
  menu.addEventListener("keydown", onMenuKey);
  menu.addEventListener("click", onMenuClick);
  document.addEventListener("pointerdown", onDocPointer);

  return {
    open,
    close: () => close(),
    destroy() {
      button.removeEventListener("click", onButtonClick);
      button.removeEventListener("keydown", onButtonKey);
      menu.removeEventListener("keydown", onMenuKey);
      menu.removeEventListener("click", onMenuClick);
      document.removeEventListener("pointerdown", onDocPointer);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/menu-button.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Implement `ui/theme-menu.ts`**

```ts
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
```

- [ ] **Step 6: Replace the header toggle markup**

In `frontend/src/pug/includes/header.pug`, replace the whole `button#themeToggle…` block (the button and its two `svg` children) with:

```pug
  .menu-anchor
    button#themeMenuBtn.btn.btn-icon.btn-flat(type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="themeMenu" aria-label="Theme" title="Theme")
      svg.theme-icon-light(width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
        use(href="/icons.svg#sun")
      svg.theme-icon-dark(width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
        use(href="/icons.svg#moon")
    ul#themeMenu.menu-popover(role="menu" aria-label="Theme" hidden)
      li.menu-item(role="menuitemradio" tabindex="-1" aria-checked="false" data-theme-pref="system")
        span.theme-swatch.theme-swatch--system(aria-hidden="true")
        span System
      li.menu-item(role="menuitemradio" tabindex="-1" aria-checked="false" data-theme-pref="graphite")
        span.theme-swatch.theme-swatch--graphite(aria-hidden="true")
        span Graphite
      li.menu-item(role="menuitemradio" tabindex="-1" aria-checked="false" data-theme-pref="paper")
        span.theme-swatch.theme-swatch--paper(aria-hidden="true")
        span Paper
```

The theme icons now show the **current** scheme (moon = dark), not the opposite. In `frontend/src/scss/components/_sidebar.scss`, swap the two rules from Task 2 Step 5 so that `[data-scheme="dark"] .theme-icon-dark` and `[data-scheme="light"] .theme-icon-light` are the ones set to `display: block`.

- [ ] **Step 7: Style the menu popover**

Create `frontend/src/scss/components/_menu.scss`:

```scss
// ═══════════════════════════════════════════════════════════════════
// Menu popover — shared by the theme picker and (Phase 2) New ▾ menu.
// ═══════════════════════════════════════════════════════════════════

.menu-anchor {
  position: relative;
  display: inline-flex;
}

.menu-popover {
  position: absolute;
  top: calc(100% + var(--size-1));
  right: 0;
  z-index: 1000;
  min-width: 11rem;
  margin: 0;
  padding: var(--size-1);
  list-style: none;
  color: var(--popover-fg);
  background: var(--popover-bg);
  border: var(--border-size-1) solid var(--hairline);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-4);

  &[hidden] {
    display: none;
  }
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--size-2);
  min-height: 28px;
  padding: 0 var(--size-2);
  border-radius: var(--radius-1);
  font-size: var(--font-size-1);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--surface-overlay-hover);
    outline: none;
  }

  &:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-text);
  }

  &[aria-checked="true"]::after {
    content: "✓";
    margin-left: auto;
    color: var(--accent-text);
  }

  &[aria-disabled="true"] {
    color: var(--dim-fg);
    cursor: default;
  }

  kbd {
    margin-left: auto;
    font: var(--font-size-0) var(--font-mono);
    color: var(--dim-fg);
  }
}

.menu-separator {
  height: 1px;
  margin: var(--size-1) 0;
  background: var(--hairline);
}

// Two-half swatches: hard-coded previews of the *other* theme are the one
// sanctioned place for literals outside theme files — kept here (not in
// components/) via custom properties so the leak guard stays meaningful.
.theme-swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: var(--border-size-1) solid var(--border-color);
  background: linear-gradient(135deg, var(--swatch-a) 50%, var(--swatch-b) 50%);
}

.theme-swatch--graphite { --swatch-a: var(--theme-preview-graphite-bg); --swatch-b: var(--theme-preview-graphite-accent); }
.theme-swatch--paper { --swatch-a: var(--theme-preview-paper-bg); --swatch-b: var(--theme-preview-paper-accent); }
.theme-swatch--system { --swatch-a: var(--theme-preview-paper-bg); --swatch-b: var(--theme-preview-graphite-bg); }
```

Add the preview tokens to the theme-independent block in `frontend/src/scss/base/_tokens.scss`:

```scss
  // Theme-picker swatches (previews of each theme regardless of the active one)
  --theme-preview-graphite-bg: #141416;
  --theme-preview-graphite-accent: #f0a64b;
  --theme-preview-paper-bg: #f7f7f5;
  --theme-preview-paper-accent: #a35a12;
```

Add `@use 'components/menu';` after `@use 'components/dialog';` in `frontend/src/scss/styles.scss`.

- [ ] **Step 8: Wire it in app-init and remove `toggleTheme`**

In `frontend/src/js/app-init.ts`:
- line 17: `import { initTheme, toggleTheme } from "./engine/theme.ts";` → `import { initTheme } from "./engine/theme.ts";`
- add `import { initThemeMenu } from "./ui/theme-menu.ts";` next to the other `./ui/` imports
- lines 88–89 become:

```ts
// ─── Theme ───
initTheme();
initThemeMenu();
```

In `frontend/src/js/engine/theme.ts`, delete the `toggleTheme` function and its TRANSITIONAL doc comment.

- [ ] **Step 9: Update the build test**

`test/frontend/library-build.test.js:43`: `expect(html).toMatch(/id="themeToggle"/);` → `expect(html).toMatch(/id="themeMenuBtn"/);`, and add on the next line `expect(html).toMatch(/id="themeMenu"/);`.

- [ ] **Step 10: Run tests, build, typecheck**

Run: `cd frontend && bun run build && cd .. && bun run typecheck:frontend && bun scripts/run-tests.mjs test/frontend/menu-button.test.js test/frontend/theme.test.js test/frontend/library-build.test.js test/frontend/library-init.test.js`
Expected: PASS; no type errors; `grep -rn toggleTheme frontend/src` prints nothing.

- [ ] **Step 11: Commit**

```bash
git add frontend/src test/frontend/menu-button.test.js test/frontend/library-build.test.js
git commit -m "feat(theme): System/Graphite/Paper picker on a reusable APG menu button"
```

---

### Task 4: Fix colour leaks and add the component leak guard

**Files:**
- Modify: `frontend/src/scss/components/_dialog.scss:78`, `_library-context-menu.scss:42`, `_cards.scss:158-167,205-206`, `_chat.scss:238-239,359,366`, `_wallet-popover.scss:73-75`, `_landing.scss:8-15,230,894`, `_toasts.scss:81,83`, `_library-grid.scss:163,178`, `_buttons.scss:91`, `_testnet-banner.scss:11-13,25-27`, `_sidebar.scss:125,128`, `_version-clock.scss:59,87,181,201`, `_viewport.scss:90,94`
- Modify: `frontend/src/scss/base/_tokens.scss` (delete the LEGACY raw palette block)
- Modify: `frontend/src/js/engine/scene-selection.ts:13-18` (stop reading `--highlight-amber`)
- Test: `test/frontend/theme-contrast.test.js` (add the leak guard)

**Interfaces:**
- Consumes: the Task 1 token contract.
- Produces: an invariant enforced by the test: no hex literal and no raw palette token in `scss/components/`.

- [ ] **Step 1: Write the failing leak guard**

Append to `test/frontend/theme-contrast.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/theme-contrast.test.js`
Expected: FAIL. The listed offenders are `_dialog`, `_library-context-menu`, `_cards`, `_chat`, `_wallet-popover`, `_landing`, `_toasts`, `_library-grid`, `_buttons`, `_testnet-banner`, `_sidebar`, `_version-clock` and `_viewport`.

- [ ] **Step 3: Apply the replacements**

Make exactly these edits. Each line on the left is the current text; the right is the replacement.

| File:line | Before | After |
|---|---|---|
| `_dialog.scss:78` | `color: var(--error-bg, #c01c28);` | `color: var(--danger-text);` |
| `_library-context-menu.scss:42` | `color: var(--error-bg, #c01c28);` | `color: var(--danger-text);` |
| `_cards.scss:158` | `border-color: var(--error-bg, #c01c28);` | `border-color: var(--danger-text);` |
| `_cards.scss:159` | `background-color: color-mix(in srgb, var(--error-bg, #c01c28) 8%, var(--card-bg));` | `background-color: color-mix(in srgb, var(--danger-text) 8%, var(--card-bg));` |
| `_cards.scss:162` | `border-color: var(--error-bg, #c01c28);` | `border-color: var(--danger-text);` |
| `_cards.scss:167` | `color: var(--error-bg, #c01c28);` | `color: var(--danger-text);` |
| `_cards.scss:205` | `background: color-mix(in srgb, var(--bs-warning, #ffc107) 8%, var(--card-bg));` | `background: color-mix(in srgb, var(--warning) 8%, var(--card-bg));` |
| `_cards.scss:206` | `color: var(--bs-warning, #ffc107);` | `color: var(--warning);` |
| `_chat.scss:238` | `background: var(--success-bg, #2e7d32);` | `background: var(--success);` |
| `_chat.scss:239` | `color: #fff;` | `color: var(--window-bg);` |
| `_chat.scss:359` | `color: var(--yellow-4);` | `color: var(--warning);` |
| `_chat.scss:366` | `color: var(--yellow-4);` | `color: var(--warning);` |
| `_wallet-popover.scss:73` | `background-color: var(--green-4);` | `background-color: var(--success);` |
| `_wallet-popover.scss:74` | `border-color: var(--green-4);` | `border-color: var(--success);` |
| `_wallet-popover.scss:75` | `color: #ffffff;` | `color: var(--window-bg);` |
| `_toasts.scss:81` | `border-left-color: var(--green-4);` | `border-left-color: var(--success);` |
| `_toasts.scss:83` | `border-left-color: var(--yellow-4);` | `border-left-color: var(--warning);` |
| `_library-grid.scss:163` | `background-color: var(--yellow-4);` | `background-color: var(--warning);` |
| `_library-grid.scss:178` | `background-color: var(--yellow-4);` | `background-color: var(--warning);` |
| `_buttons.scss:91` | `border-color: var(--gold-7);` | `border-color: var(--accent-text);` |
| `_sidebar.scss:125` | `box-shadow: 0 0 0 0 rgba(var(--accent-bg-rgb, 52 152 219) / 0.4);` | `box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-bg) 40%, transparent);` |
| `_sidebar.scss:128` | `box-shadow: 0 0 0 6px rgba(var(--accent-bg-rgb, 52 152 219) / 0);` | `box-shadow: 0 0 0 6px transparent;` |
| `_version-clock.scss:59` | `stroke: var(--green-4);` | `stroke: var(--success);` |
| `_version-clock.scss:87` | `fill: var(--green-4);` | `fill: var(--success);` |
| `_version-clock.scss:181` | `color: var(--green-4);` | `color: var(--success);` |
| `_version-clock.scss:201` | `background: var(--yellow-4);` | `background: var(--warning);` |
| `_viewport.scss:90` | `color: var(--red-3);` | `color: var(--danger-text);` |
| `_viewport.scss:94` | `background-color: var(--red-3);` | `background-color: var(--destructive-bg);` |

**Testnet banner** (`_testnet-banner.scss`): lines 11–13 become

```scss
  color: var(--window-fg);
  background: color-mix(in srgb, var(--warning) 18%, var(--window-bg));
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
```

and delete the whole `[data-scheme="dark"] .testnet-banner { … }` rule (lines 25–27). The mix is theme-aware now: `--window-fg` on an 18% warning tint stays ≥ 4.5:1 in both themes.

**Landing** (`_landing.scss`): lines 8–15 become

```scss
  --landing-bg: var(--window-bg);
  --landing-fg: var(--window-fg);
  --landing-muted: var(--dim-fg);
  --landing-gold: var(--accent-text);
  --landing-gold-strong: var(--accent-bg); /* ≥4.5:1 with --accent-fg */
  --landing-card: var(--raised-bg);
  --landing-border: var(--border-color);
  --landing-dark: var(--window-fg);
```

and lines 230 and 894, `color: #fff;` → `color: var(--accent-fg);`. Confirm each sits on a `--landing-gold-strong` / accent background by reading 5 lines of context. If one sits on `--landing-dark` instead, use `color: var(--window-bg);`.

**Landing hero headline:** find the hero `h1` rule (`grep -n "hero" frontend/src/scss/components/_landing.scss | head`). Its final (post-animation) `color` must be `var(--landing-fg)` at full opacity. If it uses a low-alpha `color-mix` or `opacity` < 1 for the resting state, change the resting state to `var(--landing-fg)` and keep the low-alpha value for the animation's `from` keyframe only.

- [ ] **Step 4: Point selection at the new token**

> **Done in Task 7 (#73):** #73's acceptance needs the outline ≥3:1 in both themes, and the old `#d4a017` was ~1.4:1 on Paper's viewport. `scene-selection.ts` now uses `readViewportTheme().selection` and re-colours live on `THEME_CHANGED`. Skip this step; only confirm `--highlight-amber` has no users before Step 5.

In `frontend/src/js/engine/scene-selection.ts`, replace `_amberColor`:

```ts
function _amberColor() {
  return (
    hexToColor3(getCssVar("--selection")) ||
    BABYLON.Color3.FromHexString("#f0a64b")
  );
}
```

- [ ] **Step 5: Delete the legacy raw palette**

In `frontend/src/scss/base/_tokens.scss`, delete the whole `// ── LEGACY raw palette — REMOVED IN TASK 4 …` block.

Run: `grep -rnE "var\(--(choco|gold|red|green|yellow)-[0-9]|accent-bg-rgb|highlight-amber" frontend/src`
Expected: no output.

- [ ] **Step 6: Run tests and build**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/theme-contrast.test.js && bun run test:frontend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src test/frontend/theme-contrast.test.js
git commit -m "refactor(theme): map component colour leaks to theme tokens; guard against new ones"
```

---

### Task 5: Remove gradients, uppercase, heavy borders and accent overuse

**Files:**
- Modify: `frontend/src/scss/components/_buttons.scss:39-58`, `_headerbar.scss:14,170-190`, `_inspector.scss:10,84`, `_bottombar.scss:11`, `_sidebar.scss:14,41,100`
- Modify (uppercase): `frontend/src/js/ui/keyboard-help.ts` (inline style in `buildHtml`), `_library-grid.scss:158`, `_cards.scss:22,123`, `_comments.scss:23`, `_wallet-modal.scss:134`, `_library-details.scss:81`, `_chat.scss:209,386,401`, `_inspector.scss:84`, `_settings.scss:36,88`, `_landing.scss:208,363,458`
- Modify: `frontend/src/scss/base/_tokens.scss` (delete the three `--gradient-*` aliases)
- Test: `test/frontend/style-guards.test.js` (new)

**Interfaces:**
- Consumes: tokens from Tasks 1 and 4.
- Produces: invariants enforced by the test: no `--gradient-` token, no `text-transform: uppercase`, and no hand-written monospace stacks (the last is used by Task 6) in `scss/components/`.

- [ ] **Step 1: Write the failing guard**

Create `test/frontend/style-guards.test.js`:

```js
/**
 * Style guards for the Arbesk design language (roadmap 2026-10-04):
 * flat surfaces, sentence-case headings, one mono stack via --font-mono.
 */
import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, "../../frontend/src/scss/components");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".scss"));

/** @param {RegExp} re */
function offenders(re) {
  return files.flatMap((f) =>
    fs.readFileSync(path.join(DIR, f), "utf-8").split("\n")
      .map((l, i) => ({ l: l.replace(/\/\/.*$/, ""), n: i + 1 }))
      .filter(({ l }) => re.test(l))
      .map(({ l, n }) => `${f}:${n}: ${l.trim()}`),
  );
}

describe("style guards", () => {
  test("no gradient chrome tokens", () => {
    expect(offenders(/var\(--gradient-/)).toEqual([]);
  });
  test("no uppercase headings", () => {
    expect(offenders(/text-transform:\s*uppercase/)).toEqual([]);
  });
  test("no hand-written monospace stacks (use var(--font-mono))", () => {
    expect(offenders(/font-family:[^;]*(SFMono|ui-monospace|Menlo|Consolas)/)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/style-guards.test.js`
Expected: FAIL. It lists 8 gradient lines, 15 uppercase lines and 2 mono lines.

- [ ] **Step 3: Flatten the gradients**

| File:line | Before | After |
|---|---|---|
| `_buttons.scss:40` | `background: var(--gradient-accent);` | `background: var(--accent-bg);` |
| `_headerbar.scss:14` | `background: var(--gradient-headerbar);` | `background: var(--headerbar-bg);` |
| `_headerbar.scss:182` | `background: var(--gradient-accent);` | `background: var(--raised-bg);` |
| `_inspector.scss:10` | `background: var(--gradient-sidebar);` | `background: var(--sidebar-bg);` |
| `_bottombar.scss:11` | `background: var(--gradient-headerbar);` | `background: var(--headerbar-bg);` |
| `_sidebar.scss:14` | `background: var(--gradient-sidebar);` | `background: var(--sidebar-bg);` |
| `_sidebar.scss:41` | `background: var(--gradient-headerbar);` | `background: var(--sidebar-bg);` |
| `_sidebar.scss:100` | `background: var(--gradient-accent);` | `background: var(--raised-bg);` (and set the icon `color: var(--accent-text)` in the same rule) |

Then, in `.btn-primary` (`_buttons.scss:39-58`), drop the lift effect:

```scss
.btn-primary {
  background: var(--accent-bg);
  color: var(--accent-fg);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-bg) 88%, var(--window-fg));
  }

  &:active:not(:disabled) {
    background: color-mix(in srgb, var(--accent-bg) 80%, var(--window-fg));
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
```

**Header wallet / testnet pill** (`_headerbar.scss:170-190`, `.headerbar-wallet`): it's no longer a filled accent. Replace its `font-family`, `color`, `background`, `border` and `box-shadow` lines with:

```scss
  font-family: var(--font-family);
  color: var(--headerbar-fg);
  background: var(--raised-bg);
  border: var(--border-size-1) solid var(--hairline);
  box-shadow: none;
```

Find any other `background: var(--accent-bg)` on a **non-primary** control (active tab, toggle, segmented control) and change it to `var(--raised-bg)` with `color: var(--accent-text)` for the icon or indicator:

`grep -rn "background[^;]*var(--accent-bg)" frontend/src/scss/components`

Keep it only on `.btn-primary`, `.messagebar-submit` (Generate), `.empty-state-action` and primary CTAs. Note each changed line in the commit message body.

Delete the three `--gradient-*` aliases from `_tokens.scss`.

- [ ] **Step 4: Sentence-case headings**

At each uppercase line listed under **Files**, delete the `text-transform: uppercase;` line and the adjacent `letter-spacing:` line in the same rule, if present. For section titles (`_inspector.scss:84` `.inspector-section-title`, `_chat.scss:401`, `_settings.scss:36,88`, `_cards.scss:22,123`, `_comments.scss:23`, `_library-details.scss:81`), make sure the rule ends up with:

```scss
  font-size: var(--font-size-1);
  font-weight: var(--font-weight-6);
  color: var(--dim-fg);
```

Fix the comment at `_chat.scss:386` to read `(dim sentence-case title, ▸ chevron)`. The guard ignores comments, but the comment would otherwise be wrong.

Also fix the one inline-style uppercase heading in TypeScript. In `frontend/src/js/ui/keyboard-help.ts` `buildHtml()`, remove `text-transform:uppercase;letter-spacing:0.05em` from the section `<p style=…>` and change its `font-size:var(--font-size-0)` to `font-size:var(--font-size-1)`. Then confirm `grep -rn "uppercase" frontend/src/js` prints nothing.

- [ ] **Step 5: Hairline borders for structure and flat inspector sections**

Panel dividers use `--hairline`, and only controls keep `--border-color`. Run:

`grep -rn "border[^;]*var(--border-color)" frontend/src/scss/components`

For every match on a **non-control** element (panels, section boxes, rows, cards, headerbar/bottombar edges, sidebar separators), replace `var(--border-color)` with `var(--hairline)`. Controls keep `--border-color`: `.form-input`, `.form-select`, `.btn-secondary`, `.btn-outline`, `textarea`, `.messagebar-input`, and checkbox/radio.

Flatten the inspector sections in `_inspector.scss`: the `.inspector-section` / `details` rule loses its `border` and `border-radius`, gets `border-bottom: var(--border-size-1) solid var(--hairline);`, and its summary row gets `min-height: 32px`.

- [ ] **Step 6: Make the viewport overlay toolbar readable**

In `_viewport.scss`, the floating transform/undo toolbar uses `background: var(--sidebar-bg)`, `border: var(--border-size-1) solid var(--hairline)` and `box-shadow: var(--shadow-3)`. Its disabled buttons use `color: var(--dim-fg); opacity: 1;` instead of a low opacity. Locate them with:

`grep -n "transform-toolbar\|undo\|:disabled" frontend/src/scss/components/_viewport.scss`

- [ ] **Step 7: Run guards (the mono guard still fails until Task 6), tests and build**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/style-guards.test.js`
Expected: "no gradient" and "no uppercase" PASS; "no hand-written monospace" FAIL (fixed in Task 6).

Run: `bun run test:frontend`
Expected: everything else PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src test/frontend/style-guards.test.js
git commit -m "style: flat surfaces, sentence-case headings, hairline structure, accent only on primary actions"
```

---

### Task 6: Self-hosted Inter + JetBrains Mono

**Files:**
- Create: `frontend/public/fonts/inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2`, `jetbrains-mono-latin-wght-normal.woff2`, `jetbrains-mono-latin-ext-wght-normal.woff2`, `Inter-OFL.txt`, `JetBrainsMono-OFL.txt`
- Create: `frontend/src/scss/base/_fonts.scss`
- Modify: `frontend/src/scss/styles.scss`, `frontend/src/scss/base/_tokens.scss` (Typography block)
- Modify: `frontend/src/pug/includes/head.pug`, `frontend/src/pug/index.pug` (preload)
- Modify: `frontend/src/scss/components/_library-details.scss:96,106`, `_headerbar.scss:180` (if Task 5 left a mono font there)
- Test: `test/frontend/library-build.test.js` (font assertions)

**Interfaces:**
- Produces: `--font-family`, `--font-mono` and `--font-numeric` tokens, plus the `.tabular` utility class (used by Phase 2 for `v12 · draft`).

- [ ] **Step 1: Write the failing build assertions**

Add to `test/frontend/library-build.test.js`, inside the top-level describe that uses `readDist`:

```js
  test("ships self-hosted fonts with licences and preloads Inter", () => {
    const fontsDir = path.resolve(__dirname, "../../frontend/dist/fonts");
    for (const f of [
      "inter-latin-wght-normal.woff2",
      "inter-latin-ext-wght-normal.woff2",
      "jetbrains-mono-latin-wght-normal.woff2",
      "jetbrains-mono-latin-ext-wght-normal.woff2",
      "Inter-OFL.txt",
      "JetBrainsMono-OFL.txt",
    ]) {
      expect(fs.existsSync(path.join(fontsDir, f))).toBe(true);
    }
    const html = readDist("app.html");
    expect(html).toMatch(/<link[^>]+rel="preload"[^>]+\/fonts\/inter-latin-wght-normal\.woff2/);
    expect(readDist("css/styles.css")).toMatch(/font-family:\s*"?Inter"?/);
  });
```

If `fs`, `path` or `__dirname` aren't already imported or defined at the top of that file, add them using the same pattern as `library-init.test.js` (`import fs from "fs"; import path from "path"; import url from "url"; const __dirname = path.dirname(url.fileURLToPath(import.meta.url));`).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/library-build.test.js`
Expected: FAIL (font files missing).

- [ ] **Step 3: Vendor the font files**

```bash
TMP="$(mktemp -d)"
( cd "$TMP" && npm pack @fontsource-variable/inter@5 @fontsource-variable/jetbrains-mono@5 >/dev/null \
  && mkdir inter jbm && tar -xzf fontsource-variable-inter-*.tgz -C inter && tar -xzf fontsource-variable-jetbrains-mono-*.tgz -C jbm )
ls "$TMP/inter/package/files" | grep -E "^inter-latin(-ext)?-wght-normal.woff2$"
ls "$TMP/jbm/package/files" | grep -E "^jetbrains-mono-latin(-ext)?-wght-normal.woff2$"
mkdir -p frontend/public/fonts
cp "$TMP"/inter/package/files/inter-latin-wght-normal.woff2 "$TMP"/inter/package/files/inter-latin-ext-wght-normal.woff2 frontend/public/fonts/
cp "$TMP"/jbm/package/files/jetbrains-mono-latin-wght-normal.woff2 "$TMP"/jbm/package/files/jetbrains-mono-latin-ext-wght-normal.woff2 frontend/public/fonts/
cp "$TMP"/inter/package/LICENSE frontend/public/fonts/Inter-OFL.txt
cp "$TMP"/jbm/package/LICENSE frontend/public/fonts/JetBrainsMono-OFL.txt
grep -c "SIL OPEN FONT LICENSE" frontend/public/fonts/*-OFL.txt
du -ch frontend/public/fonts/*.woff2 | tail -1
```

Expected: both `ls` lines print 2 filenames; each OFL file counts ≥1; the total is roughly 100–130K. If the fontsource file names differ, stop and use the names actually present, keeping the destination names above.

Copy the exact `unicode-range` values for the next step from `"$TMP"/inter/package/index.css` (the `latin` and `latin-ext` blocks).

- [ ] **Step 4: Declare the faces**

Create `frontend/src/scss/base/_fonts.scss`. Paste the `unicode-range` values from Step 3; the values below are the fontsource 5.x ranges, so check them against `index.css`.

```scss
// ═══════════════════════════════════════════════════════════════════
// Self-hosted fonts (SIL OFL 1.1 — licences in /fonts/*-OFL.txt)
// Variable weight, latin + latin-ext subsets, no italics.
// ═══════════════════════════════════════════════════════════════════

$latin: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
$latin-ext: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;

@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("/fonts/inter-latin-wght-normal.woff2") format("woff2-variations");
  unicode-range: $latin;
}

@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("/fonts/inter-latin-ext-wght-normal.woff2") format("woff2-variations");
  unicode-range: $latin-ext;
}

@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: url("/fonts/jetbrains-mono-latin-wght-normal.woff2") format("woff2-variations");
  unicode-range: $latin;
}

@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: url("/fonts/jetbrains-mono-latin-ext-wght-normal.woff2") format("woff2-variations");
  unicode-range: $latin-ext;
}
```

In `styles.scss`, add `@use 'base/fonts';` right after `@use 'themes/graphite';`.

- [ ] **Step 5: Update the typography tokens**

In `_tokens.scss`, replace the `--font-family` and `--font-mono` declarations with:

```scss
  --font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "Cascadia Code", monospace;
  // Tabular figures for data columns (sizes, versions, CIDs, addresses)
  --font-numeric: "tnum" 1, "zero" 1;
```

Then, after the `.sr-only` utility in `_tokens.scss`, add:

```scss
// Data readouts: mono + tabular figures
.tabular {
  font-family: var(--font-mono);
  font-feature-settings: var(--font-numeric);
}
```

- [ ] **Step 6: Preload Inter**

In `frontend/src/pug/includes/head.pug`, directly after `link(rel="stylesheet", href="/css/styles.css")`, add:

```pug
link(rel="preload", href="/fonts/inter-latin-wght-normal.woff2", as="font", type="font/woff2", crossorigin)
```

Add the same line after the stylesheet link in `frontend/src/pug/index.pug` (line 17).

- [ ] **Step 7: Remove the hand-written mono stacks**

- `_library-details.scss:96` and `:106`: `font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;` → `font-family: var(--font-mono);` and on the next line add `font-feature-settings: var(--font-numeric);`
- Run `grep -n "font-family" frontend/src/scss/components/_landing.scss frontend/src/scss/components/_headerbar.scss`. Any remaining hand-written mono stack becomes `var(--font-mono)`. `.headerbar-wallet` must use `var(--font-family)`, which Task 5 already set.

- [ ] **Step 8: Run tests and build**

Run: `cd frontend && bun run build && cd .. && bun scripts/run-tests.mjs test/frontend/library-build.test.js test/frontend/style-guards.test.js && bun run test:frontend`
Expected: PASS, including the now-green mono guard.

Check `src/index.ts` static serving: `curl -sI http://localhost:9090/fonts/inter-latin-wght-normal.woff2 | head -3` against a running dev stack should return `200` with `content-type: font/woff2`. If the content type is wrong, add the `woff2` MIME mapping wherever `setStaticCacheHeaders` lives and note it in the commit.

- [ ] **Step 9: Commit**

```bash
git add frontend/public/fonts frontend/src test/frontend/library-build.test.js
git commit -m "feat(type): self-host Inter + JetBrains Mono (OFL), tabular figures for data"
```

---

### Task 7: Viewport colours follow the theme

**Files:**
- Modify: `frontend/src/js/engine/theme.ts` (add `readViewportTheme`)
- Modify: `frontend/src/js/engine/scene-graph.ts:12,105-117,167,213-230`
- Test: `test/frontend/theme.test.js` (add cases)

**Interfaces:**
- Consumes: the `--viewport-bg`, `--viewport-grid` and `--selection` tokens (Task 1), and `normalizeHex` (existing, private, in `theme.ts`).
- Produces:
  ```ts
  export interface ViewportTheme { bg: string; grid: string; selection: string } // "#rrggbb"
  export function readViewportTheme(read?: (name: string) => string): ViewportTheme
  ```

- [ ] **Step 1: Write the failing test**

Append to `test/frontend/theme.test.js`:

```js
describe("readViewportTheme", () => {
  test("reads tokens and normalizes them", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    const vals = { "--viewport-bg": " #C9CACC ", "--viewport-grid": "#b3b4b7", "--selection": "a35a12" };
    expect(theme.readViewportTheme((n) => vals[n] ?? "")).toEqual({
      bg: "#c9cacc",
      grid: "#b3b4b7",
      selection: "#a35a12",
    });
  });

  test("falls back to Graphite values when tokens are missing or invalid", async () => {
    stubMatchMedia(false);
    const { theme } = await load();
    expect(theme.readViewportTheme(() => "nope")).toEqual({
      bg: "#2a2b2f",
      grid: "#3c3e44",
      selection: "#f0a64b",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/run-tests.mjs test/frontend/theme.test.js`
Expected: FAIL (`readViewportTheme is not a function`).

- [ ] **Step 3: Implement `readViewportTheme`**

In `frontend/src/js/engine/theme.ts`, after `hexToColor4`, add:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun scripts/run-tests.mjs test/frontend/theme.test.js`
Expected: PASS.

- [ ] **Step 5: Use it in the scene**

In `frontend/src/js/engine/scene-graph.ts`:

Line 12 import becomes `import { hexToColor3, hexToColor4, readViewportTheme } from "./theme.ts";`. Keep `getCssVar` in the import if other code in the file still uses it (`grep -n getCssVar frontend/src/js/engine/scene-graph.ts`).

Replace `_syncViewportBackground` and its `on(...)` line (105–117) with:

```ts
function _syncViewportTheme() {
  if (!state.scene) return;
  const vt = readViewportTheme();
  state.scene.clearColor =
    hexToColor4(vt.bg, 1) || new BABYLON.Color4(0.102, 0.106, 0.118, 1);
  const gridMat = state.scene.getMaterialByName(
    "gridMat",
  ) as BABYLON.StandardMaterial | null;
  const grid = hexToColor3(vt.grid);
  if (gridMat && grid) gridMat.emissiveColor = grid;
}

// Re-sync viewport colours when the theme changes.
on(EVENTS.THEME_CHANGED, _syncViewportTheme);
```

Line 167: `_syncViewportBackground();` → `_syncViewportTheme();`

In the ground-grid block (around 213–230), replace

```ts
    mat.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);
    mat.disableLighting = true;
    mat.alpha = 0.3;
```

with

```ts
    // Token colour is the final on-screen colour (no alpha blend), so the
    // grid stays a predictable step from --viewport-bg in every theme.
    mat.emissiveColor =
      hexToColor3(readViewportTheme().grid) || new BABYLON.Color3(0.18, 0.19, 0.21);
    mat.disableLighting = true;
```

Order check: `_syncViewportTheme()` at line 167 runs before the grid exists, so the grid gets its initial colour from the creation code above, and later changes come through `THEME_CHANGED`.

- [ ] **Step 6: Typecheck, tests, and a real-scene check**

Run: `bun run typecheck:frontend && bun run test:frontend`
Expected: PASS.

Then start the dev stack (see AGENTS.md; `start-dev.sh`), open `/studio`, switch the theme through the picker, and check:
- Paper shows a mid-grey viewport with a slightly darker grid.
- Graphite shows a near-black viewport with a subtle grid.
- Selecting a mesh shows the amber outline in both themes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/js/engine test/frontend/theme.test.js
git commit -m "feat(viewport): background, grid and selection colours follow the theme"
```

---

### Task 8: Docs, skills, and the visual verification pass

**Files:**
- Modify: `.agents/skills/edit-ui/SKILL.md` (and any reference files it lists that describe the colour/HIG rules)
- Modify: `.agents/skills/gnome-hig-audit/SKILL.md`
- Modify: `docs/CURRENT_STATUS.md` (frontend feature list)
- Modify: `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md` (mark Phase 1 done)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the `edit-ui` skill**

Read `.agents/skills/edit-ui/SKILL.md` in full. Replace every statement that makes GNOME HIG the design authority with this block (adapt the heading level to the file):

```markdown
## Design authority

1. **WCAG 2.2 AA** — accessibility truth. Enforced by `test/frontend/theme-contrast.test.js`.
2. **Web platform conventions** — WAI-ARIA APG patterns (`ui/menu-button.ts` for menus), browser keyboard defaults, `prefers-*` and `forced-colors` media.
3. **Arbesk design language** — `docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md`:
   flat surfaces, `--hairline` structure, one accent used only for the primary action,
   sentence-case headings, Inter for UI, JetBrains Mono (`.tabular`) only for data.

GNOME HIG layout heuristics (header bar, 4px spacing) are non-binding references.

## Colour rules

- Use only theme-contract tokens (`themes/_graphite.scss`, `themes/_paper.scss`). Never hex in `components/`.
- New colour role? Add it to **both** theme files and to `CONTRACT` in `theme-contrast.test.js`.
- Selectors that depend on light vs dark use `[data-scheme="dark|light"]`, never theme names.
```

Remove any other instructions that conflict with this block (for example "match libadwaita colours" or "uppercase section titles").

- [ ] **Step 2: Update the `gnome-hig-audit` skill**

In `.agents/skills/gnome-hig-audit/SKILL.md`:
- In the description frontmatter, change "GNOME HIG compliance" wording to "UI/UX audit (WCAG 2.2, web conventions, Arbesk design language)".
- Replace the "Hard rule" paragraph's reference list so that **Arbesk design language** (the roadmap doc) replaces **GNOME HIG** as the visual/layout authority, and GNOME HIG becomes "optional layout heuristics".
- Category A (Color & Theming) cites the theme contract and the contrast test.

Keep the skill's name and directory unchanged so existing triggers keep working.

- [ ] **Step 3: Update CURRENT_STATUS**

In `docs/CURRENT_STATUS.md`, in the frontend feature section (`grep -n -i "theme\|dark mode\|frontend" docs/CURRENT_STATUS.md | head`), replace any light/dark toggle mention with:

```markdown
- Themes: Graphite (dark) and Paper (light) with a System / Graphite / Paper picker (header). Token contract in `frontend/src/scss/themes/`; WCAG 2.2 AA contrast enforced by `test/frontend/theme-contrast.test.js`. Self-hosted Inter + JetBrains Mono.
```

If no such section exists, add the bullet under the frontend/UI feature list.

- [ ] **Step 4: Visual verification pass**

Run `cd frontend && bun run build`, start the dev stack, and use Playwright MCP (or `bun run test:e2e` helpers) at **1440×900** to capture, in **both** themes:
1. `/library` signed out
2. `/studio` with no asset
3. `/studio` with a mock-generated asset selected
4. the theme menu open

Save the screenshots under `.playwright-mcp/phase1-*.png`; that folder is gitignored. Check each against the spec:
- no brown;
- the amber fill appears only on primary actions;
- sentence-case section titles;
- the viewport is mid-grey on Paper;
- focus rings are visible when tabbing through the header.

Attach the screenshots to the PR description, not the repo.

- [ ] **Step 5: Full verification**

Run: `bun run lint && bun run typecheck && bun run typecheck:frontend && bun run test:frontend`
Expected: all PASS.

Run: `bun run test:e2e` against a fresh dev stack (project memory: E2E reuses any backend on :9090, so restart it first).
Expected: PASS. Phase 1 doesn't change any E2E selectors.

- [ ] **Step 6: Mark the roadmap and commit**

In the roadmap's phase table, change Phase 1's "Spec" cell to append ` — **done**`.

```bash
git add .agents/skills/edit-ui .agents/skills/gnome-hig-audit docs/CURRENT_STATUS.md docs/superpowers/specs/2026-10-04-ui-refresh-roadmap.md
git commit -m "docs: Arbesk design language replaces GNOME HIG as UI authority; Phase 1 done"
```

# Phase 1 — Theme System & Re-skin (Graphite / Paper) — Design

**Date:** 2026-10-04 · **Roadmap:** `2026-10-04-ui-refresh-roadmap.md` · **Status:** approved in brainstorm

## 1. Goal

Replace the brown/gold Arabesque palette with two modern, near-neutral themes:
**Graphite** (dark) and **Paper** (light). Add a theme picker (System / Graphite / Paper).
Self-host Inter + JetBrains Mono, and remove the dated styling (gradients, uppercase
headings, heavy borders). The 3D viewport stays colour-neutral in both themes. WCAG 2.2 AA
contrast is enforced by a unit test.

## 2. Non-goals

- Layout or IA changes: the header, rail and New menu are Phase 2. Phase 1 restyles the existing DOM.
- Community themes. The contract supports them; none ship.
- A viewport-backdrop user setting. The token exists, but there's no UI for it.
- Mobile.

## 3. Architecture

Keep the existing **Layer 3 alias names** (`--window-bg`, `--accent-bg`, …). Components
already consume these, so component churn is limited to the leaks listed in §6.

```
frontend/src/scss/
  base/_tokens.scss      scales only (spacing, type, radii, shadows, motion, layout dims)
                         + derived tokens (overlays, focus ring, hairline) via color-mix()
                         + prefers-contrast / reduced-motion / forced-colors blocks
  base/_fonts.scss       NEW — @font-face for Inter + JetBrains Mono
  themes/_graphite.scss  NEW — :root[data-theme="graphite"] { full alias set, literal hex }
  themes/_paper.scss     NEW — :root[data-theme="paper"]    { full alias set, literal hex }
  themes/_index.scss     NEW — @use both; :root falls back to Paper values when no data-theme
```

- The raw palette (`--choco-*`, `--gold-*`, `--red-*`, `--green-*`, `--yellow-*`) is **deleted**.
- Theme files contain **only literal `#rrggbb` values**, one `--token: #hex;` per line, so the
  contrast test can parse them without a Sass compiler.
- Each theme sets `color-scheme: dark|light` so native controls (scrollbars, `<select>`,
  date pickers) follow the theme.
- `@media (prefers-color-scheme)` blocks are removed from SCSS. The **System** choice is
  resolved by JS into a concrete `data-theme` (graphite|paper), as `theme-init.ts` already does
  for dark/light.

### 3.1 Token contract (every theme must define all of these)

| Token | Role |
|---|---|
| `--window-bg` / `--window-fg` | app base (rail, page background) / primary text |
| `--view-bg` / `--view-fg` | content views (library grid area) |
| `--headerbar-bg` / `--headerbar-fg` | header bar |
| `--sidebar-bg` / `--sidebar-fg` | sidebar and inspector panels |
| `--card-bg` / `--card-fg` | cards, raised rows |
| `--popover-bg` / `--popover-fg` | menus, popovers, dialogs |
| `--raised-bg` | NEW — hover rows, segmented-control track, input fill |
| `--border-color` | **control** boundary (inputs, outlined buttons); must be ≥3:1 vs adjacent surfaces |
| `--hairline` | NEW — decorative dividers between panels and rows (no contrast requirement) |
| `--dim-fg` | muted/secondary text; must be ≥4.5:1 on every surface |
| `--accent-bg` / `--accent-fg` | primary button fill / its text |
| `--accent-text` | NEW — accent used as text, icon or focus ring on surfaces |
| `--destructive-bg` / `--destructive-fg` | destructive button fill / its text |
| `--danger-text`, `--success`, `--warning`, `--info` | NEW — status text and icons on surfaces (`--info` = measurements) |
| `--viewport-bg`, `--viewport-grid`, `--selection` | 3D scene background, grid lines, selection outline/glow |

`--border-hairline` (existing derived token) becomes an alias of `--hairline`.
`--accent-bg-rgb` is removed (its users switch to `color-mix()`). `--highlight-amber` →
`--selection`. `--clock-accent` stays a theme-independent token in `_tokens.scss`. The axis
colours `--axis-x|y|z` stay theme-independent: they follow the Blender convention and are
not chrome.

### 3.2 Values

Ratios were computed with the WCAG 2.x relative-luminance formula. Surfaces are window / sidebar / raised.

**Graphite (`color-scheme: dark`)**

| Token | Hex | Checks |
|---|---|---|
| window-bg | `#141416` | |
| sidebar-bg, headerbar-bg, card-bg, view-bg | `#1b1c1f` | |
| raised-bg, popover-bg | `#26272b` | |
| window-fg (all `*-fg` text) | `#e6e6e3` | 14.7 / 13.6 / 11.9 |
| dim-fg | `#8f9197` | 5.8 / 5.4 / 4.7 |
| border-color | `#70737b` | 3.9 / 3.6 / 3.2 |
| hairline | `#2c2e33` | decorative |
| accent-bg / accent-fg | `#f0a64b` / `#1a1206` | 9.1 |
| accent-text | `#f0a64b` | 9.0 / 8.3 / 7.3 |
| destructive-bg / -fg | `#c9343a` / `#ffffff` | 5.2 |
| danger-text | `#ff6b6b` | 6.6 / 6.1 / 5.4 |
| success | `#7fd88f` | 10.6 / 9.8 / 8.6 |
| warning | `#f0a64b` | = accent-text |
| info | `#5ccfe6` | 10.1 / 9.4 / 8.2 |
| viewport-bg | `#1a1b1e` | |
| viewport-grid | `#2e3035` | decorative |
| selection | `#f0a64b` | 8.4 vs viewport-bg |

**Paper (`color-scheme: light`)**

| Token | Hex | Checks |
|---|---|---|
| window-bg | `#f7f7f5` | |
| sidebar-bg, headerbar-bg, card-bg, view-bg, popover-bg | `#ffffff` | |
| raised-bg | `#f0f0ed` | |
| window-fg (all `*-fg` text) | `#1b1b1d` | 16.0 / 17.2 / 15.1 |
| dim-fg | `#6b6b70` | 4.9 / 5.3 / 4.6 |
| border-color | `#85858b` | 3.4 / 3.7 / 3.2 |
| hairline | `#e4e4e0` | decorative |
| accent-bg / accent-fg | `#a35a12` / `#ffffff` | 5.2 |
| accent-text | `#a35a12` | 4.9 / 5.2 / 4.6 |
| destructive-bg / -fg | `#c01c28` / `#ffffff` | 6.1 |
| danger-text | `#c01c28` | 5.7 / 6.1 / 5.4 |
| success | `#2a7036` | 5.6 / 6.1 / 5.3 |
| warning | `#a35a12` | = accent-text |
| info | `#0e7490` | 5.0 / 5.4 / 4.7 |
| viewport-bg | `#c9cacc` | neutral mid-grey (decision L2) |
| viewport-grid | `#b3b4b7` | decorative |
| selection | `#a35a12` | 3.2 vs viewport-bg (non-text ≥3:1) |

The brand amber `#f0a64b` survives on Paper only in the logo mark, which is decorative.

## 4. Components

### 4.1 Contrast test — `test/frontend/theme-contrast.test.js` (new)

- Reads `themes/_graphite.scss` and `themes/_paper.scss` as text and parses `--name: #hex;`.
- Asserts **every contract token is defined** in each theme (§3.1).
- Asserts these pairs, with the surfaces `window-bg`, `sidebar-bg`, `raised-bg`, `popover-bg`:
  - `window-fg`, `dim-fg`, `accent-text`, `danger-text`, `success`, `info` on each surface ≥ 4.5
  - `accent-fg` on `accent-bg`, `destructive-fg` on `destructive-bg` ≥ 4.5
  - `border-color` on each surface ≥ 3.0
  - `selection` on `viewport-bg` ≥ 3.0
- Asserts that no `#rrggbb` literal appears under `scss/components/`, with an explicit allow-list
  for `_landing.scss` artwork if one is needed (§6). This stops new hex leaks.

### 4.2 Theme runtime — `engine/theme.ts`, `engine/theme-init.ts`

- `ThemeName = "graphite" | "paper"` and `ThemePref = "system" | ThemeName`.
- Storage key stays `arbesk-theme`. On read, `"dark"` → `"graphite"` and `"light"` → `"paper"`
  (migration; the stored value is rewritten). A missing or invalid value means `"system"`.
- `"system"` resolves through `matchMedia("(prefers-color-scheme: dark)")` and follows changes
  live. An explicit choice ignores the OS.
- `theme-init.ts` (blocking, pre-paint) applies the same resolution, so there's no flash.
- New exports: `getThemePref()`, `setThemePref(pref)`. `toggleTheme` is removed. `THEME_CHANGED`
  is emitted with `{ theme, pref }`.

### 4.3 Theme picker — header `#themeToggle` → `#themeMenuBtn`

- Uses the WAI-ARIA **menu button** pattern, implemented as a reusable helper `ui/menu-button.ts`: `aria-haspopup="menu"`, `aria-expanded`, and a
  `role="menu"` containing three `role="menuitemradio"` items with `aria-checked`. Arrow keys,
  Home/End, Enter/Space and Esc behave per the pattern, and focus returns to the button on close.
- Items: System, Graphite, Paper, each with a small two-swatch preview.
- Phase 2 keeps this button in the header; the menu-button logic is a reusable helper (`ui/menu-button.ts`) that Phase 2's New ▾ menu also uses.

### 4.4 Fonts — `base/_fonts.scss`, `frontend/public/fonts/`

- Vendored files: the variable-weight, normal-style **latin** and **latin-ext** woff2 subsets of
  Inter and JetBrains Mono (from `@fontsource-variable/inter` and
  `@fontsource-variable/jetbrains-mono`, copied once and committed, not a runtime dependency), plus
  both `OFL.txt` licence files (SIL OFL 1.1). No italics.
- `@font-face` uses `font-display: swap` and `unicode-range` per subset. `head.pug` preloads the Inter latin file only.
- `--font-family: "Inter", system-ui, sans-serif` and `--font-mono: "JetBrains Mono", ui-monospace, monospace`.
- Add `--font-numeric: "tnum" 1` and apply it to mono data cells (sizes, CIDs, versions, addresses).
- Mono is used **only** for data. Remove it from `.headerbar-wallet` and any other UI labels.
- The 4 hand-written `ui-monospace, SFMono-Regular…` stacks (`_library-details.scss`, `_landing.scss`) switch to `var(--font-mono)`.

### 4.5 3D viewport — `engine/scene-graph.ts`, `engine/scene-selection.ts`

- The grid material colour reads `--viewport-grid` (replacing the hard-coded `Color3(0.35, …)`
  and `alpha` tweak). `_syncViewportBackground` becomes `_syncViewportTheme` and updates the
  background **and** the grid on `THEME_CHANGED`.
- Selection reads `--selection` on each selection (no caching). The fallback hex becomes `#f0a64b`.
- Model lighting is unchanged.

## 5. Dated-styling cleanup

- **Gradients:** `--gradient-accent`, `--gradient-headerbar` and `--gradient-sidebar` are removed. Their users
  (`_buttons`, `_headerbar`, `_sidebar`, `_bottombar`, `_inspector`) use flat `var(--*-bg)`.
  Landing-page artwork gradients (`_landing.scss`) stay but are rebuilt from tokens.
- **Uppercase:** every `text-transform: uppercase` and its `letter-spacing` in `scss/components/` is
  removed. Section titles become sentence case at `--font-size-1` and weight 600 in `--dim-fg`.
- **Borders:** panel dividers and section boxes use `--hairline`. `--border-color` is kept for
  controls only. Inspector `details` sections lose their boxed outline and become flat
  disclosure rows.
- **Accent discipline:** filled accent is used only for the single primary action per region
  (Besk it, Sign in, Generate, Open). Active tabs, the grid toggle and the network selector use
  `--raised-bg` plus `--accent-text` for the icon or indicator, not a filled accent.
- **Shadows:** keep `--shadow-3..5` for floating layers only (popovers, dialogs, the floating
  viewport toolbar). Static cards get none.
- **Viewport overlay toolbar:** disabled icons must stay ≥3:1 against `--viewport-bg`. Use
  `--dim-fg` on a `--sidebar-bg` pill, not opacity on accent.

## 6. Leak fixes (required for the §4.1 hex test)

- **21 hex literals** in components (`_landing` 10, `_cards` 6, `_chat` 2, `_wallet-popover`,
  `_library-context-menu`, `_dialog`) are replaced with tokens. If landing artwork genuinely needs
  a literal, it goes in the test's allow-list with a comment.
- **19 raw-palette references** (`var(--green-4)`, `var(--yellow-4)`, `var(--red-3)`,
  `var(--choco-*)`, `var(--gold-7)`) in `_buttons`, `_chat`, `_landing`, `_library-grid`,
  `_sidebar`, `_testnet-banner`, `_toasts`, `_version-clock`, `_viewport` and `_wallet-popover`
  are mapped to `--success`, `--warning`, `--destructive-*` / `--danger-text`, or surface tokens.
- **The landing hero headline** ("The world is 4D.") must reach ≥3:1 as large text in its final
  animated state, in both themes.

## 7. Accessibility and platform behaviour

- `prefers-contrast: more`: control and hairline borders become `currentColor`, shadows are
  removed and the focus ring becomes solid. The existing block is kept and updated for the new tokens.
- `forced-colors: active`: focus rings use `outline` (not only `box-shadow`) so they survive.
  The selected state on rail and menu items uses `Highlight`/`HighlightText`.
- `prefers-reduced-motion`: the existing duration zeroing is kept.
- Focus ring: `outline: 2px solid var(--accent-text); outline-offset: 2px` on `:focus-visible`
  for every interactive element (WCAG 2.4.7, and 2.4.11 for focus not obscured). This replaces
  the box-shadow-only ring.

## 8. Docs and skills

- `.agents/skills/edit-ui/` and `.agents/skills/gnome-hig-audit/` (`.claude/skills` is a symlink to these): replace "GNOME HIG design
  language" as the authority with the precedence in the roadmap (WCAG 2.2 AA → web conventions →
  Arbesk design language). Keep the useful HIG layout heuristics as *non-binding* references.
  Update the colour, token and font sections to this spec.
- `docs/CURRENT_STATUS.md`: note the theme picker and Graphite/Paper in the frontend feature list. (`ARCHITECTURE.md` and `AGENTS.md` don't mention the palette.)

## 9. Testing

- New: `theme-contrast.test.js` (§4.1) and `theme.test.js` (pref resolution, dark/light migration,
  system follow, `THEME_CHANGED` payload, menu-button keyboard behaviour with a DOM shim as in
  existing frontend tests).
- Existing: `bun run test:frontend`, `bun run lint`, `bun run typecheck:frontend`. Any test
  asserting `data-theme="dark"|"light"` or `#themeToggle` is updated.
- E2E: specs touching `themeToggle` are updated to the new menu.
- Visual: a Playwright screenshot pass of Library (signed out), Studio (empty) and Studio with a
  loaded mock asset, in both themes at 1440×900, attached to the PR.

## 10. Risks

- **Phase 2 overlap:** Phase 2 restructures the header. To avoid restyling twice, Phase 1 styles
  the header's existing controls minimally (tokens and flat styling only).
- **Font weight:** about 100 KB for the four latin/latin-ext subsets (woff2 is already compressed). Only Inter latin is preloaded; the browser fetches the other subsets lazily via `unicode-range`.
- **Babylon colours:** the Paper grid colour may need a tuning pass once seen with real models. That's
  a token edit, not a code change.

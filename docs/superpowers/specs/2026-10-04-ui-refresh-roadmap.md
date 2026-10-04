# UI Refresh — Roadmap

**Date:** 2026-10-04 · **Status:** approved direction; phases 1–2 done, 3–5 to spec

## Why

Feedback: Studio "looks old school". Assessment (2026-10-04):

- **Palette:** every surface, border, text and accent comes from one brown/gold
  ramp (`--choco-*`, `--gold-*`). That reads as 2010s skeuomorphism, and in dark
  mode the brown chrome around a neutral viewport skews how people see the model's colours.
- **Accent overuse:** a muddy gold (`#8c673c`) fills the tab, testnet pill, grid
  toggle, send button and CTA, so there is no hierarchy. The testnet pill is the loudest element on screen.
- **Leftovers from older styling:** gradients, heavy borders around every section, letter-spaced uppercase headings,
  and a monospace Login button.
- **Product framing:** Studio opens on "AI Generation". Arbesk is mainly an
  **asset repository** whose viewport is for viewing and light placement, not
  modelling. The UI should put the Library, the asset's facts and its version history first.

## Design authority

GNOME HIG is **no longer authoritative**. Order of precedence:

1. **WCAG 2.2 AA**: accessibility truth, enforced by tests where possible.
2. **Web platform conventions**: WAI-ARIA Authoring Practices patterns,
   browser keyboard defaults, `prefers-color-scheme` / `prefers-contrast` /
   `prefers-reduced-motion` / `forced-colors`.
3. **Arbesk design language** (this roadmap): Omarchy-style themeable tokens,
   flat surfaces, hairlines, one accent, mono only for data.

## Phases

| # | Phase | Spec | Depends on |
|---|-------|------|------------|
| 1 | Theme system & re-skin (Graphite / Paper, picker, Inter + JetBrains Mono, neutral viewport) | `2026-10-04-ui-theme-graphite-paper-design.md` — **done** (#92–#98) | — |
| 2 | Library-first layout (landing, New ▾, avatar menu, status dot, Outline/Assets/Create/Activity rail, Settings → Properties) | `2026-10-04-ui-library-first-design.md` — **done** (#100–#106) | Phase 1; **CAD frontend plan (`2026-10-04-cad-frontend-integration.md`) merged** |
| 3 | Asset info readouts: bounding box in mm, triangle count, format/size, print-ready (manifold) badge; metadata fields for licence/material/print notes replacing "Notes for the AI" | `2026-10-04-asset-info-readouts-design.md` — **done** | Phase 2 |
| 4 | Version timeline strip under the viewport (replaces V-key time mode as the main entry) | to write | Phase 2 |
| 5 | View / Edit mode: view by default, explicit Edit toggle, snap-to-ground move/rotate, no scale gizmo by default, visible unsaved state; free the `G` key | to write | Phase 2 |

Phases 3–5 each get their own brainstorm → spec → plan cycle.

## Non-goals (all phases)

- Mobile/touch layouts. The target is laptop and desktop (≥1280px wide), widescreen.
- Modelling tools (numeric transforms, display modes, orthographic views, Blender/Maya keymaps).
- Community theme pack (Tokyo Night, Catppuccin, …). The Phase 1 token contract
  makes these one-file additions later.

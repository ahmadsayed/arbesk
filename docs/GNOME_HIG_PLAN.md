# Arbesk Studio — GNOME HIG Unification Plan

> **Status**: Draft — not yet implemented  
> **This file has been split into focused documents.** See the index below.

---

## Quick Summary

**The problem**: 4 panels controlled by 3 toggle buttons in 3 different corners. Topbar crams 7 elements. No nesting navigation. No scene hierarchy.

**The solution**: Standard GNOME 3-column layout. Panels reduced 4→2. Toggle buttons reduced 3→1. New nesting UX with path bar, back button, Outline scene tree, and depth indicator. Bootstrap dropped in favor of a 16-file SCSS architecture with semantic tokens and `prefers-color-scheme` support.

**Effort**: ~13.5 days across 8 incremental phases. No big-bang rewrite.

---

## Document Index

| File | What's in it | Read when... |
|---|---|---|
| [`docs/hig/README.md`](docs/hig/README.md) | Full index with links and resource references | Starting point |
| [`docs/hig/audit.md`](docs/hig/audit.md) | Current state audit, HIG violations, CSS problems | Understanding what's broken |
| [`docs/hig/layout.md`](docs/hig/layout.md) | Architecture diagrams, layout zones, adaptive breakpoints | Designing the new layout |
| [`docs/hig/tokens.md`](docs/hig/tokens.md) | Full color token system, CSS methodology rules, Pug decision | Implementing Phase A (CSS foundation) |
| [`docs/hig/nesting.md`](docs/hig/nesting.md) | Nesting UX: path bar, outliner, inspector dual-mode, dive/ascend | Implementing Phases C-E |
| [`docs/hig/implementation.md`](docs/hig/implementation.md) | All 8 phases, migration, file map, comparison, open questions | Planning and tracking |

---

## Key Resources

| Resource | URL |
|---|---|
| GNOME HIG | https://developer.gnome.org/hig/ |
| libadwaita CSS variables | https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/css-variables.html |
| Open Props tokens | https://open-props.style/ |
| MDN CSS Organization | https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Organizing |

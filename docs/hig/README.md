# Arbesk Studio — GNOME HIG Unification

> **Status**: Implemented — Phase 4 complete
> **Goal**: Simplify and unify a complex, cluttered 3D studio UI using GNOME Human Interface Guidelines

---

## Quick Summary

**The problem**: 4 panels controlled by 3 toggle buttons in 3 different corners, each with a different animation. Topbar crams 7 elements. No nesting navigation. No scene hierarchy.

**The solution**: Standard GNOME 3-column layout:

| Zone | Content |
|---|---|
| **Header Bar** | Brand icon + page switcher (Library/Studio) + document title + history timeline pill + Save/Besk it + path bar (when nested). Wallet button lives here. |
| **Left Sidebar** | View Switcher: AI Generation / Settings / Outline / Gallery / Activity |
| **Content Center** | 3D viewport (prompt input lives at the bottom of the AI Generation view) |
| **Right Inspector** | Appears on node selection. Modes: parametric color editor, token child info, asset comments |
| **Bottom Bar** | Status (draft/depth, counts) + keyboard-shortcuts button |

**Panels reduced**: 4 → 2
**Toggle buttons reduced**: 3 → 1
**New nesting UX**: Path bar breadcrumbs, back button, Outline scene tree, depth indicator
**CSS**: 1 file (2136 lines + Bootstrap) → 29 SCSS partials + semantic tokens + `prefers-color-scheme`
**Effort**: ~13.5 days across 8 phases

---

## Document Index

| File | What's in it | Read when... |
|---|---|---|
| [`audit.md`](audit.md) | Current state audit, HIG violations, CSS problems | Understanding what's broken |
| [`layout.md`](layout.md) | Architecture diagrams, layout zones, adaptive breakpoints | Designing the new layout |
| [`tokens.md`](tokens.md) | Full color token system, CSS methodology rules, Pug decision | Implementing Phase A (CSS foundation) |
| [`nesting.md`](nesting.md) | Nesting UX: path bar, back button, outliner, inspector modes, dive/ascend | Implementing Phases C-E (sidebar, inspector, content) |
| [`implementation.md`](implementation.md) | All 8 phases, migration strategy, before/after comparison, open questions, effort, file map | Planning work and tracking progress |

---

## Key Resources

| Resource | URL |
|---|---|
| GNOME HIG | https://developer.gnome.org/hig/ |
| libadwaita CSS variables | https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/css-variables.html |
| Open Props tokens | https://open-props.style/ |
| MDN CSS Organization | https://developer.mozilla.org/en-US/docs/Learn/CSS/Building_blocks/Organizing |

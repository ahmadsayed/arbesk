# Outline Panel Styling Redesign

**Date:** 2026-06-14  
**Status:** Approved for implementation  
**Approach:** Hybrid + Contained Card

## Problem

The Outline panel in Arbesk Studio currently looks unpolished and "floaty":
- Row spacing and alignment feel loose.
- There are no borders or separators to ground the list.
- Typography and hierarchy do not clearly distinguish labels from metadata.
- The header/toolbar feels disconnected from the list body.

The panel must also remain usable as the scene graph grows to deeper hierarchies (more layers and nested child worlds).

## Decision

Adopt a **Hybrid + Contained Card** design:
- Contain the tree inside a bordered card with its own background, giving the panel a clear boundary.
- Keep the overall styling light and GNOME-aligned (subtle hover, full-width selection, clean typography).
- Add tree affordances: indentation guides, expand/collapse chevrons, and depth-based padding.

## Visual Design

### Container
- The tree list is rendered inside a card container (`border: 1px solid var(--border-hairline)`, `border-radius: var(--radius-2)`, card background subtly different from the sidebar background, e.g. `color-mix(in srgb, var(--window-fg) 2%, var(--sidebar-bg))` or an existing card surface token).
- The view header receives a subtle bottom border to separate it from the card.

### Rows
- Each node is a flex row with consistent `min-height`, `gap: var(--size-2)`, and inner padding.
- Full-width selection highlight using accent color at ~15% opacity (e.g. `color-mix(in srgb, var(--accent-bg) 15%, transparent)`).
- Hover state via `--surface-overlay-hover`.
- Badges use tabular numerals and muted foreground color.

### Hierarchy
- Indent each row by `depth × 1rem` based on the existing `data-depth` attribute.
- Render a vertical indentation guide line per level for rows at depth ≥ 1.
- Show a chevron on nodes with children; leaf nodes receive an equal-width blank spacer so labels stay aligned.

## Behavior

- Expand/collapse toggles visibility of child nodes. Default state is expanded.
- Drag-and-drop interactions keep their existing logic; only visual states (hover, selected, drop target) are styled.
- Empty state remains in the footer area.

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/scss/components/_outliner.scss` | Add card container styling, row layout, indentation guides, chevron/blank-spacer slots, hover/selected states. |
| `frontend/src/js/ui/outliner.js` | Render depth-based indentation, chevrons for parents, blank spacers for leaves, and any expanded/collapsed state. |
| `frontend/src/pug/studio.pug` | Likely no change; the existing `.outliner-tree` wrapper can be styled via CSS. Verify during implementation. |

## Out of Scope

- No changes to add/remove toolbar logic.
- No changes to drag-and-drop reordering behavior.
- No new keyboard shortcuts.

## Acceptance Criteria

- [ ] Outline tree renders inside a visually contained card.
- [ ] Rows align cleanly: icon, label, and badge are vertically centered.
- [ ] Selected row uses full-width accent highlight.
- [ ] Hover state is visible on all rows.
- [ ] Nested rows show indentation guides and chevrons (or blank spacers for leaves).
- [ ] Design remains usable with at least 5 levels of nesting (`MAX_CHILD_WORLD_DEPTH`).
- [ ] Existing drag-and-drop and selection behavior continues to work.

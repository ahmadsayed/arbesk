# Persistent Headerbar Actions — Design Spec

**Date:** 2026-06-14  
**Status:** Approved  
**Scope:** UX improvement — reduce tab-switching friction for Save / Besk / New

---

## Problem

Save, Besk (publish), and New Asset buttons live inside the **Asset** sidebar tab panel. When a user switches to Gallery, Outline, or Activity tabs, these buttons disappear. The most common workflow — open a scene, browse Gallery to pick a child asset, add it, then save — requires at least two tab switches just to reach the save action.

---

## Solution

Move **New**, **Save**, and **Besk it** into the **headerbar** as a persistent button group. Following GNOME HIG and common web app conventions (Figma, GitHub, Notion), document-level actions belong in the top bar where they are always accessible regardless of sidebar state.

> **Implemented as:** The Studio sidebar uses tabs named **Settings**, **Chat**, **Outline**, **Gallery** (data-view="library"), and **Activity** — there is no "Asset" tab. The headerbar New/Save/Besk group was added between the version controls and the right-side utility cluster, and **Burn** was placed inside the Settings view (inside the Collection Collaborators / team panel area), not in a separate Asset tab.

---

## Layout

Headerbar element order (left → right):

```
[Logo] [Back?] [Title / Path] [Version slider] | [＋ New] [Save] [⬡ Besk it] | [☀] [Network ▾] [Wallet]
```

The `|` marks represent visual dividers (`<span class="headerbar-divider">`). The new button group sits between the version controls and the right-side utility cluster.

---

## Button States

| Button | When no asset is open | When asset is open |
|--------|----------------------|-------------------|
| ＋ New | Visible, enabled (always) | Visible, enabled |
| Save | Hidden | Visible, enabled |
| ⬡ Besk it | Hidden | Visible, enabled (primary style) |

The `updateButtonState()` function in `asset-save.js` controls Save and Besk visibility — it references the headerbar elements by ID. No logic change required, only DOM relocation.

---

## Sidebar changes

**Settings tab header** (`sidebar-view-header` for `data-view="settings"`):
- The New button was removed from any sidebar location; it now lives in the headerbar.

**Settings tab body** (`sidebar-view-body` for `data-view="settings"`):
- Save and Besk it rows were removed from the sidebar; they now live in the headerbar.
- **Burn** (`#burnAssetBtn`) is located inside the Settings view (within the team/collaborators section at the bottom of the Settings body) — it is a destructive action and must not be one-click accessible from the headerbar.

---

## HTML changes (studio.pug)

### Add to headerbar — after `#assetHistory`, before `.headerbar-actions`

```pug
.headerbar-divider(aria-hidden="true")
.headerbar-doc-actions
  button#newAssetBtn.btn.btn-flat.btn-sm(type="button" aria-label="New asset" title="New asset (Ctrl+N)")
    svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      line(x1="12" y1="5" x2="12" y2="19")
      line(x1="5" y1="12" x2="19" y2="12")
    span New
  button#saveAssetBtn.btn.btn-secondary.btn-sm(hidden aria-label="Save Draft" title="Save Draft (Ctrl+S)")
    //- Same SVG as current #saveAssetBtn in the sidebar (floppy-disk path)
    svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      path(d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z")
      path(d="M17 21v-8H7v8")
      path(d="M7 3v5h8")
    span Save
  button#publishAssetBtn.btn.btn-primary.btn-sm(hidden aria-label="Publish asset" title="Publish (Besk it)")
    //- Same SVG as current #publishAssetBtn in the sidebar (besk-it-logo paths)
    svg.besk-it-logo(width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
      path(d="M12.00,2.00 L21.51,15.09 L6.12,20.09 L6.12,3.91 L21.51,8.91 L12.00,22.00 L2.49,8.91 L17.88,3.91 L17.88,20.09 L2.49,15.09 Z")
      path(d="M12.00,7.50 L16.28,13.39 L9.35,15.64 L9.35,8.36 L16.28,10.61 L12.00,16.50 L7.72,10.61 L14.65,8.36 L14.65,15.64 L7.72,13.39 Z")
    span#publishAssetBtnText Besk it
```

### Remove from Asset tab body
- `.sidebar-action-row.asset-lifecycle-row` (entire row with Save + Burn)
- `.sidebar-action-row.besk-it-row` (entire row with Besk it)
- `#newAssetSidebarBtn` from the sidebar view header

### Move Burn inside Settings
Add `#burnAssetBtn` to the bottom of `.asset-def-body`, after the team panel.

---

## JS changes

### `asset-save.js`
- Update `getElementById` calls: `saveAssetBtn` and `publishAssetBtn` still reference the same IDs — no change needed as long as the IDs are preserved in the new headerbar location. `saveBtnText` now resolves to the `#saveAssetBtnText` span in the headerbar.

### `create-panel.js`
- The New Asset button is wired in `frontend/src/js/engine/scene-graph.js` (via `document.getElementById("newAssetBtn")`). `create-panel.js` does not need to wire it.

### `sidebar.js`
- No action-row show/hide logic is required; the sidebar tabs are Settings, Chat, Outline, Gallery, and Activity.

---

## SCSS changes

### `_headerbar.scss`
Add `.headerbar-divider` and `.headerbar-doc-actions` styles:

```scss
.headerbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-hairline);
  flex-shrink: 0;
  margin: 0 var(--size-1);
}

.headerbar-doc-actions {
  display: flex;
  align-items: center;
  gap: var(--size-1);
  flex-shrink: 0;
}
```

### `_layout.scss` / `_buttons.scss`
Verify `.btn-sm` sizing is appropriate for headerbar (target height ~30px to sit comfortably in the 42px headerbar). Adjust if needed.

---

## What does NOT change

- Burn button behavior and confirmation dialog — only its location moves (Asset tab Settings section).
- Save and Besk show/hide timing — still controlled by `setSavePublishVisible()` in `asset-save.js`.
- Keyboard shortcuts (Ctrl+S, Ctrl+N) — same handlers, same IDs.
- History slider — stays in the headerbar, no position change.
- All other sidebar tabs (Outline, Gallery, Activity) — unchanged.

---

## Files to touch

| File | Change |
|------|--------|
| `frontend/src/pug/studio.pug` | Add headerbar doc-action group; remove sidebar action rows; place Burn inside Settings view |
| `frontend/src/scss/components/_headerbar.scss` | Add `.headerbar-divider`, `.headerbar-doc-actions` |
| `frontend/src/js/engine/scene-graph.js` | Wire `#newAssetBtn` click handler |
| `frontend/src/js/ui/asset-save.js` | No logic change; IDs preserved |
| `frontend/src/js/ui/sidebar.js` | No action-row refs needed |

---

## Out of scope

- Responsive / mobile breakpoints (sidebar collapses, headerbar already handles overflow via `overflow: hidden`)
- Keyboard shortcut changes
- Any changes to Burn's confirmation dialog logic
- Inspector panel

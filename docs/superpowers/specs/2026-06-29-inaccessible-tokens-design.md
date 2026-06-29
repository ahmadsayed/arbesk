# Inaccessible Token Cards in Library

**Date:** 2026-06-29  
**Status:** Approved

## Problem

When `expandTokenToAssets` fails to load a token's IPFS manifest (403, 404, network error, malformed JSON), the token silently disappears from the library. The user has no way to know the token exists on-chain, see what went wrong, or burn it to clean up their wallet.

## Goal

Show any token that fails IPFS expansion as an inaccessible card in the library with a question mark icon, a trimmed token ID as its name, an error tooltip on hover, and a single "Burn Token" context menu action.

## Scope

Three small edits to existing files — no new files.

---

## Data Layer — `asset-library.js`

**Location:** `expandTokenToAssets` catch block, line 272–275.

**Change:** Instead of `return []`, return a single inaccessible sentinel entry:

```js
return [{
  type: "inaccessible",
  tokenId: String(tokenId),
  errorReason: err.message || "Unknown error",
}];
```

The `role` field (`"owner"` or `"editor"`) is stamped onto the entry by the caller in `renderAssetLibrary` (lines 501–510), same as all other entries — no change needed there.

---

## Rendering — `library-grid.js`

**Location:** `createItemElement`, after the existing grid/list branches.

**New branch:** `type === "inaccessible"` renders a card (grid and list modes both):

- **Thumbnail:** question mark SVG icon (new `questionIcon()` helper alongside `defaultIcon()`).
- **Name:** trimmed token ID — first 4 digits + `…` + last 4 digits, e.g. `#1077…8698`. If token ID is ≤ 8 chars, show it in full.
- **Tooltip:** `title` attribute on the root element set to the full `errorReason` string. Native browser tooltip — no extra JS needed.
- **CSS class:** `library-item--inaccessible` added alongside `library-item`. Style: `opacity: 0.55` and `--item-accent: var(--warning-color)` (or equivalent token from the existing SCSS palette). No layout changes.

**Helper — add to `library-items.js`** (shared between grid and context menu):
```js
export function trimTokenId(tokenId) {
  const s = String(tokenId);
  if (s.length <= 8) return `#${s}`;
  return `#${s.slice(0, 4)}…${s.slice(-4)}`;
}
```
Import it in both `library-grid.js` and `library-context-menu.js`.

---

## Context Menu — `library-context-menu.js`

**Location:** the section that builds the menu item list based on item type.

**Change:** For `type === "inaccessible"`, expose exactly one action:

```
Burn Token   (danger=true)
```

This calls the existing `requestBurnCollection` function, passing a synthetic collection object `{ tokenId: item.tokenId, name: trimTokenId(item.tokenId) }`. The existing burn confirmation dialog and transaction flow are reused unchanged.

No other actions (Open, Rename, Delete, Share) appear for inaccessible items.

---

## SCSS

One new rule in the library stylesheet (wherever `.library-item` is defined):

```scss
.library-item--inaccessible {
  opacity: 0.55;

  .library-item-thumbnail {
    background: color-mix(in srgb, var(--warning-color, #f59e0b) 8%, transparent);
  }
}
```

---

## Error Reasons Users Will See (as tooltips)

| Scenario | `errorReason` shown |
|---|---|
| Pinata 403 (wrong account) | `IPFS gateway returned 403 for bafkrei…` |
| CID not found | `IPFS gateway returned 404 for bafkrei…` |
| Network offline | `Failed to fetch` |
| Malformed JSON | `Unexpected token … in JSON` |

---

## What Is Not Changing

- Burn dialog copy, transaction flow, and error handling — unchanged.
- `expandTokenToAssets` success path — unchanged.
- `renderAssetLibrary` section structure — inaccessible cards appear in "My Assets" / "Shared Assets" alongside normal cards, not in a separate section.
- Thumbnail lazy-loading — inaccessible items have no `thumbnailCid`, so the existing lazy-loader skips them automatically.

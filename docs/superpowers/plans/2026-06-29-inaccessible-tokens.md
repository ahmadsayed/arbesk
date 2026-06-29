# Inaccessible Token Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show tokens whose IPFS manifests fail to load as inaccessible cards in the asset library sidebar, giving users a way to see and burn orphaned on-chain tokens.

**Architecture:** Three targeted edits to existing files — `expandTokenToAssets` returns a sentinel entry on failure, `createSection` dispatches to a new `createInaccessibleCard` builder, and `_cards.scss` adds one modifier rule. No new files.

**Tech Stack:** Vanilla JS ES modules, SCSS, Jest/jsdom for unit tests.

## Global Constraints

- No new files — edits only to `asset-library.js`, `library-items.js`, `_cards.scss`, and `asset-library.test.js`.
- `// @ts-nocheck` is already at the top of `asset-library.js` — no JSDoc typing needed for new helpers.
- `burnCollection` is imported from `asset-delete.js`; `showBurnCollectionDialog` is imported from `dialog.js` — both must be lazy-imported inside the card handler (same pattern used by other dialogs in `asset-library.js` which use dynamic `await import`).
- `showToast` is already imported at the top of `asset-library.js`.
- CSS variable for warning: `--bs-warning` (#ffc107) is available via Bootstrap 5 — use it as the fallback hex value; `color-mix` is already used in `_cards.scss`.
- Run `npm run test:frontend` after every task to catch regressions.

---

### Task 1: Add `trimTokenId` to `library-items.js` with a test

**Files:**
- Modify: `frontend/src/js/utils/library-items.js` (append export at end of file)
- Test: `test/frontend/asset-library.test.js` (add describe block before closing)

**Interfaces:**
- Produces: `export function trimTokenId(tokenId: unknown): string`
  - Returns `#<id>` when `String(tokenId).length <= 8`
  - Returns `#<first4>…<last4>` otherwise

- [ ] **Step 1: Write the failing test**

Add this describe block at the end of `test/frontend/asset-library.test.js` (before the final closing newline):

```js
import { trimTokenId } from "../../frontend/src/js/utils/library-items.js";

describe("trimTokenId", () => {
  test("short id is returned with hash prefix", () => {
    expect(trimTokenId("12345678")).toBe("#12345678");
  });

  test("long id is trimmed to first4…last4", () => {
    expect(trimTokenId("107798772824060442692498426158461")).toBe("#1077…8461");
  });

  test("numeric input is converted to string", () => {
    expect(trimTokenId(9)).toBe("#9");
  });

  test("exactly 9 chars triggers trimming", () => {
    expect(trimTokenId("123456789")).toBe("#1234…6789");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-library.test.js --runInBand --silent 2>&1 | tail -20
```

Expected: FAIL — `trimTokenId is not a function` or import error.

- [ ] **Step 3: Implement `trimTokenId`**

Append to `frontend/src/js/utils/library-items.js` (after `formatBytes`):

```js
export function trimTokenId(tokenId) {
  const s = String(tokenId);
  if (s.length <= 8) return `#${s}`;
  return `#${s.slice(0, 4)}…${s.slice(-4)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-library.test.js --runInBand --silent 2>&1 | tail -20
```

Expected: PASS for all `trimTokenId` tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/utils/library-items.js test/frontend/asset-library.test.js
git commit -m "feat: add trimTokenId helper to library-items"
```

---

### Task 2: Return inaccessible sentinel from `expandTokenToAssets` catch

**Files:**
- Modify: `frontend/src/js/ui/asset-library.js` lines 272–275 (the catch block of `expandTokenToAssets`)
- Test: `test/frontend/asset-library.test.js` (add a test inside `describe("renderAssetLibrary")`)

**Interfaces:**
- Consumes: `trimTokenId` from `../utils/library-items.js` (imported at top of task 3 — add the import in this task since it's needed for the card name in createInaccessibleCard; the sentinel itself just stores the raw tokenId string, trimming happens at render time)
- Produces: on IPFS failure, `expandTokenToAssets` returns `[{ type: "inaccessible", tokenId: String(tokenId), errorReason: string }]` instead of `[]`

The `role` field is stamped by `renderAssetLibrary` immediately after `expandTokenToAssets` returns (lines 501–510 of `asset-library.js`) — no change needed there.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("renderAssetLibrary")` block in `test/frontend/asset-library.test.js`, after the last test:

```js
test("renders inaccessible card for token whose IPFS load fails", async () => {
  const { initAssetLibrary, renderAssetLibrary } = await loadModule();
  initAssetLibrary();

  // Token 3 has no collection manifest → getFromRemoteIPFS rejects
  _tokenURIs[3] = "bafyBroken";
  // bafyBroken is not in _manifests, so the mock rejects with "Unknown CID bafyBroken"

  await renderAssetLibrary(["3"], []);

  const inaccessible = document.querySelector(".asset-card--inaccessible");
  expect(inaccessible).not.toBeNull();
  // Should NOT render as a normal card
  expect(document.querySelector(".asset-card:not(.asset-card--inaccessible)")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-library.test.js --runInBand --silent 2>&1 | tail -20
```

Expected: FAIL — `.asset-card--inaccessible` is null (nothing renders for the failing token today).

- [ ] **Step 3: Change the catch block in `expandTokenToAssets`**

In `frontend/src/js/ui/asset-library.js`, replace lines 272–275:

```js
  } catch (err) {
    console.warn("[ASSET-LIBRARY] Failed to expand token", tokenId, err);
    return [];
  }
```

With:

```js
  } catch (err) {
    console.warn("[ASSET-LIBRARY] Failed to expand token", tokenId, err);
    return [
      {
        type: "inaccessible",
        tokenId: String(tokenId),
        errorReason: err.message || "Unknown error",
      },
    ];
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-library.test.js --runInBand --silent 2>&1 | tail -20
```

Expected: FAIL — `.asset-card--inaccessible` still null because `createSection` hasn't been updated yet. This is expected at this stage; the test will pass after Task 3.

- [ ] **Step 5: Commit the data-layer change**

```bash
git add frontend/src/js/ui/asset-library.js test/frontend/asset-library.test.js
git commit -m "feat: expandTokenToAssets returns inaccessible sentinel on IPFS failure"
```

---

### Task 3: Render inaccessible card in `createSection` + add SCSS

**Files:**
- Modify: `frontend/src/js/ui/asset-library.js` — import `trimTokenId`, add `createInaccessibleCard`, update `createSection` dispatch
- Modify: `frontend/src/scss/components/_cards.scss` — add `.asset-card--inaccessible` rule at the end of the file

**Interfaces:**
- Consumes: `trimTokenId` from `../utils/library-items.js` (Task 1)
- Consumes: inaccessible sentinel `{ type, tokenId, errorReason, role }` from `expandTokenToAssets` (Task 2)
- Produces: `.asset-card.asset-card--inaccessible` DOM element with `title` attribute (tooltip), question mark SVG, trimmed token ID, role badge, and a Burn Token button wired to the existing burn flow

- [ ] **Step 1: Run failing test from Task 2**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-library.test.js --runInBand --silent 2>&1 | tail -20
```

Confirm it still fails with `.asset-card--inaccessible` being null.

- [ ] **Step 2: Add `trimTokenId` import to `asset-library.js`**

At the top of `frontend/src/js/ui/asset-library.js`, after the existing imports, add:

```js
import { trimTokenId } from "../utils/library-items.js";
```

- [ ] **Step 3: Update `createSection` to dispatch inaccessible entries**

In `frontend/src/js/ui/asset-library.js`, replace line 580:

```js
  for (const entry of entries) list.appendChild(createAssetCard(entry));
```

With:

```js
  for (const entry of entries) {
    list.appendChild(
      entry.type === "inaccessible"
        ? createInaccessibleCard(entry)
        : createAssetCard(entry)
    );
  }
```

- [ ] **Step 4: Add `createInaccessibleCard` function**

Add this function immediately before `createAssetCard` in `asset-library.js` (around line 585, before `function createAssetCard`):

```js
function createInaccessibleCard(entry) {
  const item = document.createElement("div");
  item.className = "asset-card asset-card--inaccessible";
  item.dataset.tokenId = entry.tokenId;
  item.title = entry.errorReason || "Unknown error";
  item.setAttribute("role", "group");
  item.setAttribute("aria-label", `Inaccessible token ${trimTokenId(entry.tokenId)}`);

  const thumbnailEl = document.createElement("div");
  thumbnailEl.className = "asset-card-thumbnail asset-card-thumbnail-empty";
  thumbnailEl.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`;

  const nameEl = document.createElement("div");
  nameEl.className = "asset-card-name";
  nameEl.textContent = trimTokenId(entry.tokenId);

  const badge = document.createElement("span");
  badge.className = `asset-card-badge ${
    entry.role === "owner" ? "badge-owner" : "badge-editor"
  }`;
  badge.textContent = entry.role === "owner" ? "Owner" : "Editor";

  const meta = document.createElement("div");
  meta.className = "asset-card-meta";
  meta.appendChild(badge);

  const burnBtn = document.createElement("button");
  burnBtn.className = "btn btn-outline btn-danger btn-sm";
  burnBtn.textContent = "Burn Token";
  burnBtn.title = "Burn this token to remove it from your wallet";
  burnBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const { showBurnCollectionDialog } = await import("./dialog.js");
      const { burnCollection } = await import("../services/asset-delete.js");
      const label = trimTokenId(entry.tokenId);
      const confirmed = await showBurnCollectionDialog(label);
      if (confirmed !== "burn") return;
      await burnCollection(entry.tokenId);
      showToast({ type: "success", title: "Token burned", message: `Token ${label} removed.` });
      item.remove();
    } catch (err) {
      showToast({ type: "error", title: "Burn failed", message: err.message || "Could not burn token." });
    }
  });

  const actions = document.createElement("div");
  actions.className = "asset-card-actions";
  actions.appendChild(burnBtn);

  item.appendChild(thumbnailEl);
  item.appendChild(nameEl);
  item.appendChild(meta);
  item.appendChild(actions);

  return item;
}
```

- [ ] **Step 5: Add SCSS modifier rule**

Append to `frontend/src/scss/components/_cards.scss` (after the `.asset-card-reload` block):

```scss
.asset-card--inaccessible {
  opacity: 0.55;

  .asset-card-thumbnail {
    background: color-mix(in srgb, var(--bs-warning, #ffc107) 8%, var(--card-bg));
    color: var(--bs-warning, #ffc107);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/asset-library.test.js --runInBand --silent 2>&1 | tail -20
```

Expected: ALL PASS — including the inaccessible card test from Task 2.

- [ ] **Step 7: Run the full frontend test suite**

```bash
npm run test:frontend 2>&1 | tail -30
```

Expected: All tests pass with no new failures.

- [ ] **Step 8: Build the frontend**

```bash
npm run build:frontend 2>&1 | tail -10
```

Expected: Build completes without errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/js/ui/asset-library.js frontend/src/scss/components/_cards.scss
git commit -m "feat: render inaccessible token cards with Burn Token action"
```

---

## Manual Verification (not automated)

After all tasks are committed, open the Studio with a wallet that has orphaned tokens (e.g., tokens whose collection manifests return 403 from Pinata):

1. Connect wallet → Library sidebar opens.
2. Orphaned tokens appear as semi-transparent cards with a question mark icon and `#1077…8461`-style names.
3. Hovering the card shows the error reason as a native tooltip.
4. "Burn Token" button → burn confirmation dialog appears with the trimmed token ID as the collection name.
5. Type the trimmed token ID → "Burn Collection" button enables → confirm → toast "Token burned" → card disappears.
6. Normal asset cards are unaffected.

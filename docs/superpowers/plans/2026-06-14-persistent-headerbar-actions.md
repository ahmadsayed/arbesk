# Persistent Headerbar Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Save, Besk it, and New Asset buttons from the Asset sidebar tab into the headerbar so they are visible regardless of which sidebar tab is active.

**Architecture:** All template changes happen in one atomic studio.pug edit (add to headerbar, remove from sidebar, relocate Burn) to avoid a window where `#saveAssetBtn` / `#publishAssetBtn` exist in two places with duplicate IDs. SCSS and JS changes follow separately. No logic changes to `asset-save.js`, `collaborators.js`, or `nesting.js` — all reference elements by IDs that are preserved in the new headerbar location.

**Tech Stack:** Pug (HTML template), SCSS, vanilla ES module JavaScript. Build via `npm run build:frontend`. No automated frontend tests — verification is manual browser smoke-test.

**Spec:** `docs/superpowers/specs/2026-06-14-persistent-headerbar-actions-design.md`

---

## File Map

| File | What changes |
|------|-------------|
| `frontend/src/pug/studio.pug` | Add headerbar doc-actions group; remove sidebar action rows; move Burn to Settings; remove sidebar New button (all one edit) |
| `frontend/src/scss/components/_headerbar.scss` | Add `.headerbar-divider` and `.headerbar-doc-actions` |
| `frontend/src/scss/components/_sidebar.scss` | Remove dead `.sidebar-action-row`, `.asset-lifecycle-row`, `.besk-it-row` blocks |
| `frontend/src/js/engine/scene-graph.js` | Replace `"newAssetSidebarBtn"` with `"newAssetBtn"` in button-wiring array |

**No changes needed in:** `asset-save.js`, `collaborators.js`, `nesting.js` — all reference elements by the same IDs, which are preserved.

---

## Task 1: Restructure studio.pug (all template changes in one edit)

All four sub-changes happen in a single session so no intermediate state has duplicate IDs.

**Files:**
- Modify: `frontend/src/pug/studio.pug`

- [ ] **Step 1: Add the doc-actions group to the headerbar**

  In `frontend/src/pug/studio.pug`, find this exact block (around line 36):

  ```pug
        #assetHistory.history(hidden)
          span.history-label Version
          .history-slider-wrap
            input#historySlider.history-slider(type="range" min="0" max="0" step="1" value="0" aria-label="Asset version" aria-describedby="historyDetailPopover" title="Scrub asset versions")
            #historyDetailPopover.history-detail(hidden)
          span#historyVersionBadge.version-badge v1

        .headerbar-actions
  ```

  Replace it with (inserting `.headerbar-divider` and `.headerbar-doc-actions` between `#assetHistory` and `.headerbar-actions`):

  ```pug
        #assetHistory.history(hidden)
          span.history-label Version
          .history-slider-wrap
            input#historySlider.history-slider(type="range" min="0" max="0" step="1" value="0" aria-label="Asset version" aria-describedby="historyDetailPopover" title="Scrub asset versions")
            #historyDetailPopover.history-detail(hidden)
          span#historyVersionBadge.version-badge v1

        .headerbar-divider(aria-hidden="true")
        .headerbar-doc-actions
          button#newAssetBtn.btn.btn-secondary.btn-sm(type="button" aria-label="New asset" title="New asset (Ctrl+N)")
            svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
              line(x1="12" y1="5" x2="12" y2="19")
              line(x1="5" y1="12" x2="19" y2="12")
            span New
          button#saveAssetBtn.btn.btn-secondary.btn-sm(hidden type="button" aria-label="Save Draft" title="Save Draft (Ctrl+S)")
            svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
              path(d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z")
              path(d="M17 21v-8H7v8")
              path(d="M7 3v5h8")
            span Save
          button#publishAssetBtn.btn.btn-primary.btn-sm(hidden type="button" aria-label="Publish asset" title="Publish (Besk it) this asset")
            svg.besk-it-logo(width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
              path(d="M12.00,2.00 L21.51,15.09 L6.12,20.09 L6.12,3.91 L21.51,8.91 L12.00,22.00 L2.49,8.91 L17.88,3.91 L17.88,20.09 L2.49,15.09 Z")
              path(d="M12.00,7.50 L16.28,13.39 L9.35,15.64 L9.35,8.36 L16.28,10.61 L12.00,16.50 L7.72,10.61 L14.65,8.36 L14.65,15.64 L7.72,13.39 Z")
            span#publishAssetBtnText Besk it

        .headerbar-actions
  ```

  **Critical:** `#saveAssetBtn`, `#publishAssetBtn`, `#publishAssetBtnText` must keep these exact IDs — `asset-save.js` (lines 37–40) and `nesting.js` (line 198) query them by ID at module load time. The `hidden` attribute on Save and Besk is correct — `asset-save.js:updateButtonState()` removes it once a wallet is connected and an asset is open.

- [ ] **Step 2: Remove `#newAssetSidebarBtn` from the Asset tab header**

  Find this block in the `.sidebar-view(data-view="create")` header:

  ```pug
              .sidebar-view-header
                h3 Asset
                button#newAssetSidebarBtn.sidebar-header-action(type="button" aria-label="New asset" title="New asset (Ctrl+N)")
                  svg(width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                    line(x1="12" y1="5" x2="12" y2="19")
                    line(x1="5" y1="12" x2="19" y2="12")
  ```

  Replace with just the heading:

  ```pug
              .sidebar-view-header
                h3 Asset
  ```

- [ ] **Step 3: Remove `.sidebar-action-row.asset-lifecycle-row` from the Asset tab body**

  Find and delete this entire block (Save + Burn sidebar row):

  ```pug
                .sidebar-action-row.asset-lifecycle-row
                  button#saveAssetBtn.btn.btn-secondary(hidden aria-label="Save Draft" title="Save Draft (Ctrl+S)")
                    svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                      path(d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z")
                      path(d="M17 21v-8H7v8")
                      path(d="M7 3v5h8")
                    span Save
                  button#burnAssetBtn.btn.btn-outline.btn-danger(hidden aria-label="Burn asset" title="Burn (delete) this token")
                    svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                      path(d="M3 6h18")
                      path(d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6")
                      path(d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")
                    span Burn
  ```

  Delete all 13 lines.

- [ ] **Step 4: Remove `.sidebar-action-row.besk-it-row` from the Asset tab body**

  Find and delete this entire block (Besk it sidebar row):

  ```pug
                .sidebar-action-row.besk-it-row
                  button#publishAssetBtn.btn.btn-primary(hidden aria-label="Publish asset" title="Publish (Besk it) this asset")
                    svg.besk-it-logo(width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                      path(d="M12.00,2.00 L21.51,15.09 L6.12,20.09 L6.12,3.91 L21.51,8.91 L12.00,22.00 L2.49,8.91 L17.88,3.91 L17.88,20.09 L2.49,15.09 Z")
                      path(d="M12.00,7.50 L16.28,13.39 L9.35,15.64 L9.35,8.36 L16.28,10.61 L12.00,16.50 L7.72,10.61 L14.65,8.36 L14.65,15.64 L7.72,13.39 Z")
                    span#publishAssetBtnText Besk it
  ```

  Delete all 7 lines.

- [ ] **Step 5: Move `#burnAssetBtn` into the Settings collapsible**

  Inside `.asset-def-body(hidden)`, find the end of `#teamPanel` (the last line of that block is `button#teamAddBtn.btn.btn-secondary Add`). Add the Burn button immediately after, as a sibling of `#teamPanel`:

  ```pug
                      button#burnAssetBtn.btn.btn-outline.btn-danger.btn-sm(hidden type="button" aria-label="Burn asset" title="Burn (delete) this token" style="margin-top: var(--size-3); width: 100%;")
                        svg(width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true")
                          path(d="M3 6h18")
                          path(d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6")
                          path(d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")
                        span Burn
  ```

  **Critical:** `#burnAssetBtn` must keep this exact ID — `collaborators.js` (lines 44, 50, 65, 72, 77, 285) wires its click handler and show/hide logic to this ID. The `hidden` attribute is correct — `collaborators.js:updateBurnButton()` removes it when the user owns the active token.

---

## Task 2: Add SCSS for headerbar doc-actions

**Files:**
- Modify: `frontend/src/scss/components/_headerbar.scss` (append at end of file)

- [ ] **Step 1: Append two new rule blocks at the end of `_headerbar.scss`**

  ```scss
  // Doc-action button group (New / Save / Besk it) — always visible in headerbar
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

---

## Task 3: Remove dead SCSS from _sidebar.scss

**Files:**
- Modify: `frontend/src/scss/components/_sidebar.scss` (around lines 208–241)

- [ ] **Step 1: Delete the three dead style blocks**

  Find and remove these three blocks entirely (they only styled the now-removed sidebar rows):

  ```scss
  // Primary action row at the top of a sidebar view (e.g. New Asset in Asset view)
  .sidebar-action-row {
    padding: var(--size-2) 0;
  }

  // Asset lifecycle buttons (Save / Burn) in the Asset sidebar view
  .asset-lifecycle-row {
    display: flex;
    gap: var(--size-2);
    padding: 0 0 var(--size-2);

    .btn {
      flex: 1;
      justify-content: center;
      padding: var(--size-2) var(--size-1);
      font-size: var(--font-size-0);

      svg {
        width: 14px;
        height: 14px;
      }
    }
  }

  // Primary publish action on its own full-width row.
  .besk-it-row {
    padding: 0 0 var(--size-2);

    .btn {
      width: 100%;
      justify-content: center;
      font-size: var(--font-size-2);
    }
  }
  ```

  Delete all 33 lines. The `.sidebar-toggle` block that follows immediately after should remain untouched.

---

## Task 4: Update New Asset button wiring in scene-graph.js

**Files:**
- Modify: `frontend/src/js/engine/scene-graph.js` (line 1289)

- [ ] **Step 1: Find and update the button-ID array**

  Search for `newAssetSidebarBtn` in `scene-graph.js` (only one occurrence, at line 1289):

  ```js
      ["newAssetTopBtn", "newAssetSidebarBtn"].forEach(function (id) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener("click", startNewAsset);
      });
  ```

  Replace `"newAssetSidebarBtn"` with `"newAssetBtn"`:

  ```js
      ["newAssetTopBtn", "newAssetBtn"].forEach(function (id) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener("click", startNewAsset);
      });
  ```

  `"newAssetTopBtn"` is a pre-existing legacy no-op (the element doesn't exist in the HTML) — the `if (btn)` null-check makes it harmless; leave it as-is.

---

## Task 5: Build, smoke test, and commit

- [ ] **Step 1: Build the frontend**

  ```bash
  npm run build:frontend
  ```

  Expected: exits 0, no errors. Output files written to `frontend/dist/`.

- [ ] **Step 2: Start the server**

  ```bash
  npm start
  ```

  Open `http://localhost:9090` in a browser.

- [ ] **Step 3: Verify — no asset open**

  - Headerbar shows `[New]` between the history area and the theme/network/wallet cluster.
  - `[Save]` and `[Besk it]` are **not** visible.
  - Asset tab body has no Save/Besk/Burn rows — only the Settings collapsible and the chat area.
  - Settings is collapsed by default; expanding it shows the provider, quality, team, and Burn button at the bottom.

- [ ] **Step 4: Verify — the target workflow**

  1. Connect wallet.
  2. Open or generate an asset.
  3. `[Save]` and `[Besk it]` appear in the headerbar next to `[New]`.
  4. Switch to **Gallery** tab — headerbar buttons remain visible.
  5. Click an asset in the gallery to add it to the scene (or just confirm the buttons stay put).
  6. Click **Save** from the headerbar — save completes without any tab switching.
  7. Click **Besk it** from the headerbar — publish flow triggers normally.

- [ ] **Step 5: Verify — Burn is in Settings**

  1. Open an asset that your wallet owns.
  2. In Asset tab → expand Settings (click the chevron).
  3. **Burn** button is visible at the bottom of the Settings panel.
  4. Click Burn — the confirmation dialog appears; behavior is unchanged.

- [ ] **Step 6: Verify — keyboard shortcuts**

  - `Ctrl+N` — starts a new asset (wired via the `keydown` handler in `scene-graph.js`, independent of button ID).
  - `Ctrl+S` — saves (wired directly to `saveBtn.click()` in `asset-save.js`, same element reference).

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/src/pug/studio.pug \
          frontend/src/scss/components/_headerbar.scss \
          frontend/src/scss/components/_sidebar.scss \
          frontend/src/js/engine/scene-graph.js
  git commit -m "$(cat <<'EOF'
  feat(ui): move Save/Besk/New to headerbar, Burn to Settings

  Eliminates tab-switching friction: Save, Besk it, and New are now
  always visible in the headerbar regardless of which sidebar tab is
  active. Burn relocates to the Settings collapsible in the Asset tab.

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

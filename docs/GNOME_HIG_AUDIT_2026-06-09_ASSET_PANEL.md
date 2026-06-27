# GNOME HIG & Web 3.0 Audit Report — Asset Inspector Panel

**Date**: 2026-06-09
**Scope**: Asset Settings panel (right inspector) — screenshot provided
**Auditor**: Kimi Code CLI
**Framework**: GNOME HIG (reference) + WCAG 2.1 AA (primary) + Web 3.0 UX conventions

---

## Overall Score: 74/100 — ⚠️ Fair

Several violations need attention, particularly around button hierarchy, form affordances, and touch targets.

| Category | Weight | Score | Rating |
|----------|--------|-------|--------|
| A. Color & Theming | 1.0 | 80/100 | 👍 Good |
| B. Typography | 0.8 | 85/100 | 👍 Good |
| C. Layout & Spacing | 1.0 | 82/100 | 👍 Good |
| D. Buttons & Controls | 1.0 | **58/100** | 🔶 Poor |
| E. Keyboard Navigation | 1.2 | 75/100 | 👍 Good |
| F. Accessibility | 1.2 | **68/100** | ⚠️ Fair |
| G. Forms & Input | 0.8 | **62/100** | ⚠️ Fair |
| H. Dialogs & Modals | 0.8 | 75/100 | 👍 Good |
| I. Responsive Design | 0.8 | 75/100 | 👍 Good |
| J. Empty States & Feedback | 0.6 | 85/100 | 👍 Good |

---

## Critical Violations (must fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | **D. Buttons** | Two primary-weight filled buttons ("+ New Asset" and "Publish") are stacked within 50 px, and the destructive "Burn" button competes visually with the primary action. In GNOME HIG, there should be **one** suggested action per contextual zone; destructive actions must never be more prominent than safe actions. (Fixed: the action row was moved to the headerbar; Publish is now labeled **Besk it**, and Burn moved to the Library context menu.) | `_buttons.scss`, `frontend/src/pug/studio.pug` | For an **existing** asset, make **Save** the suggested action (`btn-primary`). Make **Publish** (`Besk it`) `btn-secondary` or `btn-outline`. Demote **Burn** to `btn-outline btn-danger` or `btn-flat btn-danger` — keep the red text but remove the filled background so it does not draw the eye first. |
| 2 | **G. Forms** | The wallet address input under "Collaborators" has **no persistent `<label>`** — it relies solely on the placeholder `"0x... wallet address"`. Placeholders disappear on input, violating WCAG 2.1 AA Label in Name and GNOME HIG persistent-label rules. (Fixed: collaborator management moved to the Library; the new `frontend/src/js/ui/collaborators-panel.js` input uses `aria-label="Wallet address"` and is under a visible "Collaborators" header.) | `_forms.scss`, `frontend/src/pug/studio.pug` | Add a visible `.form-label` above the input (e.g., "Wallet Address") and keep the placeholder as a format hint. Alternatively, use `aria-label="Wallet address"` if space is truly constrained (but visible label is preferred). |
| 3 | **D. Buttons** | The **Add** collaborator button uses `btn-sm` (28 px min-height), which is below the 36 px general touch-target minimum. At this size it is acceptable only for dense toolbars, not form rows. (Fixed: the new Library collaborator panel uses `btn btn-secondary` for the Add button.) | `_buttons.scss`, `frontend/src/js/ui/collaborators-panel.js` | Change the collaborator **Add** button to the default `btn` size (36 px min-height). If horizontal space is tight, use a flex row with `flex-wrap: wrap` on narrow viewports rather than shrinking the button. |
| 4 | **G. Forms** | The **Asset Name** field shows `"world"` as plain text on the panel background, not inside a visible input box. Users cannot tell it is editable without clicking it. If it is `contenteditable`, it lacks an input affordance; if read-only, it is misplaced under SETTINGS. (Fixed: the asset name is now `#assetNameDisplay.form-input` in `frontend/src/pug/studio.pug`.) | `_forms.scss`, `frontend/src/pug/studio.pug` | Render the asset name inside a `.form-input` (or a bordered `contenteditable` region with `--view-bg` and `--border-color`) so it looks editable. Add a visible focus ring on `:focus-visible`. |

---

## Warnings (should fix)

| # | Category | Finding | File(s) | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | **A. Color** | Border color (`#cdb89a` on `#faf6f2` ≈ 1.5:1) is extremely faint. Surface separation is hard to see, especially for the settings card edges and input borders. | `_tokens.scss` | Darken `--border-light` to at least `#b89a7a` (already defined in tokens but not used as the default border). The codebase checklist already notes this was darkened in a prior pass — verify it is applied to `--border-color`. |
| 2 | **A. Color** | Focus ring (`--accent-bg` `#c19a6b` on `--view-bg` `#f0e6d8` ≈ 2.2:1) fails the 3:1 contrast requirement for UI components. Keyboard users may not see focus on light inputs. | `_tokens.scss`, `_buttons.scss` | Add a 2 px offset to the focus outline (already present ✅) and consider a darker gold (`#a07848`) or a `color-mix` with `currentColor` for the ring itself. |
| 3 | **F. A11y** | The **SETTINGS** collapsible section uses a chevron/checkmark icon but has no `aria-expanded` state and no `aria-controls` linking it to the content pane. Screen readers cannot tell it is expandable. | studio Pug, `sidebar.js` | Add `aria-expanded="true|false"` to the SETTINGS header button and `aria-controls="settings-panel"` to the content container. |
| 4 | **G. Forms** | No inline validation feedback is visible for the wallet address field (no checksum indicator, no "invalid address" message, no `.is-invalid` styling). In a Web3 context, address typos are catastrophic. (Partially fixed: `frontend/src/js/services/team.js` validates the address format in `_normalizeAddress`, but no inline `.is-invalid` styling is wired yet.) | `_forms.scss`, `frontend/src/js/services/team.js`, `frontend/src/js/ui/collaborators-panel.js` | Add real-time validation: on blur, check `ethers.utils.isAddress()` (or equivalent). If invalid, add `.is-invalid` to the input and show a `.form-error` message. If valid, optionally show a green checkmark or resolved ENS name. |

---

## Suggestions (nice to have)

| # | Category | Finding | Recommendation |
|---|----------|---------|----------------|
| 1 | **Web3 UX** | Wallet input lacks conveniences common in Web3 apps: no paste button, no ENS reverse resolution, no "Use my address" shortcut. | Add a small paste-icon button inside the input (right side) and, on valid 0x input, attempt ENS reverse resolution to display a friendly name (e.g., `vitalik.eth`). |
| 2 | **Web3 UX** | Quality Tier shows a price ("0.75 USDC") but no gas-cost estimate or chain indicator. For a true Web3-native feel, consider adding a small "≈ $0.75 + gas" micro-copy or a network badge. | Add a `form-help` line under Quality Tier: *"Estimated total includes gas on the connected network."* |
| 3 | **D. Buttons** | The "+ New Asset" button is full-width primary even when an asset is already open. This encourages abandoning current work. (Fixed: New, Save, and Publish/Besk it actions were moved to the headerbar; New uses `btn btn-secondary`.) | Consider hiding or demoting "+ New Asset" to `btn-outline` when an asset is loaded, or move it to the header bar / sidebar so the inspector is focused on the current asset lifecycle. |
| 4 | **J. Feedback** | "No collaborators yet." is good, but there is no call-to-action or explanation of what a collaborator can do. | Add a one-line micro-copy: *"Editors can move and parametrize child nodes. Admins can publish and burn."* |

---

## What's Already Excellent

1. **Warm, consistent token palette** — The Arabesque brown/gold system is cohesive, on-brand, and achieves excellent body-text contrast (~13:1 in light mode).
2. **Native `<select>` dropdowns** — Using the browser's native select for "Generation Provider" and "Quality Tier" is the correct call for accessibility, mobile OS theming, and keyboard navigation.
3. **Clear empty state** — "No collaborators yet." + the **OWNER** badge gives immediate context about on-chain ownership without clutter.
4. **Help text pattern** — "Higher tiers produce better quality meshes." is exactly the right use of `.form-help`: small, dim, and explanatory.
5. **System font stack** — `system-ui` first means the UI feels native on every platform, matching GNOME's philosophy of respecting the host environment.

---

## GNOME HIG Principles Scoring

| Principle | Adherence | Notes |
|-----------|-----------|-------|
| Simplicity & clarity | 6/10 | Button hierarchy is backwards; Asset Name affordance is unclear. |
| Keyboard accessibility | 7/10 | Native selects help, but no shortcut discoverability on this panel. |
| Consistency | 7/10 | Token system is solid; button variant usage breaks down in this panel. |
| Discoverability | 6/10 | Wallet input has no visible label; no indication of what "Editor" role means. |
| Direct manipulation | 7/10 | Dropdowns work well, but asset name feels static rather than editable. |
| Responsive feedback | 6/10 | No visible validation states for the most critical field (wallet address). |
| Forgiving | 5/10 | **Burn** is visually prominent and irreversible — easy to misclick. |
| Minimal chrome | 8/10 | Clean panel with good spacing; no unnecessary decoration. |

---

## Web 3.0 Expert Notes

| Area | Assessment |
|------|------------|
| **Wallet input UX** | Placeholder-only labeling is dangerous in Web3. Users paste 42-character hex strings; without a label or validation, mistakes are easy and costly. |
| **Ownership transparency** | The **OWNER** badge is excellent — surfacing on-chain ownership in the UI builds trust. |
| **Pricing clarity** | "Basic — 0.75 USDC" is clear, but lacks network context (is this mainnet? testnet? who pays gas?). |
| **Burn prominence** | Making **Burn** a filled red button in the main action row is an anti-pattern. In Web3, burning is usually buried under an overflow menu or requires a second confirmation step. Consider moving it to a `⋯` menu. (Fixed: Burn was moved out of the inspector into the Library context menu and a confirmation dialog.) |
| **Save vs. Publish semantics** | The distinction between Save (off-chain/IPFS draft) and Publish (on-chain mint) is core to the Arbesk architecture, but the UI does not reinforce this mental model. A small icon (💾 vs. ⛓️) or micro-copy could help. (Subsequently addressed by labeling the publish action **"Besk it"** with a custom icon in the headerbar.) |

---

## Bottom Line

The Asset Inspector panel is **visually polished and on-brand**, but it suffers from **action-hierarchy confusion** and **form-label deficiencies** that drop it into the "Fair" range. The fastest wins:

1. **Restyle the action row**: `Save` = primary, `Publish` (`Besk it`) = secondary, `Burn` = flat/outline danger (now in the Library context menu).
2. **Fix the two unlabeled inputs**: Add a visible label to the wallet field and a bordered affordance to Asset Name.
3. **Bump the Add button to 36 px** minimum.

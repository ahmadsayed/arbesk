# Phase 2 — Library-First Layout — Design

**Date:** 2026-10-04 · **Roadmap:** `2026-10-04-ui-refresh-roadmap.md` · **Status:** approved in brainstorm
**Prerequisites:** Phase 1 merged, and the CAD frontend plan (`docs/superpowers/plans/2026-10-04-cad-frontend-integration.md`)
merged. That plan edits `create-panel.ts` and `studio-sidebar.pug`, which this phase restructures.

## 1. Goal

Make Arbesk read as an **asset repository with a viewer**, not an AI generator:

- the app lands in the Library;
- the header belongs to the open asset;
- creation (Upload / AI / CAD / Empty) lives behind one **New ▾** menu;
- account and network move out of the spotlight;
- the Studio rail becomes **Outline · Assets · Create · Activity**.

## 2. Non-goals

- Info readouts (mm, triangles, print-ready): Phase 3.
- Version timeline: Phase 4.
- View/Edit mode: Phase 5.
- Turning Create into a drawer. Rejected for now; it can be revisited after Phase 5.
- Changes to the chat panel's internals.
- Mobile.

## 3. Routing — `app/router.ts`, `app/initial-view.ts`

- `/` and unknown paths resolve to **library** (currently studio). `initial-view.ts` mirrors
  this: `data-initial-view="studio"` only when the path starts with `/studio`.
- Unchanged: `/studio`, `/studio?asset=…`, `/studio/<base58>`, `/library/<base58>`, and the
  profile-scoping rewrite.
- **Signed-out Library gate** (`#libraryGate`) actions: **Sign in** (primary, existing
  `#libraryConnectBtn`) and **Open Studio** (secondary, a link to `/studio`).
- **Server:** unchanged. `/` serves the marketing `index.html`, and the SPA fallback in
  `src/index.ts` serves `app.html` only for `/studio*` and `/library*`. So "lands in Library"
  means the **entry links into the app** point at `/library`, and the client router's
  fallback for unrecognised in-app paths becomes library.
- **Marketing page (`pug/index.pug`) entry links:**
  - nav "Open Studio" (`/studio`) → **"Open app"** (`/library`);
  - nav "Log in" `/studio?login=1` → `/library?login=1`;
  - hero primary CTA "Open Studio" → **"Open Library"** (`/library`);
  - the secondary "Upload a model" (`/library`) is unchanged.
- **`?login=1` deep link:** the handler in `app-init.ts` must work on `/library` as well as `/studio`.

## 4. Header bar — `pug/includes/header.pug`, `_headerbar.scss`

Order, left to right:

```
[logo] [Library | Studio] [New ▾]   <asset name> <v12 · draft>   …   [Save] [Besk it] (• Testnet) [◐] [avatar]
```

- **Asset name + meta:** `#assetStatusName` stays. `#assetStatusMeta` shows `v<N> · <status>` in
  `--font-mono` with tabular figures, and the hint text "Create or open an asset" when nothing is open.
- **Save** (secondary) and **Besk it** (the only filled-accent button in the header). Download
  stays an icon button next to them.
- `#newAssetBtn` is replaced by **`#newMenuBtn`** (§5). `Ctrl+N` keeps creating an empty asset.
- `#headerbarNetworkSelect` and `#connectWalletBtn`/`#disconnectWalletBtn` leave the header bar.
  They're replaced by the status dot (§6.2) and the avatar button (§6.1).
- **[◐]** is the Phase 1 theme menu (`#themeMenuBtn`, icon-only), kept in the header for signed-in and signed-out users alike.
- On widths under 1280px, the asset meta truncates before any button does.

## 5. New ▾ menu — `ui/new-menu.ts` (new), `header.pug`

WAI-ARIA **menu button** pattern, using the `ui/menu-button.ts` helper created in Phase 1.

| Item | Action | Visibility |
|---|---|---|
| Upload model… `Ctrl+O` | Opens the existing file input / drop flow (same handler as the viewport drop zone and `#libraryUploadInput`); the result opens in Studio as a draft | always |
| Generate with AI | `switchView("chat")` (the Create tab); selects the last-used non-CAD provider; focuses `#promptInput` | always |
| Parametric CAD | `switchView("chat")`; sets `#providerSelect` to `cad`; focuses `#promptInput` | only when the backend config reports `cadGeneration` on (same flag the CAD plan uses to hide the option) |
| — separator — | | |
| Empty asset `Ctrl+N` | Existing new-asset handler (`scene-graph.ts` Ctrl+N path) | always |

- From the Library view, every item first navigates to `/studio` and then acts.
- `Ctrl+O` is new. It calls `preventDefault` only when the app has focus and no text field is focused.

## 6. Account and network

### 6.1 Avatar menu — `header.pug`, `ui/header-wallet-button.ts`, `wallet-popover.pug`

- **Signed in:** a 28px round **avatar button** (an identicon generated from the address; no
  external service). It opens the existing `walletPopover`, which gains:
  - the address with copy (existing);
  - a **Network** section containing the select moved from the header
    (`#headerbarNetworkSelect` keeps its id and behaviour; hidden for CDP accounts as today);
  - **Log out** (existing).
- **Signed out:** the slot shows a quiet secondary **Sign in** button (`#connectWalletBtn`
  keeps its id; text "Sign in"; sans font; not filled).
- The popover follows the dialog-or-menu semantics it already uses: Esc closes it and focus returns to the avatar.

### 6.2 Network status dot — `header.pug`, `ui/testnet-banner.ts`

- Shown **only** when the active chain is not a mainnet. It shows a dot plus a visible text label
  (`Testnet` or `Local`) in `--dim-fg` (colour is not the only cue, WCAG 1.4.1), with
  `title` and `aria-label` giving the full chain name ("Base Sepolia Testnet").
- Clicking it opens the avatar menu scrolled to Network.
- The existing `#testnetBanner` stays and remains the authoritative warning. Its colours come from
  `--warning` (Phase 1).

## 7. Studio rail — `studio-sidebar.pug`, `ui/sidebar.ts`

| Before | After |
|---|---|
| AI Generation (Ctrl+1, default) | **Outline** (Ctrl+1, **default**) |
| Settings (Ctrl+2) | **Assets** (Ctrl+2): the former Gallery, `data-view="library"` kept |
| Outline (Ctrl+3) | **Create** (Ctrl+3): the existing chat view, `data-view="chat"`, label "Create" |
| Gallery (Ctrl+4) | **Activity** (Ctrl+4) |
| Activity (Ctrl+5) | — |

- `VIEWS = ["outline", "library", "chat", "ledger"]`. The stored last-view key: value
  `"settings"` (or anything unknown) migrates to `"outline"`.
- The shortcut range becomes Ctrl+1–4. Ctrl+5 is no longer intercepted (the browser default applies).
- Keyboard help (`keyboard-help.ts`) and tooltips are updated.

### 7.1 Gallery → "Assets" (kept; amended 2026-10-04 during planning)

The Studio Gallery is the **picker for placing assets into the open scene**: its cards carry
**Add to Scene** and drag-to-viewport/outliner, and Outline's **+ Add child asset** opens it
(`outliner.ts` `onAddChild`). It is therefore **kept**, not removed. Only its framing changes:

- Rail label and tooltip: "Assets (Ctrl+2)". View header `h3`: "Assets". A one-line hint
  under the header in `--dim-fg`: "Add to Scene or drag into the viewport to place an asset."
- The `data-view="library"` attribute and the `#assetLibraryBody`, `#galleryConnectBtn` and
  `#galleryVisitorBadge` ids are **unchanged**, so `asset-library.ts`, `outliner.ts` and the E2E
  selector `gallerySwitcherBtn` keep working.
- The gallery's signed-out empty state stays. Its sign-in button follows the Phase 1/2 button
  styling (secondary, sentence case "Sign in").
- Browsing and organising collections stays on the **Library page**. The Assets tab is for placement only.

### 7.2 Settings → Properties "Asset" section — `studio-main.pug`, `_inspector.scss`

- New first inspector section **Asset** (open by default), containing the former Settings
  content unchanged in behaviour and ids: `#assetNameDisplay`, `#collectionSelect`, `#tierSelect`
  with `#tierHelp`, and `#teamPanel`.
- It's visible whenever an asset is open or a draft exists, and hidden in the "No asset open" state.

## 8. Testing

**Unit (`test/frontend/`):**
- New `router-default.test.js`: unrecognised in-app paths fall back to library; `/studio*` → studio;
  `/library*` → library; `initial-view` parity; `?login=1` opens sign-in on both views.
- New `new-menu.test.js`: menu-button ARIA and keyboard; each item's action; CAD item hidden when the flag is off.
- New `sidebar-views.test.js`: VIEWS order, Ctrl+1–4, stored-view migration (`settings` → `outline`).
- Update: `header-wallet-button.test.js` (avatar / sign-in), `asset-chrome.test.js` (`newMenuBtn`),
  `create-panel-generate.test.js` and `create-panel-followups.test.js` (if they assert the default
  view), `deployment-integrity.test.js` and `library-build.test.js` (if they list removed ids).

**E2E:**
- Update `e2e/helpers/studio-selectors.mjs` first (single source of selectors).
- Then update specs 06, 07, 08, 20, 22, 23, 24 and 25 for:
  - New ▾ instead of `#newAssetBtn`;
  - the avatar menu instead of the header wallet buttons;
  - the network select inside the avatar menu;
  - the gallery tab is labelled "Assets" (selector unchanged);
  - Settings fields under Properties → Asset.
- Note: E2E reuses any backend on `:9090`. Run against a fresh dev stack (see project memory on stale backends).

**Visual:** Playwright screenshots of the header (signed out / signed in / testnet), the New ▾ menu
open, the avatar menu open, and the Studio rail, in both themes at 1440×900.

## 9. Risks

- **E2E churn** is the main cost. Centralising selectors in `studio-selectors.mjs` before touching specs keeps it mechanical.
- **CAD plan collision:** if this phase starts before the CAD work merges, rebase conflicts in
  `create-panel.ts` and `studio-sidebar.pug` are likely. Section 1's prerequisite exists for this reason.
- **Muscle memory:** Ctrl+1 now opens Outline instead of AI, and Ctrl+3 opens Create. Keyboard help and the release notes call this out.

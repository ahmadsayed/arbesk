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
- the Studio rail becomes **Outline · Create · Activity**.

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
| Settings (Ctrl+2) | **Create** (Ctrl+2): the existing chat view, `data-view="chat"`, label "Create" |
| Outline (Ctrl+3) | **Activity** (Ctrl+3) |
| Gallery (Ctrl+4) | removed |
| Activity (Ctrl+5) | — |

- `VIEWS = ["outline", "chat", "ledger"]`. The stored last-view key: values `"settings"` and
  `"library"` (or anything unknown) migrate to `"outline"`.
- The shortcut range becomes Ctrl+1–3. Ctrl+4 and Ctrl+5 are no longer intercepted (the browser
  default applies).
- Keyboard help (`keyboard-help.ts`) and tooltips are updated.

### 7.1 Gallery removal — `asset-library.ts`, `studio-sidebar.pug`, `app-init.ts`

- Remove the `data-view="library"` sidebar view, `#assetLibraryBody`, `#galleryConnectBtn`
  and `#galleryVisitorBadge`.
- In `asset-library.ts`, delete only the code whose sole consumer is the sidebar gallery DOM
  (rendering into `assetLibraryBody`, card replacement, gallery empty states). Keep and leave
  untouched everything used elsewhere: `openAssetByTokenId`, `fetchOwnedTokenIds`,
  `expandTokenToAssets`, the re-export of `getReadableContract`, and `refreshAssetLibrary` if
  the router or live-update code still needs its non-DOM side effects. If `refreshAssetLibrary`
  becomes DOM-only, delete it and its 10 call sites. The plan determines which case applies by
  reading the function.
- `app-init.ts`: drop `galleryConnectBtn` from the connect-button list.

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
- New `sidebar-views.test.js`: VIEWS order, Ctrl+1–3, stored-view migration.
- Update: `asset-library.test.js`, `library-visitor.test.js` (gallery parts),
  `header-wallet-button.test.js` (avatar / sign-in), `asset-chrome.test.js` (`newMenuBtn`),
  `create-panel-generate.test.js` and `create-panel-followups.test.js` (if they assert the default
  view), `deployment-integrity.test.js` and `library-build.test.js` (if they list removed ids).

**E2E:**
- Update `e2e/helpers/studio-selectors.mjs` first (single source of selectors).
- Then update specs 06, 07, 08, 20, 22, 23, 24 and 25 for:
  - New ▾ instead of `#newAssetBtn`;
  - the avatar menu instead of the header wallet buttons;
  - the network select inside the avatar menu;
  - no Gallery tab (use the Library page);
  - Settings fields under Properties → Asset.
- Note: E2E reuses any backend on `:9090`. Run against a fresh dev stack (see project memory on stale backends).

**Visual:** Playwright screenshots of the header (signed out / signed in / testnet), the New ▾ menu
open, the avatar menu open, and the Studio rail, in both themes at 1440×900.

## 9. Risks

- **E2E churn** is the main cost. Centralising selectors in `studio-selectors.mjs` before touching specs keeps it mechanical.
- **CAD plan collision:** if this phase starts before the CAD work merges, rebase conflicts in
  `create-panel.ts` and `studio-sidebar.pug` are likely. Section 1's prerequisite exists for this reason.
- **Muscle memory:** Ctrl+1 now opens Outline instead of AI. Keyboard help and the release notes call this out.

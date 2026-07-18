# AI Generation Sidebar — Design

**Date**: 2026-07-19
**Status**: Approved (design), pending implementation plan

## Goal

Consolidate the entire AI generation experience into the left sidebar as a first-class "AI Generation" section, and clean up provider selection:

1. Move the prompt input (`#promptInput` / `#generateBtn` / `#generateHint`) out of the bottom `.messagebar` on the main stage and into the left sidebar chat pane, so conversation and input are co-located.
2. Rename the left sidebar "Chat" view to **"AI Generation"** and replace the generic chat-bubble icon with an explicit AI (sparkles) icon — the right inspector keeps human comments, so the AI/human naming collision disappears.
3. Restrict the Generation Provider select to **Mock** and **Tripo 3D** only (drop Meshy and Hunyuan3D, which have no backend adapter and 501 at generation time).
4. Move provider selection out of the Settings view and into the AI Generation pane, at the point of use — with BYOK key configuration behind a configure button + dialog, so a set-once credential doesn't consume permanent composer space.

## Decisions (made with user)

| Question | Decision |
|----------|----------|
| AI view rail position | **1st** in the icon rail (primary action). Ctrl+1–5 shortcuts renumber (index-based in `sidebar.js`); keyboard-help text updated (already stale — says 1–4, code does 5) |
| Provider control placement | **Above the prompt input** at the bottom of the AI pane — one generation-input cluster (provider, prompt, button) |
| Provider persistence | **Persist** `#providerSelect` to localStorage (new key `arbesk-provider`); previously not persisted |
| Bottom bar `Provider: Mock` static text | **Live-bind** it to the current selection (add an id, update on change) |
| BYOK key configuration | **Configure button + dialog** — the composer keeps a single provider row (select + key icon-button, visible only when Tripo 3D is selected). The key field lives in a `showCustomDialog`-based dialog opened from that button. Missing key → warning-colored icon + "key required" hint; generating without a key opens the dialog directly. Dialog includes a **Clear Key** action. Storage stays `arbesk-byok-key` in localStorage |
| Element ids / `data-view` values | **Preserved** (`#promptInput`, `#generateBtn`, `#generateHint`, `#chatHistoryList`, `#providerSelect`, `data-view="chat"`) — near-zero E2E selector churn. Exception: `#providerKeyInput`/`#providerKeyToggle` move out of the Pug into the JS-built key dialog (no test references them) |
| Tier select (`#tierSelect`) | **Stays in Settings** — it is a payment/contract-tier concern, not a provider concern |
| Backend (`generate-node.js`, `schemas.js`) | **No change** — provider enum validation explicitly deferred |
| Client-side key validation | **None** — no way to verify a Tripo key without a live API call. The field stays dumb (store + send); backend adapter errors surface at generation time. No "Test key" button in v1 |

## Current state (verified)

- Left sidebar (`app.pug:109-246`): icon rail + 5 views — Settings (1st, contains `#providerSelect` with `mock`/`meshy`/`tripo3d`/`hunyuan3d`, `#providerKeyInput`, `#tierSelect`, collection select, team panel), **Chat** (2nd, contains `#chatHistoryList` — already the AI conversation), Outline, Gallery, Activity. `sidebar.js:10` `VIEWS = ["settings","chat","outline","library","ledger"]`; default view is already `"chat"` (`sidebar.js:39-41`); view persisted under `arbesk-sidebar-view`.
- Prompt input is the `.messagebar` at the bottom of `.main-stage` (`app.pug:265-276`), styles in `frontend/src/scss/components/_messagebar.scss` — physically separated from the conversation it feeds.
- Backend provider reality: `src/api/adapters/` has only `mock-adapter.js`; non-mock providers return 501 `NOT_IMPLEMENTED` unless `MOCK_3D_GENERATION=true` (`src/api/assets/generate-node.js:80-88`). Tripo 3D remains aspirational until its adapter lands — kept per product direction.
- Human collaboration (Nostr comments) lives in the right inspector (`app.pug:314-330`, `comments-panel.js`) — untouched by this change.
- Icons are inline Feather-style SVGs in Pug (`stroke="currentColor"`, 18px in the rail, `_sidebar.scss:103-106`). The sparkle `✦` is already used as the chat welcome icon (`app.pug:188`).
- Dialogs are JS-built, not Pug: `frontend/src/js/ui/dialog.js` (`showDialog`, `showConfirmDialog`, `showInfoDialog`, `showCustomDialog`) with focus trap, Escape/backdrop cancel, and GNOME-styled surfaces.
- `.byok-field` / `.byok-toggle` styles live in `frontend/src/scss/components/_settings.scss:161,173` — global classes, reusable inside a dialog body. Warning color token: `--yellow-4` (`_tokens.scss:38`).

## Design

### Pug (`frontend/src/pug/app.pug`)

**Icon rail** — reorder so `data-view="chat"` is first; retitle to "AI Generation" (aria-label, title `AI Generation (Ctrl+1)`); swap the chat-bubble SVG path for a sparkles path (same `width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"` pattern). Settings becomes 2nd (`Ctrl+2`), Outline 3rd, Gallery 4th, Activity 5th. Mark the AI button `active` in markup to match the runtime default.

**AI Generation pane** (the existing `chat` sidebar-view) becomes a flex column with three regions:

1. Pane header title: "AI Generation".
2. `#chatHistoryList` (existing, `flex: 1`, scrolls) — unchanged behavior.
3. Generation cluster (`.chat-composer`), pinned at pane bottom:
   - Provider row (`.provider-row`): `#providerSelect` (options trimmed to `mock` = "Mock (Local)" first/default, `tripo3d` = "Tripo 3D") + `#providerKeyBtn` key icon-button (`hidden` while Mock is selected) + `#providerKeyHint` caption (shown only when Tripo 3D is selected with no stored key).
   - Prompt row: the `.messagebar-row` markup (textarea `#promptInput`, submit `#generateBtn`, spinner) + `#generateHint`, moved verbatim from the main stage.
   - The BYOK key input is **not** in the Pug — it is built per-open inside the key dialog (see JS section).

**Settings view** — remove the provider select and BYOK form-groups; keep asset name, collection select, tier select, team panel.

**Main stage** — delete the `.messagebar` block (`app.pug:265-276`). The viewport gains the freed vertical space; no resize code changes needed (engine resize runs inside `runRenderLoop`, `scene-graph.js:343-347`, immune to CSS layout changes).

**Bottom bar** — `app.pug:341` `span.bottombar-status-item Provider: Mock` gets `id="bottomBarProvider"` so JS can live-bind it.

### SCSS

- `_chat.scss`: chat pane becomes `display: flex; flex-direction: column; height: 100%` — history `flex: 1; overflow-y: auto`, `.chat-composer` `flex-shrink: 0` with a top border separator. New `.provider-row` (select + icon button on one row), `.provider-key-btn` (32px icon button, `.attention` state in `--yellow-4`), and `.provider-key-hint` (small warning caption).
- Move/adapt the messagebar input-row styles from `_messagebar.scss` into `_chat.scss`, scoped to the sidebar pane width (340px). Delete `_messagebar.scss` and its import in `styles.scss`.
- Check `utilities/_responsive.scss` for `.messagebar` references and remove them (the composer inherits the sidebar's responsive treatment).
- `.byok-field` / `.byok-toggle` stay in `_settings.scss` — they are global classes and are now consumed by the key dialog body.
- New sparkle and key icons need no CSS (inherit `.sidebar-switcher-btn svg` sizing / the button's own sizing).

### JS (`frontend/src/js/ui/create-panel.js`, `sidebar.js`, `keyboard-help.js`)

- `create-panel.js` — prompt/chat element lookups unchanged (ids preserved). BYOK moves out of the persistent DOM into a dialog:
  - Provider persistence: read `arbesk-provider` on init (validate against the select's actual options, fall back to `mock`), save on `change`.
  - `getByokKey()` reads `arbesk-byok-key` from localStorage directly — the key input only exists while the key dialog is open.
  - `showProviderKeyDialog()`: `showCustomDialog("Tripo 3D API Key", bodyEl)` — body contains the password input (prefilled from localStorage, persisted on `input`), the Show/Hide toggle, and a **Clear Key** button (`localStorage.removeItem`). All static HTML, no user content injected.
  - `syncProviderUI()`: toggles `#providerKeyBtn` visibility (real providers only), `.attention` + `#providerKeyHint` when the key is missing, and `#bottomBarProvider` text (`Provider: Mock (Local)` / `Provider: Tripo 3D`) — called on init, on provider change, and after key save/clear.
  - The `onGenerate()` BYOK guard (`create-panel.js:248-256`) calls `showProviderKeyDialog()` directly instead of showing a toast.
- `sidebar.js` — reorder `VIEWS` to `["chat","settings","outline","library","ledger"]`; nothing else (persistence key and default view already `"chat"`).
- `keyboard-help.js` — fix shortcut text to `1 – 5` (currently `1 – 4`, stale).

### Provider option trim

`#providerSelect` markup becomes:

```pug
select#providerSelect.form-select
  option(value="mock") Mock (Local)
  option(value="tripo3d") Tripo 3D
```

No other code references `meshy`/`hunyuan3d` on the frontend. Backend `generateAssetSchema` keeps `provider` as a free-form string (deferred hardening); Jest API tests posting `provider: "meshy"` exercise the backend BYOK path and remain valid — the restriction is a UI concern only.

## Error handling / edge cases

- **Narrow viewports (≤900px)**: sidebar auto-collapses (`sidebar.js:45-47`), hiding the prompt input — a known trade-off vs. the always-visible messagebar. Accepted: the responsive stylesheet already treats the sidebar as an overlay/bottom-sheet, and one Ctrl+B restores input access.
- **Stale `arbesk-provider` value** (e.g. `meshy` from an older build): init validates against the trimmed options and falls back to `mock`.
- **`tripo3d` without BYOK key**: the composer shows the warning hint + highlighted key icon; a generation attempt opens the key dialog directly (a guided flow, not a dead-end toast).
- **Key revocation**: Clear Key in the dialog removes `arbesk-byok-key` and immediately restores the missing-key UI state via `syncProviderUI()`.
- **E2E/dev flows**: `mock` stays first and default, so `flows.mjs generate()` and its `"Model carved via mock"` assertion are unaffected.

## Testing

- **E2E (mandatory per AGENTS.md — touches create panel, settings, chat):** `npx playwright test --config=e2e/playwright.config.js --project=chromium`. Ids and `data-view` values are preserved, so `studio-selectors.mjs` and `flows.mjs` should need no changes; spec 07's settings-switch for `#collectionSelect` and spec 99's `#sidebarToggle` clicks remain valid. If any assertion breaks, sync per `e2e/README.md` and the edit-ui skill's E2E Sync guide.
- **Jest:** `npm run test:frontend` and `npm test` — no test asserts the select options or pane structure directly; `test/api.test.js` BYOK cases stay green (backend untouched). New structural tests in `test/frontend/deployment-integrity.test.js` guard the Pug/JS invariants (provider options, prompt placement, rail order, key button + hint, bottom-bar id, view order, shortcut text).
- **Lint/typecheck:** `npm run lint`, `npm run typecheck:frontend`.
- **Manual smoke:** generate with mock (default); switch to Tripo 3D (key icon + hint appear; dialog opens; key persists across reload; Clear Key restores the hint; generation without a key opens the dialog); reload (provider persisted, bottom bar correct); collapse/expand sidebar (viewport does not stretch); Ctrl+1..5 switch views in new order.

## Out of scope

- Tripo 3D backend adapter (separate effort; the option is forward-looking).
- Backend provider enum validation in `schemas.js`.
- Client-side "Test key" validation against the Tripo API.
- Per-provider key storage map (only one real provider exists; revisit if providers multiply).
- Moving `#tierSelect` or any other Settings control.
- Any change to the right inspector / comments.
- Renaming `data-view="chat"` or the localStorage keys.

# Studio clarity: Insert, Create, Save draft / Publish

Date: 2026-10-15
Status: Draft for review
Mockup: https://claude.ai/artifact/AspPqtNrS5nsNVzs41RHrN (Insert and Create screens, Graphite)

## 1. Problem

Users report three areas of the Studio as confusing:

1. **The Assets panel (Ctrl+2).** Clicking a card *opens* the asset and replaces the
   Studio contents, while "Add to Scene" and drag *insert* it as a linked child. Users
   expect one and get the other. They also cannot tell what the panel is for next to
   the Library page, and each card carries Add to Scene, Download, Delete, Burn Token
   and an Owner/Editor badge.
2. **AI generation.** It is reached through an unlabeled sparkle rail icon or the third
   item of New ▾. The panel opens with a provider dropdown (Auto / Mock / Tripo 3D /
   Parametric CAD), an API key button, a "key required" hint and a credit balance
   before the user has typed anything.
3. **Save vs Besk it.** "Save" writes a draft manifest to IPFS without updating the
   token: collaborators never see it and nothing tracks it after the tab closes.
   "Besk it" publishes (updates or mints the token, creates `v<N>`, shares with the
   team). The durable action has the unclear name; the ephemeral one has the name
   users trust.

## 2. Goals and success criteria

- A first-time user can generate a model and insert one asset into another without
  explanation.
- Every card click in the Insert panel does the same thing.
- No provider, key or balance UI appears before the user asks for it or a generation
  needs it.
- The words on buttons, status text and toasts tell the user whether their work is
  kept and shared.

Non-goals: a visual rebrand (the Arbesk design language stays: Graphite/Paper,
one accent for the primary action, WCAG 2.2 AA), changes to the Library page beyond
the links that point to it, changes to draft storage or publishing mechanics,
autosave.

## 3. Design

### 3.1 Insert panel (was "Assets")

Rail tab, tooltip and panel title become **Insert** (Ctrl+2) with a "square plus"
icon from the sprite. `data-view="library"` stays for selector stability.

Panel content, top to bottom:

- Title "Insert" and one line: "Insert a live link to another asset. Changes to the
  original show up here." (replaces "Add to Scene or drag into the viewport…").
- Search field ("Search assets…"), filtering cards by name client-side.
- Sections **Your assets** and **Shared with you** (renamed from "My Assets" /
  "Shared"). The Owner/Editor badge is removed; the section says it.
- Cards: thumbnail, name, and a ⋯ button.
- Footer line when tokens fail to load: "N assets can't be loaded. Manage in
  Library" (link to `/library`). Broken-token cards are no longer rendered in the panel.

Behaviour:

| Input | Result |
|---|---|
| Click / Enter / Space on card | Insert a **live link** into the open asset at the origin with no dialog, select the new node, toast "Lamp inserted into Chair" with **Undo** (Undo unlinks the node through the existing child-remove path, which is itself undoable) |
| Drag card into viewport | Insert a live link at the drop point, no dialog |
| ⋯ → **Insert a copy** | Insert a frozen copy (today's "Fork (copy)"), no dialog |
| ⋯ → **Open Lamp** | Open the asset, replacing the Studio contents; if there are unsaved or unpublished changes, confirm first |
| ⋯ → **Show in Library** | Navigate to the asset in `/library` |

The Fork / Live reference dialog is no longer shown for Insert-panel inserts: the
card payload carries `mode: "live-ref" | "fork"`. Drops without a mode (e.g. from
other sources) keep the dialog.

- Card accessible name: "Insert Lamp". ⋯ is a separate `<button>` ("More actions
  for Lamp") using `initMenuButton()`.
- Download, Delete and Burn Token are removed from cards; they remain in the
  Library details pane.
- **No asset open:** cards are disabled and dimmed; a status block reads "Open or
  create an asset to insert into it." with a **New empty asset** button (same action
  as New ▾ → Empty asset).
- **Inserting an asset into itself** (or an ancestor) stays blocked by the existing
  cycle check; the card for the open asset is not shown.
- **Visitor (read-only profile):** title "Browse", the line reads "Read-only public
  profile. Open an asset to view it.", card click opens, ⋯ shows only Show in Library.

### 3.2 Create

Discoverability:

- When the Studio loads with no asset open, the rail selects **Create** instead of
  Outline. When an asset is open, the last-used tab is kept (current behaviour).
- New ▾ order: **Generate with AI**, Upload model… (Ctrl+O), Parametric CAD,
  separator, Empty asset (Ctrl+N).
- Empty viewport shows a **Start a new asset** card: "Describe it in the Create
  panel, or bring in a model you already have." with **Upload model** and **Empty
  asset** buttons and "or drop a .glb, .gltf or .3mf file here". It disappears once
  the scene has content. It is a DOM overlay, not Babylon chrome.

Panel:

- Title "Create", subtitle "Describe a model, or attach up to four photos of it."
- Prompt textarea (placeholder "A mid-century oak chair with tapered legs"),
  **Attach photos** icon button, **Generate** button. Generate uses the neutral
  secondary style; the accent stays reserved for Publish.
- Generation history renders above the composer as today.
- **Advanced** (`<details>`, closed by default, open state remembered per browser)
  contains:
  - **Generator** select (relabelled `#providerSelect`): "Choose for me" (`auto`),
    "AI model (Tripo 3D)" (`tripo3d`), "Parametric CAD" (`cad`), and "Mock (local)"
    (`mock`) only when `location.hostname` is `localhost` or `127.0.0.1`.
  - Key status line: "Tripo 3D API key: added · Change" / "not added · Add key".
  - Credit balance (existing `#providerBalance`), shown only when a key is set.
- The always-visible key button, key hint and attention state are removed.

Key on demand:

- When the user clicks Generate and the request will go to Tripo 3D (explicit
  selection, or "Choose for me" routed there by the generation advisor) and no key is
  stored, open the existing key dialog with new copy instead of failing:
  - Title "This model needs an AI generator"
  - Body: "Organic shapes like this are made with Tripo 3D, which uses your own API
    key. You can also try Parametric CAD, which is free but best for geometric parts."
  - Key field, "Get a key from Tripo 3D" link
  - Buttons **Use Parametric CAD** (re-runs the same prompt with `cad`) and **Save key
    and generate** (stores the key, then continues the original request).
- Image attachments force Tripo 3D; the dialog's CAD button is hidden when images are
  attached.

### 3.3 Save draft / Publish

| Element | Before | After |
|---|---|---|
| `#saveAssetBtn` label | Save | **Save draft** |
| `#saveAssetBtn` tooltip | Save Draft (Ctrl+S) | Kept in this tab only. Publish to share with your team and keep it. (Ctrl+S) |
| `#publishAssetBtn` label | Besk it | **Publish** (accent, only filled accent button) |
| `#publishAssetBtn` tooltip | Publish (Besk it) this asset | Share this version with your team (v<K>), where K is the version actually published |
| Status meta | `v3 · Draft` | `v3 · Draft` (unpublished changes) / `v4 · Published` |
| Draft toast | Draft saved. | Draft saved — kept in this tab only |
| Publish toast | Published — collection minted on-chain. / Republished. | Published v<K> — your team can see it now (K = the version actually published) (first publish adds: "Asset created on-chain") |

- The `besk-star` icon on the publish button is removed; the label carries the
  meaning.
- **Leave-page guard:** `hasUnsavedChanges()` also returns true when the open asset's
  latest draft CID differs from its published manifest CID, so closing the tab with
  a saved-but-unpublished draft triggers the browser's leave prompt. The guard still
  only applies when `canEdit()`.
- Ctrl+S stays Save draft. No new shortcut for Publish.
- Other copy that says "Besk it" in the Studio (tooltips, keyboard help, dialogs)
  changes to "Publish". The landing page and brand name are out of scope.

## 4. Components and files

| Area | Files |
|---|---|
| Insert panel | `frontend/src/js/ui/asset-library.ts` (card builder, footer, activation, sections, search, no-asset and visitor states), `frontend/src/pug/includes/studio-sidebar.pug`, `frontend/public/icons.svg` (square-plus symbol), panel SCSS under `frontend/src/scss/components/` |
| Create | `frontend/src/js/ui/create-panel.ts` (Advanced, key-on-demand, mock gating), `frontend/src/js/ui/new-menu.ts` (order), `frontend/src/pug/includes/studio-sidebar.pug`, `frontend/src/pug/includes/studio-main.pug` (empty-viewport card), default-tab selection in the sidebar module |
| Save draft / Publish | `frontend/src/pug/includes/header.pug`, `frontend/src/js/ui/asset-save.ts` (toasts), `frontend/src/js/ui/asset-chrome.ts` (status meta), `frontend/src/js/state/unsaved-changes.ts` (draft-vs-published source), `frontend/src/js/ui/keyboard-help.ts` |
| E2E | `e2e/helpers/studio-selectors.mjs`, `e2e/helpers/manifest.mjs`, affected specs |
| Docs | `.agents/skills/edit-ui/SKILL.md` (layout paragraph, rail names, Save draft/Publish) |

Load-bearing ids that stay: `#saveAssetBtn`, `#publishAssetBtn`, `#providerSelect`,
`#promptInput`, `#generateBtn`, `#newAssetBtn`, `.asset-card`, `[data-view="library"]`,
`[data-view="chat"]`.

## 5. Error handling

- Insert fails (manifest fetch, cycle): error toast with the reason; nothing is added;
  no Undo offered.
- Key dialog: an invalid key reported by the provider keeps the dialog open with the
  provider's message under the field; the original prompt is preserved.
- Use Parametric CAD fails: the normal generation error path applies.
- Publish failure toasts keep their current Retry action; only wording changes.

## 6. Testing

- Unit (bun + jsdom):
  - card builder: actions per mode (owner, no asset open, visitor), accessible names,
    no Download/Delete/Burn on cards;
  - click inserts, ⋯ → Open opens; unpublished-changes confirm on Open;
  - Create: Advanced closed by default, mock option gated by hostname, key dialog
    shown only when routed to Tripo without a key, CAD fallback re-runs the prompt;
  - `hasUnsavedChanges()` true for saved-but-unpublished draft;
  - default rail tab is Create with no asset open.
- `test/frontend/theme-contrast.test.js` and `style-guards.test.js` pass (no new
  colours expected; any new tint goes in `DERIVED_TEXT_PAIRS`).
- E2E: update selectors and text assertions for Save draft / Publish, toasts, Insert
  panel title, card-click semantics (specs that opened assets by card click switch to
  ⋯ → Open), New ▾ order. Run the full suite (Studio UI/UX and save/publish are
  E2E-gated per `AGENTS.md`).

## 7. Open questions

None blocking. Candidates for later: autosave of drafts, a first-publish explainer
about on-chain creation and gas, applying the Insert/Browse split to the Library
details pane.

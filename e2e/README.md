# Arbesk End-to-End (E2E) Tests

> **Critical path coverage:** wallet connection → free-tier generation → save draft → publish ERC-721 token → library collection/asset browser → asset-level comments.
>
> Run these tests **before any major change** that touches the Studio UI, library page, wallet flow, generation pipeline, save/publish logic, smart-contract integration, or IPFS manifest shape.

---

## Quick start

From the repo root:

```bash
bunx playwright test --config=e2e/playwright.config.js --project=chromium
```

The global setup (`e2e/global-setup.mjs`) orchestrates the test infrastructure directly:

1. Starts one complete Docker stack per Playwright worker (IPFS + Hardhat + Nostr).
2. Resets each Hardhat chain to genesis.
3. Compiles contracts once and deploys fresh `ArbeskAssetFree` + `ArbeskAsset` + `MockUSDC` per stack.
4. Syncs deployed addresses to `.env` files and JS network configs.
5. Builds the frontend once.
6. Starts one Express backend per worker with `MOCK_3D_GENERATION=true`.

The global teardown (`e2e/global-teardown.mjs`) stops all backends and brings every worker's Docker stack down.

No manual `bun src/index.ts` is required.

### Parallel workers

By default the suite runs with **1 worker / 1 stack** (lightest — matches CI and
low-RAM machines). Opt into parallel isolated stacks with `E2E_WORKERS=N`:

```bash
# Default: 1 worker, 1 stack
bunx playwright test --config=e2e/playwright.config.js --project=chromium

# Opt into parallel isolated stacks (e.g. 4 workers = 4 full stacks)
E2E_WORKERS=4 bunx playwright test --config=e2e/playwright.config.js --project=chromium
```

Per-worker port scheme (worker index `i`):

| Service | Port |
|---|---|
| Backend | `deriveBackendPort(root) + i` (`9090 + i` on the main checkout) |
| Hardhat RPC | `8545 + i` |
| IPFS API | `5001 + i` |
| IPFS Gateway | `8080 + i` |
| Nostr relay | `7777 + i` |
| Compose project | `<worktree-project>-w${i}` |

Requirements and caveats:

- **RAM:** the default single worker is lightest. `E2E_WORKERS=4` spins up 4 full stacks (12 containers + 4 backends) and typically needs **6–8 GB** peak — use fewer workers on machines with less than 8 GB.
- **Port availability:** the host ports above must be free for each worker index. If they are already in use, the run will fail during global setup.
- **Coverage:** `E2E_COVERAGE=1` is not yet validated with `E2E_WORKERS > 1`.

---

## Git worktrees

E2E is worktree-aware. Each checkout gets its own Docker Compose project, its own backend port, and its own handoff state file, so tests from one worktree do not silently reuse containers, contracts, or a running backend from another worktree.

- The main checkout keeps the familiar `http://127.0.0.1:9090` backend port.
- Linked worktrees automatically receive a deterministic backend port in the `30000–40000` range.
- Docker containers are named by the Compose project (`arbesk-<worktree-id>_*`) instead of the old global `arbesk-hardhat`, `arbesk-private-ipfs`, and `arbesk-nostr-relay` names.

To create a worktree already seeded with the current working-tree state, environment files, built frontend, and compiled contracts, use the helper script:

```bash
bun run worktree:create -- feature-xyz
```

Then run tests from `.worktrees/feature-xyz` as usual. The script also forces `IPFS_BACKEND=kubo` in the worktree `.env` because local E2E relies on the Kubo gateway and `Qm...` CIDs.

If you switch to a worktree while the main checkout's Docker stack is still running, the worktree's setup will detect the port conflict and print the name of the foreign container that is holding the fixed Hardhat/IPFS/Nostr ports. Stop that stack first:

```bash
# From the other worktree / main checkout:
docker compose -p <project-name> down
```

You can also stop the current worktree's stack after a run:

```bash
docker compose -p $(./scripts/start-dev.sh --print-project 2>/dev/null || echo arbesk) down
```

> **Note:** The non-backend services still use fixed host ports within a single run (`8545`, `5001`/`8080`, `7777` for worker 0). When `E2E_WORKERS > 1` each worker offsets from those bases. True concurrent E2E runs across *worktrees* on the same machine require stopping one stack before starting another; the isolation guarantees that each stack uses the correct worktree's files.

---

## What the tests cover

### 1. Wallet connection (`e2e/specs/01-connect-wallet.spec.js`)

Validates the full wallet-discovery and authentication path:

- Injects a Hardhat-backed EIP-1193/EIP-6963 provider into the browser.
- Opens `/studio`.
- Confirms the Studio connects via the Login / Signup picker and authenticates via SIWE.
- Asserts the **Login / Signup** button opens the wallet picker, selecting the injected wallet connects, and the wallet menu button shows the connected address.

**Why it matters:** Any change to `wallet-discovery.ts`, `siwe.ts`, the headerbar wallet buttons, or the SIWE session flow can break this. If this spec fails, every subsequent spec fails because they all depend on being logged in.

### 2. Asset generation (`e2e/specs/02-generate-asset.spec.js`)

Validates free-tier mock generation end-to-end:

- Types `cowboy` into the prompt input and clicks **Generate asset**.
- Confirms the result lands as an asset chat bubble (live 3D preview canvas + **Show in Studio** button) and that the Studio URL/scene stay untouched.
- Clicks **Show in Studio**, then confirms the chat history shows `Model carved via mock` and the bubble collapses to its sent state (snapshot preview, button stays live as the restore path).
- Verifies multiple pending generations keep independent send buttons.
- Extracts the manifest CID from `?manifest=baf...` in the URL. The exact CIDv1 prefix depends on the IPFS backend (e.g. `bafy...` for dag-pb, `bafkrei...` for raw JSON).
- Fetches the manifest from the local IPFS gateway.
- Validates the manifest structure (asset_id, version, timestamp, one `source_asset` node, source CID/format, 16-element transform matrix, node name contains the prompt).

**Why it matters:** This exercises the prompt UI, free-tier `recordGeneration()` transaction, backend validation, mock adapter, IPFS add/pin, and manifest schema. Changes to any of those can invalidate the generated manifest shape or the UI feedback that the spec waits on.

### 3. Save and publish (`e2e/specs/03-save-and-publish.spec.js`)

Validates the full draft-save → publish → on-chain token lifecycle:

1. Generates `cowboy` (same as Spec 2).
2. Clicks **Save Draft** and waits for the URL to flip to a new manifest CID.
3. Extracts the new manifest CID from the URL and asserts it is different from the generation CID.
4. Validates the saved manifest is version `2` and links back to the generation CID via `prev_asset_manifest_cid`.
5. Clicks **Besk it** (publish), fills the **Name Your Asset** dialog with `Cowboy Test`, and confirms.
6. Waits for the URL to show `?asset=0x...`.
7. Extracts the hex token ID from the URL.
8. Resolves the on-chain `tokenURI` through the contract and walks the collection manifest to the first asset.
9. Asserts the published asset manifest name is `Cowboy Test` and validates its structure.
10. Opens the gallery and asserts an asset card appears for the decimal token id.

**Why it matters:** This is the most complex spec. It touches the save button, publish button, name dialog, parametric versioning, thumbnail capture, ERC-721 minting, collection manifests, and gallery rendering. UI changes to any of those controls or changes to the manifest schema/versioning logic can break it.

### 4. Parametric versioning + time-travel (`e2e/specs/04-parametric-version.spec.js`)

Validates two of the platform's Golden Rules — **Parametric Coexistence** and **Temporal Isolation**:

1. Generates `cowboy` (version 1).
2. Selects the node in the **Outliner**, which auto-opens the component colour editor.
3. Changes the colour and **Save**s — asserts a new version `2` whose `prev_asset_manifest_cid` is the generation CID.
4. Asserts the scene clock (`#sceneClock`) now spans two versions and the badge shows `v2`.
5. Scrubs the scene clock back to the oldest version and asserts the badge follows to `v1` (and forward again to `v2`).
6. Selects the outliner node, asserts the model-clock badge (`#modelClockBadge`) shows `v2`, presses `Home` to step the 3D gizmo to the oldest version, and returns to the newest scene version before publishing.

**Why it matters:** Colour/scale edits are first-class versions, and the scene/model clocks are the app's version-control surfaces. Changes to `parametric-preview.ts`, `version-history-store.ts`, `scene-clock.ts`, `model-clock-gizmo.ts`, the outliner selection path, or version-chain logic can break it.

### 5. Republish existing token (`e2e/specs/05-republish.spec.js`)

Validates the edit → **republish** branch (no new mint):

1. Generates, saves, and publishes a token.
2. Edits the published asset's colour.
3. Clicks **Besk it** again — an already-named token skips the dialog and calls `updateAssetURI` instead of minting.
4. Polls the on-chain collection manifest until the asset's manifest CID changes; asserts the same name, a newer version, and an unchanged `?asset=<tokenId>` anchor.

**Why it matters:** Spec 3 only covers the first mint. The republish path (`updateAssetURI`) is a distinct on-chain flow; changes to `asset-save.ts` / `services/asset-save/` publish branch or collection manifest resolution can break it.

### 6. Nesting / linked child assets (`e2e/specs/06-nesting.spec.js`)

Validates the "dollhouse architecture" — linking a token as a child asset and navigating depth:

1. Publishes a world to use as the child reference.
2. Starts a fresh parent (**New asset** → name), generates the parent's own content.
3. Uses the gallery card's **Add to Scene** to link the child token into the parent.
4. **Save**s and asserts the parent manifest gains a `child_ref` node with a 16-element identity `transform_matrix` and **no** local `history`.
5. Selects the child node and **dives** (`#inspectorDiveBtn`) — asserts the back button reveals and the `nesting:didDive` event fires at depth 1.
6. **Ascends** via the back button — asserts it hides and `nesting:didAscend` fires at depth 0.

**Why it matters:** Token child nodes (`child_ref`, `transform_matrix`, depth gating) are the core fractal-nesting data model. Changes to `nesting.ts`, `scene-graph.ts` linked-asset handling, the token resolver, or the child-node manifest shape can break it.

> **Note:** the outliner only renders a linked child node **after a save** (it refreshes on `ASSET_DRAFT_SAVED`, not on `SCENE_TOKEN_CHILD_ADDED`), so the spec saves before locating the child node.

### 7. Collection/asset model (`e2e/specs/07-collection-assets.spec.js`)

Validates that every ERC-721 token is a collection manifest containing one or more asset manifests:

1. Publishes a first asset and asserts the on-chain `tokenURI` resolves to a collection manifest with at least one entry.
2. Publishes a second asset and asserts it lands in the **same** default collection token without disturbing the first asset.
3. Opens the published token in the gallery, clicks an asset card, and asserts the Studio viewport loads the asset name.
4. Uses **New Asset** to clear the scene while preserving the selected collection context, then publishes again into the same collection.
5. Reloads `?asset=TOKENID` and asserts the viewport restores the first asset.
6. Asserts the collection selector populates on wallet connect with the wallet-derived default collection ID.

**Why it matters:** This is the only spec that exercises the collection manifest shape end-to-end, the `activeAssetId` → collection `assets` map, and the gallery asset-card deep-link into the Studio. Changes to `asset-save.ts`, `collection-publish.ts`, the collection selector, or the gallery card rendering can break it.

### 7b. Material editor: multi-primitive mesh color override (Jest, not E2E)

Regression coverage for issue #25 lives in `test/frontend/material-editor.test.js` (a Playwright spec once existed and was retired): `applyMeshOverrideColors()` must update **all** primitives of a mesh, not just the first matching one.

- Runs `material-editor.ts` against a minimal two-primitive, two-material glTF fixture.
- Asserts both materials receive the override color.
- Also validates the `defaultColor` baseline branch.

**Why it matters:** A pure-JS regression test that protects the color-editing pipeline without requiring wallet setup or IPFS writes. Changes to `material-editor.ts`, especially `findMaterialByMeshName()` or `applyMeshOverrideColors()`, can break it.

### 8. Fork vs live reference (`e2e/specs/08-fork-live-ref.spec.js`)

Validates the two ways to reuse another collection's asset inside a parent scene:

1. Publishes a child asset.
2. Starts a fresh parent draft and uses the gallery card's **Add to Scene**.
3. **Fork (copy)** — asserts the parent manifest stores a `source` node with a frozen CID, no `child_ref`, and no local `history`.
4. **Live reference** — asserts the parent manifest stores a `child_ref` node pointing at the child's collection/token/assetID, with a 16-element `transform_matrix` and no `source` or `history`.

**Why it matters:** Fork/live-ref is the core fractal-reuse mechanism. Changes to `nesting.ts`, the gallery card actions, the fork/live-ref dialog, or the `child_ref` schema can break it.

### 9. Library basics (`e2e/specs/09-library-basics.spec.js`)

Validates the Nautilus-style collection browser on `/library`:

1. Confirms the wallet gate appears before connection and connects via the Login / Signup picker.
2. Asserts the wallet-derived default collection is labeled **Default**.
3. Publishes an asset in Studio and verifies it appears inside **Default** in the library.
4. Tests breadcrumb navigation and the **Up** button to return to the collection list.
5. Tests search filtering (matching and empty states).
6. Tests grid/list view toggle and sort-by-name.

**Why it matters:** The library is a view inside the unified SPA (`app.html` served at `/library`) with its own state and selection model. Changes to `app-init.ts`, `library-controller.ts`, `library-grid.ts`, `library-toolbar.ts`, or the wallet gate can break this.

### 10. Library asset actions (`e2e/specs/10-library-asset-actions.spec.js`)

Validates the context-menu actions available on library assets:

1. **Rename** — opens the GNOME dialog, changes the asset name, and asserts the grid updates.
2. **Delete** — confirms deletion and asserts the asset is removed from the collection (NFT is not burned).
3. **Open in Studio** — navigates to `/studio?asset=TOKEN&assetId=ID` and asserts the asset loads.
4. **Send to Collection…** — with only the default collection present, asserts a warning toast explains that another collection is required.

**Why it matters:** These actions exercise `library-context-menu.ts`, `services/asset-delete.ts`, collection manifest updates, and the Studio deep-link handling.

### 11. Library ↔ Studio round-trip (`e2e/specs/11-library-studio-roundtrip.spec.js`)

Validates the publish-in-Studio / browse-in-Library / open-in-Studio loop:

1. Publishes an asset in Studio, then asserts it appears in the library and in the on-chain collection manifest.
2. Opens the asset from the library and asserts the Studio URL contains both `asset` and `assetId`, and the asset name appears in the status bar.

**Why it matters:** This verifies the library is not just a read-only gallery but a true entry point back into the Studio editor. Parametric republish flows are covered in Spec 5.

### 12. Library create collection and upload (`e2e/specs/12-library-create-upload.spec.js`)

Validates the new Library toolbar flows for collection creation and desktop file upload:

1. Clicks **New Collection**, names it, and confirms.
2. Asserts the new collection is minted and appears in the collections list.
3. Opens the new collection.
4. Uses the **Upload** button to select `mock-gltf-assets/howdy.glb` from disk.
5. Asserts the uploaded file appears as an asset named `howdy` inside the collection.
6. Resolves the on-chain collection manifest and asserts the uploaded asset manifest's source was **decomposed at upload** to `composite.gltf` / `format: "gltf"` — the canonical stored form a Studio save produces.
7. Opens the uploaded asset in Studio and asserts it loads.
8. Repeats the flow with `mock-gltf-assets/box.3mf`: asserts the asset manifest's source was decomposed to `composite.3mf.json` / `format: "3mf"`, and that it opens in Studio (compose-on-load).
9. Asserts clicking **Upload** at the collection root shows a warning toast instead of opening the file picker.

**Why it matters:** These flows exercise `library-toolbar.ts`, `library-ops.ts`, browser-side IPFS writes, `publishAsset` for named collections, `updateAssetURI` for adding assets, and the file input wiring. They are the only automated coverage for desktop file uploads, and they pin the decompose-at-upload guarantee: every upload (GLB/glTF/3MF) lands in the collection in the same canonical decomposed stored form a Studio save would produce.

### 13. Editor collaboration (`e2e/specs/13-editor-collaboration.spec.js`)

Validates the Merkle-editor authorization flow across three wallets:

1. **Owner** publishes an asset.
2. **Owner** adds a second wallet as an editor via the collaborators panel.
3. **Editor** opens the shared asset, edits a node colour, and republishes — asserts the on-chain collection manifest version increases.
4. **Outsider** (third wallet) opens the same asset, attempts to republish, and is rejected with `Not an authorized editor`; asserts the on-chain version does **not** advance.

**Why it matters:** This is the only multi-wallet E2E coverage for the Merkle editor-list feature. Changes to `editor-publish.ts`, `team.ts`, `merkle-editors.ts`, the collaborator UI, or the republish authorization path can break it.

### 14. Collaborative comments (`e2e/specs/14-collaborative-comments.spec.js`)

Validates live asset-level comments across an owner and an editor:

1. **Owner** publishes an asset.
2. **Owner** adds a second wallet as an editor via the collaborators panel.
3. **Owner** posts a comment on the asset.
4. **Editor** opens the shared asset and sees the owner's comment.
5. **Editor** replies; the owner's session sees the reply live.

**Why it matters:** This is the only multi-wallet coverage for the Nostr chat proxy and comment thread state. Changes to `comment-thread.ts`, `comments-panel.ts`, `chat-proxy.ts`, Merkle editor proof wiring in comments, or the comments archive snapshot can break it.

### 15. Asset-level comment isolation (`e2e/specs/15-asset-level-comments.spec.js`)

Validates that comments do not leak between assets in the same collection:

1. Publishes two assets (`A` and `B`) in the same default collection.
2. Resolves both `assetId`s from the on-chain collection manifest.
3. Posts a comment on asset `A`.
4. Switches to asset `B` and asserts the comment is not present and the count is `0`.
5. Switches back to asset `A` and asserts the comment is still present.

**Why it matters:** Comments are keyed by asset, not by collection or token. Any regression in `comment-thread.ts` context reset, the chat proxy `assetTag`, or the archive snapshot `assetId` would cause cross-asset leakage.

### 16. 3MF generation (`e2e/specs/16-3mf-generation.spec.js`)

Validates the 3MF format path end to end:

1. Generates with a "3mf" prompt — the mock adapter returns `box.3mf` and the manifest node source is `{ format: "3mf", path: "asset.3mf" }`.
2. Saves a draft — the 3mf handler decomposes the raw package into composite 3MF form (`path: "composite.3mf.json"`) with a new source CID.
3. Publishes the asset on-chain, then reloads it from the chain (`?asset=&assetId=`) — resolving token → collection → composite 3MF and exercising `compose3mf()` + the in-memory 3MF → glTF render conversion a second time.

**Why it matters:** The only E2E coverage of the 3MF format path end to end — mock keyword routing, decompose-on-save into composite 3MF, and the composite → compose → render round-trip after a chain reload. A regression in the 3mf handler, the composer/decomposer, or the mock routing shows up here first.

### 17. Undo/redo (`e2e/specs/17-undo-redo.spec.js`)

Validates the undo/redo stack for parametric edits:

1. Generates `cowboy` and selects the node in the **Outliner** to open the inspector.
2. Expands the collapsed **Scale** section and asserts undo/redo start disabled.
3. Commits a scale edit through the inspector field — undo enables.
4. Blurs the field (the shortcut is intentionally blocked while a text input is focused) and presses `Ctrl+Z` — the original scale is restored and redo enables.
5. Clicks the toolbar **Redo** button — the edit is re-applied.

**Why it matters:** This is the only E2E coverage of the undo/redo history: the inspector field commit path, the keyboard shortcut (and its text-input guard), and the toolbar button state machine. Changes to the history store, inspector scale section, or shortcut handling can break it.

### 18. Chat provenance (`e2e/specs/18-chat-provenance.spec.js`)

Validates that AI prompts are recorded as version-scoped provenance in the manifest chain:

1. Generates two assets, each auto-saved by **Show in Studio** (the "Saved" pill is the durable signal the auto-save and URL flip completed).
2. Asserts each saved version's `metadata.chat` records exactly the prompt accepted since the previous save, with `provider: "mock"`, `task: "model"`, and a numeric timestamp.
3. Asserts the chain-root generation manifest carries **no** chat records — provenance is anchored by saves.
4. Asserts the chat history renders live after each save (header + prompts + divider) and again after a cold reload, where boot's `loadFromParams()` walks the chain to reconstruct the conversation.

**Why it matters:** `metadata.chat` is the on-IPFS record of the AI conversation that produced an asset. Changes to the auto-save path, the provenance writer, or the chain-walk history renderer can break it.

### 19. Animation preview (`e2e/specs/19-animation-preview.spec.js`)

Validates the inspector **Animations** section for models that embed glTF animations:

1. Uploads an animated GLB fixture (`e2e/fixtures/animated-triangle.glb`) into a new library collection and opens it in Studio.
2. Selects the node in the **Outliner** and asserts the **Animations** section is visible.
3. Asserts the clip dropdown lists `["None", "spin"]`, selecting the clip updates the value, and selecting **None** resets it.

**Why it matters:** The only E2E coverage of the animations inspector (playback wiring itself is unit-tested in `test/frontend/animation-preview.test.js`). Changes to animation detection on load, the inspector section, or the dropdown wiring can break it.

### 20. New asset name (`e2e/specs/20-new-asset-name.spec.js`)

Validates that the **+ New** flow shows the typed name in the header:

1. Clicks **+ New**, types `My Test Asset` in the dialog, and confirms.
2. Asserts the header asset name shows `My Test Asset`.

**Why it matters:** Regression coverage for a real bug — `startNewAsset` emitted `SCENE_EMPTY` after writing the title, and the `SCENE_EMPTY` listener reset the header to "No asset open". Changes to the new-asset flow or the scene-empty event wiring can reintroduce it.

### 21. Computed asset metadata (`e2e/specs/21-metadata-computed.spec.js`)

Validates that saving bakes deterministic computed facts into the manifest:

1. Generates `cowboy` and clicks **Show in Studio** (auto-saves the draft and bakes metadata).
2. Asserts the saved manifest carries `metadata.computed` with `format: "gltf"` for the glTF root.
3. Reloads the page and asserts boot re-reads `?manifest=` with the same CID — the metadata survives a cold reopen.

**Why it matters:** `metadata.computed` gives consumers (like the public profile and tooling) deterministic facts about an asset without parsing its payloads. Changes to the metadata baking on save or the boot reload path can break it.

### 22. Live scene update (`e2e/specs/22-live-scene-update.spec.js`)

Validates that republishing a live-referenced child reloads it inside an open parent scene:

1. Publishes a child, then builds a parent with a **live reference** to it and saves.
2. Subscribes to the live-update bus events (`ASSET_URI_CHANGED`, `ASSET_URI_UPDATED`).
3. Dives into the child, edits a node colour, and republishes (same token, new version).
4. Asserts the live-update path fires: the local publish event, then the reload trigger.

**Why it matters:** Live references are supposed to track future edits — this spec pins the same-window reload trigger. Changes to the publish event emission, the live-update bus, or the dive-republish path can break it.

### 23. Cross-window live update (`e2e/specs/23-cross-window-live-update.spec.js`)

Validates live updates across two browser windows via the Nostr relay (kind 20001):

1. Window A publishes a child, then a parent with a live-ref to it.
2. Window B opens the parent via the Library and renders the `child_ref` node.
3. Window A dives into the child, edits, and republishes.
4. Asserts the relay saw the kind-20001 notice (publish-side), window B fired the reload trigger for the child's token (subscribe-side), and B re-fetched the child's **new** manifest CID (content). The test subscribes to the relay from the test process so a failure splits cleanly into publish-side vs subscribe-side.

**Why it matters:** This is the only multi-window coverage of the relay-based live-update flow, and it pins the dive-republish assetID (a republish written under the parent's assetID leaves the `child_ref` pointing at the old CID). Changes to the relay notice publishing, the subscription handler, or the token-id normalization can break it. Uses a raised per-test timeout (`test.setTimeout`) like specs 13/14/24.

### 24. Nested live update (`e2e/specs/24-nested-live-update.spec.js`)

Validates cross-window live updates through three levels of nesting:

1. Publishes a grandchild GC into its **own** named collection (distinct token), then builds child C with a live-ref to GC, then parent P with a live-ref to C.
2. Window B opens P from the Library and loads the nested GC node (signaled by B fetching GC's manifest over IPFS).
3. Window A opens GC from its own collection (publish targets the active collection — diving keeps Default active), edits, and republishes.
4. Asserts the relay notice carries GC's token as a canonical decimal tag, window B fires the reload trigger for GC's token with `source: "remote"`, and B re-resolves GC's new manifest CID.

**Why it matters:** Only the nested anchor in the open scene can match GC's update notice — this spec pins deep-nesting live resolution and the active-collection publish targeting rule. Changes to nested node resolution, relay tag formatting, or the publish collection selection can break it. Uses a raised per-test timeout (`test.setTimeout`) like specs 13/14/23.

### 25. Public profile (`e2e/specs/25-public-profile.spec.js`)

Validates anonymous, read-only access to a wallet's public profile (the profile id is the base58 encoding of the EVM address; the subject's default collection is seeded in `beforeAll`):

1. An anonymous visitor browses `/library/<base58>` with no sign-in gate — the subject's collections render, create/upload buttons are hidden, and a visitor badge identifies the profile.
2. Bare `/library` without a wallet still shows the sign-in gate.
3. Connecting a wallet rewrites a bare `/library` URL (via `replaceState`) to the wallet's public profile URL, with owner chrome instead of visitor chrome.
4. Opening an asset from the library scopes the Studio URL to `/studio/<base58>?asset=…&assetId=…`.
5. An anonymous page (no injected wallet, no session) opens a published asset in Studio read-only — the tokenURI read and manifest load work without a wallet, and save/publish stay hidden.
6. The anonymous studio profile loads the sidebar gallery (visitor badge, no sign-in prompt, no **New** button), and clicking a card opens the asset in the viewport.

**Why it matters:** Public profiles are the platform's anonymous sharing surface. Changes to the profile URL routing, visitor-mode chrome, the read-only save/publish gating, or the base58 id format can break it.

### Chat version restore (`e2e/specs/chat-version-restore.spec.js`)

Validates that a version-card bubble's **Show in Studio** button stays a live restore path:

1. Generates two assets; each **Show in Studio** auto-saves a draft and annotates its bubble with a "Saved" pill (the mock provider hides the Tripo3D-only refine indicator).
2. Re-clicks the first bubble's **Show in Studio** — the Studio restores that older version (the URL flips to a different manifest) and the send tail runs again, while auto-save stays idempotent on the bubble (still 2 saved pills).
3. Asserts chain continuity: the restore auto-save chains onto the **pre-restore tip**, not a fork at the restored older version (`prev_asset_manifest_cid` of the new tip is the second save's CID).

**Why it matters:** Chat bubbles are the user's time-travel surface for generation versions. A restore that forks the chain or fails to re-run the send tail silently corrupts version history. Changes to `chat-preview.ts`, the bubble send handler, or the auto-save chaining can break it.

### 99. Viewport resize regression (`e2e/specs/99-resize-regression.spec.js`)

Guards the Babylon engine resize pattern: the viewport must never stretch during window resize or sidebar collapse/expand. The engine resizes inside `runRenderLoop` immediately before `scene.render()` (see `frontend/src/js/engine/scene-graph.ts`).

**Why it matters:** Resize handled synchronously in the resize event (or a throttled render loop) causes visible viewport stretching. This spec is the only automated coverage for that regression.

---

## When you MUST run these tests

Run the E2E suite **before merging** any PR that changes:

- **Studio UI/UX:** headerbar buttons, chat history, prompt input, settings panel, dialogs, wallet controls.
- **Library page:** the `/library` SPA view, `app-init.ts`, `library-controller.ts`, `library-grid.ts`, `library-toolbar.ts`, `library-context-menu.ts`, collection/asset rendering, search/sort/view controls.
- **Wallet integration:** EIP-1193/EIP-6963 discovery, `wallet.ts`, `wallet-discovery.ts`, `siwe.ts`, session auth.
- **Generation flow:** `create-panel.ts`, generation API, transaction validation, mock adapter, provider selection.
- **Save/publish logic:** `asset-save.ts`, `dialog.ts`, manifest versioning, thumbnail capture.
- **Smart contracts or ABI:** `ArbeskAssetFree.sol`, `ArbeskAsset.sol`, deployment scripts, contract addresses.
- **Manifest schema:** `scene.nodes`, `source_asset`, `transform_matrix`, `prev_asset_manifest_cid`, `thumbnail`, `child_ref`, `comments_archive_cid`.
- **IPFS integration:** storage format, CID encoding, pin/unpin behavior.
- **Asset-level comments:** `comments-panel.ts`, `comment-thread.ts`, chat proxy, comments archive.

Running `bun run test` (unit/Jest) and `bun run test:contracts` is **not enough** for these areas. The E2E specs are the only automated coverage that validates the full browser → wallet → backend → blockchain → IPFS chain.

---

## Keeping tests in sync with UI changes

### Selectors are the contract between tests and UI

All UI selectors live in `e2e/helpers/studio-selectors.mjs`. Treat them as a public API:

```js
export const SELECTORS = {
  connectWalletBtn: "#connectWalletBtn",
  disconnectWalletBtn: "#disconnectWalletBtn",
  promptInput: "#promptInput",
  generateBtn: "#generateBtn",
  chatHistoryList: "#chatHistoryList",
  assetBubble: ".chat-bubble-asset",
  assetBubbleSend: ".chat-bubble-asset .chat-asset-send",
  assetBubbleCanvas: ".chat-bubble-asset .chat-asset-canvas",
  saveAssetBtn: "#saveAssetBtn",
  publishAssetBtn: "#publishAssetBtn",
  srStatus: "#srStatus",
  dialogInput: ".dialog-input",
  dialogConfirmBtn: ".dialog-confirm-btn",
  // Library / collection browser
  libraryGate: "#libraryGate",
  libraryMain: "#libraryMain",
  libraryItems: "#libraryItems",
  libraryCollectionItem: '[data-type="collection"]',
  libraryAssetItem: '[data-type="asset"]',
  libraryItemName: ".library-item-name",
  libraryBreadcrumb: "#libraryBreadcrumb",
  libraryUpBtn: "#libraryUpBtn",
  librarySearchInput: "#librarySearchInput",
  librarySortSelect: "#librarySortSelect",
  libraryGridViewBtn: "#libraryGridViewBtn",
  libraryListViewBtn: "#libraryListViewBtn",
  // Comments
  commentsSection: "#commentsSection",
  commentComposerInput: "#commentComposerInput",
  postCommentBtn: "#postCommentBtn",
  commentsCount: "#commentsCount",
  // ...
};
```

**Rules when changing UI:**

1. **If you change an `id`, class, or button text that a selector relies on, update `studio-selectors.mjs` and the corresponding spec.**
2. **If you rename a button or dialog, update the spec expectations** (e.g., the publish flow waits for a dialog titled `Name Your Asset` and an input with class `.dialog-input`).
3. **If you change the save/publish flow** (e.g., add an extra confirmation step, remove the name dialog, or move it to settings), update `03-save-and-publish.spec.js` to match the new flow.
4. **If you change the chat/status feedback messages** (e.g., `Model carved via mock`, `Draft saved`, `Asset published and minted`), update the `toContainText` assertions in the specs.
5. **If you add a new mandatory step before generation/save/publish**, add the corresponding test step or helper.

### Manifest validators must match the backend schema

`e2e/helpers/manifest.mjs` encodes the expected fractal manifest shape. If you change the manifest schema:

- Add/remove fields in `assertGenerationManifest`.
- Update version expectations in `assertSavedManifest` (currently expects version `2` after one save).
- Update `assertPublishedManifest` if thumbnail or publish metadata changes.

### Test flow assumptions

The current specs assume:

- Save Draft does **not** prompt for a name; it uses the current name.
- First-time Publish **does** prompt for a name via the GNOME dialog.
- The mock provider maps the prompt `cowboy` to a valid GLB asset.
- Free-tier generation calls `recordGeneration()` and the backend validates the free-tier event.

If any of these assumptions change, the specs must change with them.

---

## Running in UI mode for debugging

```bash
bunx playwright test --config=e2e/playwright.config.js --project=chromium --ui
```

Use this when a spec fails and you need to inspect the browser state, DOM, network requests, or console logs.

---

## Test environment

- **Browser:** Chromium (headless by default).
- **Base URL:** `http://127.0.0.1:9090`.
- **Network:** Hardhat Local (`chainId: 31415822`).
- **Wallet:** Hardhat dev account `#0` (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`).
- **3D generation:** Mock adapter (`MOCK_3D_GENERATION=true`).
- **Timeouts:** 90 s per test, 15 s per expect assertion (publish waits 30 s for the transaction). The multi-wallet / live-update specs raise their per-test timeout via `test.setTimeout`: 150 s (13), 180 s (14), 240 s (23), 360 s (24).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `Backend not reachable on 9090` | Global setup failed to start the backend; check Docker/IPFS/Hardhat are healthy. |
| `a foreign backend is occupying http://127.0.0.1:9090` | A dev server (e.g. `start-dev.sh` — especially `--testnet`, which runs Pinata + Base Sepolia) is already on the port. Global setup only reuses E2E-compatible backends (kubo IPFS, mock generation, this worker's Hardhat RPC). Stop the dev server and re-run. |
| `Payment validation failed` | `CONTRACT_ADDRESS` in backend config points to the paid contract instead of `ArbeskAssetFree`; run setup again so configs are repatched. |
| `locator('#chatHistoryList')` does not contain `Model carved via mock` | Generation failed; check backend logs for the actual error. |
| Dialog `.dialog-input` not found | Save/publish flow changed or the dialog did not open; verify UI behavior manually. |
| Manifest version mismatch | Versioning logic changed; update `assertSavedManifest`. |

---

## See also

- `e2e/playwright.config.js` — Playwright configuration, timeouts, retries, projects, global setup/teardown.
- `e2e/global-setup.mjs` — Infrastructure setup, clean-chain reset, contract address sync, backend launch.
- `e2e/global-teardown.mjs` — Backend shutdown and container teardown.
- `e2e/lib/infra.mjs` — Shared infra helpers (container checks, chain reset, setup↔teardown state handoff).
- `e2e/fixtures/hardhat-provider.mjs` — Injected wallet provider implementation.
- `e2e/helpers/studio-selectors.mjs` — UI selector map.
- `e2e/helpers/manifest.mjs` — Manifest fetch + validation helpers.
- `docs/API_SPEC.md` — Backend API contract used by the specs.
- `docs/ARCHITECTURE.md` — Fractal manifest and smart-contract architecture.

# Arbesk End-to-End (E2E) Tests

> **Critical path coverage:** wallet connection → free-tier generation → save draft → publish ERC-721 token → library collection/asset browser.
>
> Run these tests **before any major change** that touches the Studio UI, library page, wallet flow, generation pipeline, save/publish logic, smart-contract integration, or IPFS manifest shape.

---

## Quick start

From the repo root:

```bash
npx playwright test --config=e2e/playwright.config.js --project=chromium
```

The global setup (`e2e/global-setup.mjs`) delegates infrastructure boot to `scripts/start-dev.sh --setup-only`, which:

1. Tears down any existing worktree containers for a clean start.
2. Starts Docker (IPFS + Hardhat + Nostr), resets the Hardhat chain to genesis.
3. Compiles and deploys fresh `ArbeskAssetFree` + `ArbeskAsset` + `MockUSDC`.
4. Syncs deployed addresses to `.env` files and JS network configs.
5. Builds the frontend.
6. Exits (no backend — global-setup then starts the Express backend with `MOCK_3D_GENERATION=true`).

You can also run the setup standalone to pre-warm the environment:

```bash
./scripts/start-dev.sh --setup-only
```

The global teardown (`e2e/global-teardown.mjs`) stops the backend and brings the Docker containers down (only if this run started them).

No manual `node src/index.js` is required.

---

## Git worktrees

E2E is worktree-aware. Each checkout gets its own Docker Compose project, its own backend port, and its own handoff state file, so tests from one worktree do not silently reuse containers, contracts, or a running backend from another worktree.

- The main checkout keeps the familiar `http://127.0.0.1:9090` backend port.
- Linked worktrees automatically receive a deterministic backend port in the `30000–40000` range.
- Docker containers are named by the Compose project (`arbesk-<worktree-id>_*`) instead of the old global `arbesk-hardhat`, `arbesk-private-ipfs`, and `arbesk-nostr-relay` names.

To create a worktree already seeded with the current working-tree state, environment files, built frontend, and compiled contracts, use the helper script:

```bash
npm run worktree:create -- feature-xyz
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

> **Note:** Hardhat (`8545`), IPFS (`5001`/`8080`), and Nostr (`7777`) still use fixed host ports. True concurrent E2E runs across worktrees on the same machine require stopping one stack before starting another; the isolation guarantees that each stack uses the correct worktree's files.

---

## What the tests cover

### 1. Wallet connection (`e2e/specs/01-connect-wallet.spec.js`)

Validates the full wallet-discovery and authentication path:

- Injects a Hardhat-backed EIP-1193/EIP-6963 provider into the browser.
- Opens `/studio.html`.
- Confirms the Studio auto-connects and authenticates via SIWE.
- Asserts the **Connect Wallet** button is hidden and the **Disconnect Wallet** button shows the connected address.

**Why it matters:** Any change to `wallet-discovery.js`, `wallet-connect.js`, `siwe.js`, the headerbar wallet buttons, or the SIWE session flow can break this. If this spec fails, every subsequent spec fails because they all depend on being logged in.

### 2. Asset generation (`e2e/specs/02-generate-asset.spec.js`)

Validates free-tier mock generation end-to-end:

- Types `cowboy` into the prompt input and clicks **Generate asset**.
- Confirms the chat history shows the prompt and `Model carved via mock`.
- Extracts the manifest CID from `?manifest=baf...` in the URL. The exact CIDv1 prefix depends on the IPFS backend (e.g. `bafy...` for dag-pb, `bafkrei...` for raw JSON).
- Fetches the manifest from the local IPFS gateway.
- Validates the manifest structure (asset_id, version, timestamp, one `source_asset` node, source CID/format, 16-element transform matrix, node name contains the prompt).

**Why it matters:** This exercises the prompt UI, free-tier `recordGeneration()` transaction, backend validation, mock adapter, IPFS add/pin, and manifest schema. Changes to any of those can invalidate the generated manifest shape or the UI feedback that the spec waits on.

### 3. Save and publish (`e2e/specs/03-save-and-publish.spec.js`)

Validates the full draft-save → publish → on-chain token lifecycle:

1. Generates `cowboy` (same as Spec 2).
2. Clicks **Save Draft** and waits for the screen-reader status to say `saved`.
3. Extracts the new manifest CID from the URL and asserts it is different from the generation CID.
4. Validates the saved manifest is version `2` and links back to the generation CID via `prev_asset_manifest_cid`.
5. Clicks **Besk it** (publish), fills the **Name Your Asset** dialog with `Cowboy Test`, and confirms.
6. Waits for the status to say `published`.
7. Extracts the hex token ID from `?asset=0x...` in the URL.
8. Calls `GET /api/v1/tokens/<tokenId>/manifest` to resolve the on-chain `tokenURI`.
9. Asserts the published manifest name is `Cowboy Test` and validates its structure.

**Why it matters:** This is the most complex spec. It touches the save button, publish button, name dialog, parametric versioning, thumbnail capture, ERC-721 minting, and the token URI resolution API. UI changes to any of those controls or changes to the manifest schema/versioning logic can break it.

### 4. Parametric versioning + time-travel (`e2e/specs/04-parametric-version.spec.js`)

Validates two of the platform's Golden Rules — **Parametric Coexistence** and **Temporal Isolation**:

1. Generates `cowboy` (version 1).
2. Selects the node in the **Outliner**, which auto-opens the component colour editor.
3. Changes the colour and **Save**s — asserts a new version `2` whose `prev_asset_manifest_cid` is the generation CID.
4. Asserts the version slider (`#historySlider`) now spans two versions and the badge shows `v2`.
5. Scrubs the slider back to index `0` and asserts the badge follows to `v1` (and forward again to `v2`).

**Why it matters:** Colour/scale edits are first-class versions, and the slider is the app's sole version-control surface. Changes to `parametric-preview.js`, `asset-history.js`, the outliner selection path, or version-chain logic can break it.

### 5. Republish existing token (`e2e/specs/05-republish.spec.js`)

Validates the edit → **republish** branch (no new mint):

1. Generates, saves, and publishes a token.
2. Edits the published asset's colour.
3. Clicks **Besk it** again — an already-named token skips the dialog and calls `updateAssetURI` instead of minting.
4. Polls `GET /api/v1/tokens/<tokenId>/manifest` until the on-chain version increases; asserts the same name, a newer version, and an unchanged `?asset=<tokenId>` anchor.

**Why it matters:** Spec 3 only covers the first mint. The republish path (`updateAssetURI`) is a distinct on-chain flow; changes to `asset-save.js`'s publish branch or the token-URI API can break it.

### 6. Nesting / linked child worlds (`e2e/specs/06-nesting.spec.js`)

Validates the "dollhouse architecture" — linking a token as a child world and navigating depth:

1. Publishes a world to use as the child reference.
2. Starts a fresh parent (**New asset** → name), generates the parent's own content.
3. Uses the gallery card's **Add to Scene** to link the child token into the parent.
4. **Save**s and asserts the parent manifest gains a `child_ref` node with a 16-element identity `transform_matrix` and **no** local `history`.
5. Selects the child node and **dives** (`#inspectorDiveBtn`) — asserts the back button reveals and the `nesting:didDive` event fires at depth 1.
6. **Ascends** via the back button — asserts it hides and `nesting:didAscend` fires at depth 0.

**Why it matters:** Token child nodes (`child_ref`, `transform_matrix`, depth gating) are the core fractal-nesting data model. Changes to `nesting.js`, `scene-graph.js` linked-asset handling, the token resolver, or the child-node manifest shape can break it.

> **Note:** the outliner only renders a linked child node **after a save** (it refreshes on `ASSET_DRAFT_SAVED`, not on `SCENE_TOKEN_CHILD_ADDED`), so the spec saves before locating the child node.

### 7. Collection/asset model (`e2e/specs/07-collection-assets.spec.js`)

Validates that every ERC-721 token is a collection manifest containing one or more asset manifests:

1. Publishes a first asset and asserts the on-chain `tokenURI` resolves to a collection manifest with at least one entry.
2. Publishes a second asset and asserts it lands in the **same** default collection token without disturbing the first asset.
3. Opens the published token in the gallery, clicks an asset card, and asserts the Studio viewport loads the asset name.
4. Uses **New Asset** to clear the scene while preserving the selected collection context, then publishes again into the same collection.
5. Reloads `?asset=TOKENID` and asserts the viewport restores the first asset.
6. Asserts the collection selector populates on wallet connect with the wallet-derived default collection ID.

**Why it matters:** This is the only spec that exercises the collection manifest shape end-to-end, the `activeAssetId` → collection `assets` map, and the gallery asset-card deep-link into the Studio. Changes to `asset-save.js`, `collection-publish.js`, the collection selector, or the gallery card rendering can break it.

### 7b. Material editor: multi-primitive mesh color override (`e2e/specs/07-material-editor-multi-primitive.spec.js`)

Regression test for issue #25: `applyMeshOverrideColors()` must update **all** primitives of a mesh, not just the first matching one.

- Dynamically imports `material-editor.js` in the browser and runs it against a minimal two-primitive, two-material glTF fixture.
- Asserts both materials receive the override color.
- Also validates the `defaultColor` baseline branch.

**Why it matters:** A pure-JS regression test that protects the color-editing pipeline without requiring wallet setup or IPFS writes. Changes to `material-editor.js`, especially `findMaterialByMeshName()` or `applyMeshOverrideColors()`, can break it.

### 8. Fork vs live reference (`e2e/specs/08-fork-live-ref.spec.js`)

Validates the two ways to reuse another collection's asset inside a parent scene:

1. Publishes a child world.
2. Starts a fresh parent draft and uses the gallery card's **Add to Scene**.
3. **Fork (copy)** — asserts the parent manifest stores a `source` node with a frozen CID, no `child_ref`, and no local `history`.
4. **Live reference** — asserts the parent manifest stores a `child_ref` node pointing at the child's collection/token/assetID, with a 16-element `transform_matrix` and no `source` or `history`.

**Why it matters:** Fork/live-ref is the core fractal-reuse mechanism. Changes to `nesting.js`, the gallery card actions, the fork/live-ref dialog, or the `child_ref` schema can break it.

### 9. Library basics (`e2e/specs/09-library-basics.spec.js`)

Validates the Nautilus-style collection browser on `/library.html`:

1. Confirms the wallet gate appears before connection and auto-connects via injected provider.
2. Asserts the wallet-derived default collection is labeled **Default**.
3. Publishes an asset in Studio and verifies it appears inside **Default** in the library.
4. Tests breadcrumb navigation and the **Up** button to return to the collection list.
5. Tests search filtering (matching and empty states).
6. Tests grid/list view toggle and sort-by-name.

**Why it matters:** `library.html` is a standalone page with its own state, routing, and selection model. Changes to `library-init.js`, `library-grid.js`, `library-toolbar.js`, or the wallet gate can break this.

### 10. Library asset actions (`e2e/specs/10-library-asset-actions.spec.js`)

Validates the context-menu actions available on library assets:

1. **Rename** — opens the GNOME dialog, changes the asset name, and asserts the grid updates.
2. **Delete** — confirms deletion and asserts the asset is removed from the collection (NFT is not burned).
3. **Open in Studio** — navigates to `/studio.html?asset=TOKEN&assetId=ID` and asserts the asset loads.
4. **Send to Collection…** — with only the default collection present, asserts a warning toast explains that another collection is required.

**Why it matters:** These actions exercise `library-context-menu.js`, `services/asset-delete.js`, collection manifest updates, and the Studio deep-link handling.

### 11. Library ↔ Studio round-trip (`e2e/specs/11-library-studio-roundtrip.spec.js`)

Validates the publish-in-Studio / browse-in-Library / open-in-Studio loop:

1. Publishes an asset in Studio, then asserts it appears in the library and in the on-chain collection manifest.
2. Opens the asset from the library and asserts the Studio URL contains both `asset` and `assetId`, and the asset name appears in the status bar.

**Why it matters:** This verifies the library is not just a read-only gallery but a true entry point back into the Studio editor. Parametric republish flows are covered in Spec 5.

### 12. Library create collection and upload (`e2e/specs/12-library-create-upload.spec.js`)

Validates the new Library toolbar flows for collection creation and desktop file upload:

1. Clicks **New Collection**, names it, and confirms.
2. Asserts the new collection is minted and the browser navigates into it.
3. Uses the **Upload** button to select `mock-gltf-assets/howdy.glb` from disk.
4. Asserts the uploaded file appears as an asset named `howdy` inside the collection.
5. Opens the uploaded asset in Studio and asserts it loads.
6. Asserts clicking **Upload** at the collection root shows a warning toast instead of opening the file picker.

**Why it matters:** These flows exercise `library-toolbar.js`, `library-ops.js`, browser-side IPFS writes, `publishAsset` for named collections, `updateAssetURI` for adding assets, and the file input wiring. They are the only automated coverage for desktop file uploads.

### 13. Editor collaboration (`e2e/specs/13-editor-collaboration.spec.js`)

Validates the Merkle-editor authorization flow across three wallets:

1. **Owner** publishes an asset.
2. **Owner** adds a second wallet as an editor via the collaborators panel.
3. **Editor** opens the shared asset, edits a node colour, and republishes — asserts the on-chain collection manifest version increases.
4. **Outsider** (third wallet) opens the same asset, attempts to republish, and is rejected with `Not an authorized editor`; asserts the on-chain version does **not** advance.

**Why it matters:** This is the only multi-wallet E2E coverage for the Merkle editor-list feature. Changes to `editor-publish.js`, `team.js`, `merkle-editors.js`, the collaborator UI, or the republish authorization path can break it.

---

## When you MUST run these tests

Run the E2E suite **before merging** any PR that changes:

- **Studio UI/UX:** headerbar buttons, chat history, prompt input, settings panel, dialogs, wallet controls.
- **Library page:** `library.html`, `library-init.js`, `library-grid.js`, `library-toolbar.js`, `library-context-menu.js`, collection/asset rendering, search/sort/view controls.
- **Wallet integration:** EIP-1193/EIP-6963 discovery, `wallet.js`, `wallet-connect.js`, `wallet-discovery.js`, `siwe.js`, session auth.
- **Generation flow:** `create-panel.js`, generation API, transaction validation, mock adapter, provider selection.
- **Save/publish logic:** `asset-save.js`, `dialog.js`, manifest versioning, thumbnail capture.
- **Smart contracts or ABI:** `ArbeskAssetFree.sol`, `ArbeskAsset.sol`, deployment scripts, contract addresses.
- **Manifest schema:** `scene.nodes`, `source_asset`, `transform_matrix`, `prev_asset_manifest_cid`, `thumbnail`, `child_ref`, `comments_archive_cid`.
- **IPFS integration:** storage format, CID encoding, pin/unpin behavior.

Running `npm test` (unit/Jest) and `npm run test:contracts` is **not enough** for these areas. The E2E specs are the only automated coverage that validates the full browser → wallet → backend → blockchain → IPFS chain.

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
npx playwright test --config=e2e/playwright.config.js --project=chromium --ui
```

Use this when a spec fails and you need to inspect the browser state, DOM, network requests, or console logs.

---

## Test environment

- **Browser:** Chromium (headless by default).
- **Base URL:** `http://127.0.0.1:9090`.
- **Network:** Hardhat Local (`chainId: 31415822`).
- **Wallet:** Hardhat dev account `#0` (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`).
- **3D generation:** Mock adapter (`MOCK_3D_GENERATION=true`).
- **Timeouts:** 10 s per test, 5 s per expect assertion (publish waits 30 s for the transaction).

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `Backend not reachable on 9090` | Global setup failed to start the backend; check Docker/IPFS/Hardhat are healthy. |
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

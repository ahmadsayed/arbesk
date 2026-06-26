# Keeping E2E Tests in Sync with UI Changes

The Playwright E2E suite (`e2e/`) is the **only** automated coverage of the full
browser → wallet → backend → blockchain → IPFS path. It depends on a stable
selector map and a known user flow. If you change the UI and don't update the
tests, you either break the suite or — worse — leave a real regression uncovered.

**Treat `e2e/helpers/studio-selectors.mjs` as a public API.** The specs reference
elements by the ids/classes/labels in that file. Renaming an `id`, changing a
button label, reordering a flow, or changing a status message is a breaking
change to that contract.

## When you MUST update the E2E tests

Update + run the suite before merging any change that touches:

- **Headerbar / shell**: wallet buttons, asset name/status, version slider, New/Save/Publish buttons.
- **Wallet + session**: connect/disconnect, SIWE, the discovery flow.
- **Generation**: prompt input, Generate button, chat status text (`Model carved via mock`), provider/tier selects.
- **Save / publish / republish**: Save Draft, Besk it, the Name dialog, version semantics, thumbnail capture.
- **Gallery cards**: card markup, `data-token-id`, Add to Scene / Burn buttons, the burn confirm dialog.
- **Outliner**: node rows, child-node labels, selection behavior.
- **Parametric editor**: component color editor, the node-selection → editor path.
- **Nesting**: Add to Scene, dive (`#inspectorDiveBtn`), back button, breadcrumb, the `nesting:*` events.
- **Manifest schema**: `scene.nodes`, `source_asset`, `child_ref`, `transform_matrix`, `prev_asset_manifest_cid`, `thumbnail`, `comments_archive_cid`, version numbering.
- **Comments panel**: `commentsSection`, `commentComposerInput`, `postCommentBtn`, `commentsCount`.

`npm test` (Jest) is **not** enough for any of the above.

## UI area → spec → selectors map

| If you change… | Spec(s) to update | Selectors / signals it relies on |
|----------------|-------------------|----------------------------------|
| Wallet connect/disconnect buttons, SIWE | `01-connect-wallet` | `connectWalletBtn`, `disconnectWalletBtn` |
| Prompt input, Generate, chat status | `02`, `03`, `04`, `05`, `06` | `promptInput`, `generateBtn`, `chatHistoryList`, text `Model carved via mock` |
| Save / Publish / Name dialog | `03`, `05`, `06` | `saveAssetBtn`, `publishAssetBtn`, `dialogInput`, `dialogConfirmBtn`; URL `?manifest=`, `?asset=` |
| Gallery cards, Burn, Add to Scene | `03` (burn), `06` (add) | `assetCard` + `[data-token-id]`, `assetCardName`, `assetCardBurnBtn`, `dialogBurnBtn`, button `Add to Scene` |
| Outliner tree / node rows | `04`, `06` | `outlinerSwitcherBtn`, `outlinerNode` |
| Parametric component color editor | `04`, `05`, `06` | `componentEditor`, `componentColorInput` |
| Version slider / time-travel | `04` | `assetHistory`, `historySlider`, `historyVersionBadge` |
| New asset, dive/ascend breadcrumb | `06` | `newAssetBtn`, `inspectorDiveBtn`, `backBtn` |
| Manifest shape / versioning | matching spec + `e2e/helpers/manifest.mjs` | the validators in `manifest.mjs` |
| Comments panel / composer | `14`, `15` | `commentsSection`, `commentComposerInput`, `postCommentBtn`, `commentsCount` |

## The four-step sync workflow

1. **Selectors** — if you renamed/added/removed an `id`, class, or button label, update `e2e/helpers/studio-selectors.mjs`.
2. **Assertions** — if you changed status text, dialog titles, or flow order, update the affected spec's `toContainText` / `waitForURL` / dialog steps.
3. **Schema** — if you changed the manifest shape or version semantics, update the validators in `e2e/helpers/manifest.mjs`.
4. **Run it** (the build is automatic in global setup):

```bash
npx playwright test --config=e2e/playwright.config.js --project=chromium
# debug a failure visually:
npx playwright test --config=e2e/playwright.config.js --project=chromium --ui
```

## Behaviors that bite when writing/maintaining these specs

- **Wait on durable state, not transient text.** Read query params via `page.waitForURL(...)`, not a synchronous `page.url()` after a text assertion. The `#srStatus` live region is cleared/overwritten between steps — don't assert on it as a flow gate.
- **Token ids have two representations.** Publish writes the id to the URL in **hex** (`?asset=0x…`); the gallery lists the same token by its **decimal** on-chain id and tags cards `data-token-id="<decimal>"`. Compare numerically (`BigInt(a) === BigInt(b)`); scope gallery cards by `[data-token-id="<decimal>"]`.
- **Outliner labels child nodes `Token #<id>`** — not the child's manifest name. Locate child nodes by token id.
- **The outliner only renders a linked child node after a save** (it refreshes on `ASSET_DRAFT_SAVED`, not `SCENE_TOKEN_CHILD_ADDED`). Save before locating a freshly added child.
- **`emit()` dispatches `CustomEvent`s on `document`** — capture lifecycle events (e.g. `nesting:didDive`) with a `document.addEventListener` installed via `page.evaluate` before the action.
- **Generation is limited to 10/wallet/hour** by the backend; global setup resets it via `POST /api/v1/test/reset-rate-limit`, which **must** send `Content-Type: application/json` (the `/api/v1` router enforces it) or the reset 415s silently and the limit accumulates across runs.

See `e2e/README.md` for the full per-spec contract.

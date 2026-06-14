# Arbesk End-to-End (E2E) Tests

> **Critical path coverage:** wallet connection → free-tier generation → save draft → publish ERC-721 token.
>
> Run these tests **before any major change** that touches the Studio UI, wallet flow, generation pipeline, save/publish logic, smart-contract integration, or IPFS manifest shape.

---

## Quick start

From the repo root:

```bash
npx playwright test --config=e2e/playwright.config.js --project=chromium
```

The global setup (`e2e/setup.mjs`) will:

1. Start IPFS + Hardhat Docker containers if they are not running.
2. Deploy/verify the Arbesk smart contracts on Hardhat Local.
3. Patch `frontend/src/js/blockchain/network-config.js` and `src/config.js` with the deployed addresses.
4. Build the frontend.
5. Start the Express backend with `MOCK_3D_GENERATION=true`.
6. Tear everything down after the tests finish.

No manual `node src/index.js` is required.

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
- Extracts the manifest CID from `?manifest=Qm...` in the URL.
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

---

## When you MUST run these tests

Run the E2E suite **before merging** any PR that changes:

- **Studio UI/UX:** headerbar buttons, chat history, prompt input, settings panel, dialogs, wallet controls.
- **Wallet integration:** EIP-1193/EIP-6963 discovery, `wallet.js`, `wallet-connect.js`, `wallet-discovery.js`, `siwe.js`, session auth.
- **Generation flow:** `create-panel.js`, generation API, transaction validation, mock adapter, provider selection.
- **Save/publish logic:** `asset-save.js`, `dialog.js`, manifest versioning, thumbnail capture.
- **Smart contracts or ABI:** `ArbeskAssetFree.sol`, `ArbeskAsset.sol`, deployment scripts, contract addresses.
- **Manifest schema:** `scene.nodes`, `source_asset`, `transform_matrix`, `prev_asset_manifest_cid`, `thumbnail`.
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

- `e2e/playwright.config.js` — Playwright configuration, timeouts, projects, global setup/teardown.
- `e2e/setup.mjs` — Infrastructure setup, contract address sync, backend lifecycle.
- `e2e/fixtures/hardhat-provider.mjs` — Injected wallet provider implementation.
- `e2e/helpers/studio-selectors.mjs` — UI selector map.
- `e2e/helpers/manifest.mjs` — Manifest fetch + validation helpers.
- `docs/API_SPEC.md` — Backend API contract used by the specs.
- `docs/ARCHITECTURE.md` — Fractal manifest and smart-contract architecture.

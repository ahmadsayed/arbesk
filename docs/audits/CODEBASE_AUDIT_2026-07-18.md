# Arbesk Codebase Audit Report — 2026-07-18

> **Status: IMPLEMENTED (2026-07-18).** §6 action-order items 1–5 (except the address-sync dedup, see below) plus the safe parts of 6 were executed and verified: 93 Jest suites / 1185 tests, 57 frontend suites / 684 tests, 48/48 contract tests, lint + both typechecks all green.
>
> Deliberately NOT done (open decisions / follow-ups):
> - ~~`/api/v1/ipfs/unpin` ownership check~~ — **IMPLEMENTED (2026-07-18, post-audit):** the route now verifies on-chain ownership/editor rights via `checkAssetAccess` (session wallet, optional Merkle proof) and requires the CID to belong to the claimed token's collection; the frontend burn flow unpins *before* the burn tx (§1 item 4). Caller-supplied `contractAddress` is allowlisted against the chain's configured contracts (free + paid) to block fake-contract spoofing; when omitted, both tiers are tried in order.
> - `/api/v1/ipfs/unpin` residual anchor-spoofing risk — accepted + documented in the route docstring: membership anchors (tokenURI, collection `assets` map) are attacker-settable for the attacker's OWN token at gas cost with on-chain attribution (`updateAssetURI` does no URI validation; fork mode legitimately shares asset CIDs). Full closure needs reachability-based deletion (GC semantics) — mainnet follow-up, no route-level fix planned.
> - ~~`/api/v1/paymaster` gating~~ — IMPLEMENTED (2026-07-18): session auth + wallet-keyed rate limit (`PAYMASTER_RATE_LIMIT_MAX`, default 30/min) + `pm_*` method allowlist.
> - ~~`MAX_EDITORS_PER_TOKEN`~~ — RESOLVED (2026-07-18, option B+C): on-chain constant kept as documentation (no redeploy churn); client-side cap of 5000 enforced in `frontend/src/js/gltf/merkle-editors.js` (`computeRoot` throws above the cap) and `frontend/src/js/services/team.js` (`addTeamMember` early error). Not a security boundary — proof cost is O(log n) at any size; the cap guards browser/IPFS practicality.
> - ~~`Pausable` scope~~ — RESOLVED (2026-07-18): keep payment-only pause (already documented in contract NatSpec). Full-surface pause rejected — freezing `burn` during an incident is worse than the disease. Contingency if an NFT-surface exploit ever appears: pause mint/editor ops only, keep burn live, bundled into whatever redeploy follows.
> - `@ts-nocheck` burn-down (94% of frontend files) — policy decision, untouched.
> - ~~`ipfs/remote-ipfs.js` disabled LRU cache~~ — RESOLVED (2026-07-18): dead cache code deleted. Redundant with the browser HTTP cache (Kubo serves immutable cache headers for CID content), inflight request coalescing, and the glTF pipeline's `content-cache.js`.
> - web3→viem consolidation — noted as optional long-term refactor, not started.
> - Address-sync dedup between `scripts/sync-deployed-addresses.mjs` and `e2e/global-setup.mjs` (§6 item 5) — left as-is; the two implementations still drift independently.
> - ~~E2E suite~~ — RUN (2026-07-18): 35/35 Playwright tests passed on a single worker (6.5 min) covering the full browser → wallet → backend → blockchain → IPFS chain after both contract-change rounds. Note: the testnet indexer state carries 19 tokens from the OLD contract address — reset the indexer state (`.data/`) if you want a clean testnet view after the no-migration redeploy.
> - Before-mainnet items: backend payment verification before real cloud adapters, multisig owner. (The `publishAsset` zero-root guard WAS added.)
> - ~~`updateEditors` also accepts a zero root~~ — IMPLEMENTED (2026-07-18): `ZeroEditorRoot` guard added (base contract, covers both tiers) + contract test. Deployed to Base Sepolia as a fresh breaking deployment (no migration): `0xa39eFfc859b326CCCeB177CfBbef00C1876e18d8` (block 44309130), verified on Basescan; `DEPLOYMENT_BLOCKS[84532]` updated accordingly.
> - Token-owner Merkle-proof bypass — CONSIDERED AND REJECTED (2026-07-18): the token owner intentionally is NOT an implicit editor; the editor set stays transfer-independent (sell an NFT without transferring edit rights). Lockout risk from a lost editor list is accepted — mitigated by the list being pinned on IPFS and referenced on-chain via `editorListURI`.

Read-only audit of the full codebase: backend (`src/`), frontend (`frontend/src/`), blockchain (`blockchain/`), and tooling (`scripts/`, `e2e/`, `docker/`, package manifests). All "dead code" claims were grep-verified across the repo (including `test/` and `e2e/`) before inclusion. No code was changed.

---

## Overall verdict

The architecture is in good shape. The client-side-first / thin-gatekeeper split is genuinely honored, the contract inheritance model is clean (the Merkle redesign eliminated all unbounded on-chain loops), the E2E/worktree isolation infrastructure is well-engineered, and the obvious library-replacement candidates are **already done** — rate limiting (`express-rate-limit`), SIWE (`siwe` + `viem`), validation (Zod), Merkle trees (`@openzeppelin/merkle-tree`). The real problems are: **dependency hygiene** (phantom + unused packages), **stale docs/artifacts from the pre-Merkle era**, **dead code left by the Library redesign**, and **copy-paste duplication** in a handful of hotspots.

---

## 1. Critical / fix-first items

Latent breakages, not style issues:

1. **Phantom dependencies — imports of packages not declared in any package.json.** They work today only via hoisting and will break under pnpm or a transitive tree change:
   - `viem` — imported by `src/config.js:12` and `src/api/siwe-verify.js:11` (hoisted via CDP/Reown deps)
   - `web3-utils` — `src/api/merkle-editors-node.js:9` (hoisted via `web3`)
   - `istanbul-lib-coverage`, `istanbul-lib-report`, `istanbul-reports` — `scripts/merge-e2e-coverage.mjs:4-8`, `scripts/merge-all-coverage.mjs`, `e2e/fixtures/coverage.mjs` (hoisted via `jest`)
   - `playwright` — `frontend/scripts/render-landing-models.js:29` (hoisted via `@playwright/test`)

2. **`blockchain/scripts/gas-check.js` is broken** — calls the removed `addEditor()` and the old 2-arg `publishAsset()`, and uses a non-existent `maxEditorsPerToken()` getter (`gas-check.js:44-88`). Pre-Merkle leftover; delete.

3. **`blockchain/SECURITY.md` is entirely stale and now misleading** — every finding describes removed code (`usedPayments`, `ERC721Enumerable`, `MAX_TOKENS_PER_EDITOR`, on-chain editor arrays, 2-arg `publishAsset`). A wrong security doc is worse than none. Rewrite for the Merkle design or delete; only the multisig recommendation (§4) remains valid.

4. **`POST /api/v1/ipfs/unpin` has no ownership check** — `src/api/routes/ipfs.js:113`. Any session holder can unpin any CID's manifest chain, making it GC-eligible (cross-user data deletion). The ownership/Merkle machinery already exists in `src/api/authorization.js`. The frontend only calls it after burning its own token, so it is a missing defense-in-depth check — but `AGENTS.md §2` itself lists unpin as *the* canonical cross-user action.

5. **Manifest Zod schema drifted from reality** — `src/api/schemas.js:88-135`: `thumbnail` is typed as a string but is actually an object `{cid, ...}` (written at `frontend/src/js/services/asset-save/manifest-builder.js:587`, read at `src/api/manifest-chain-walker.js:157`). Consequence: spurious `[WALK]` validation warnings on every unpin/GC walk. `historyEntrySchema` also lacks the `src: {cid, bundleCid}` shape, and the schema keeps both `prev_manifest_cid` and `prev_asset_manifest_cid` while only the latter is used.

6. **`test:e2e:setup` npm script points to a missing file** (`e2e/setup.mjs` does not exist) — `package.json:24`. Running it fails with `Cannot find module`.

---

## 2. Architecture observations

### Backend — clean layering, but:

- **Error-shape inconsistency**: `src/api/routes/indexer.js:67,108` returns `error` as a **string**; every other route uses the structured `sendError` shape. `authentication.js`, `sessions.js`, `generate-node.js` hand-roll the same JSON inline instead of calling `sendError` (4 copies).
- **Magic chain IDs** in the files that should know better (`AGENTS.md` mandates `CHAIN_IDS` from `constants/chains.js`): `src/api/authorization.js:42-44`, `src/api/chat-proxy.js:66`, `src/api/routes/comments.js:55` all hardcode `31415822`.
- `src/api/routes/indexer.js` `/owned` and `/shared` are ~40 lines of verbatim copy-paste (the entire catch-up throttle block) — extract a `withFreshIndexer()` helper.
- `src/api/routes/contracts.js:13-19` constructs a new `abiRouter()` per request behind a `@ts-ignore`; mount once instead.
- Dormant `/api/v1/paymaster` route (`src/api/routes/paymaster.js:23`) has no auth and no rate limit — gate it *before* ever exposing it publicly (it would spend the deployment's CDP paymaster quota).
- `src/api/ipfs-gc.js:69` uses the default web3 instance for `endBlock` while scanning a chain-specific contract — cross-chain inconsistency bug waiting for the first testnet GC run.
- Per-call `await import("./storage/index.js")` in `token-indexer.js:206` is unjustified indirection (static import is safe there).
- Indexer files prefix logs with `toLocaleTimeString()`; nothing else does. `siwe-verify.js:192-193` uses `console.log` for exceptions where the convention is `console.error`.

### Frontend — clean SPA bootstrap, but:

- `ui/asset-library.js` (1039 lines) is both the sidebar gallery view **and** the token data service; `fetchOwnedTokenIds` / `fetchTransferEvents` / `fetchAssetLibrary` / `expandTokenToAssets` are pure data-layer functions imported by `library-controller.js` from a sibling UI module — they belong in `services/`.
- Browser log-scan duplicates the backend indexer with a **contradicting** chunk size: `asset-library.js:45` hardcodes `EVENT_CHUNK_SIZE = 100` while `constants/chains.js` defines per-chain `LOG_CHUNK_SIZES` (10000 hardhat / 2000 Base Sepolia) precisely because Base Sepolia rejects wide spans.
- The `contract || walletState.get().contract` fallback is copy-pasted in 8 places across 7 files — one `getActiveContract()` in `wallet-core.js` ends the drift (one site, `version-history-store.js:31`, already diverged).
- **`// @ts-nocheck` on ~94% of frontend files** (106/113 non-vendor) — the `strict: true` typecheck gate is nearly inert for the frontend. Either burn it down file-by-file or state the policy explicitly.
- `services/api.js`: the session-fetch + 401-reauth pattern is copy-pasted 5× (`generateAsset:392`, `snapshotCommentsArchive:530`, `getUploadCredential:580`, `getUploadCredentials:624`, `unpinAssetCids:667`, ~25 lines each) — one `fetchWithSession()` helper removes ~100 lines.
- Over-long files: `asset-library.js` (1039), `scene-graph.js` (883), `model-clock-gizmo.js` (834), `gltf-worker.js` (827), `api.js` (707).
- `requireWallet` name collision — throwing guard (`blockchain/wallet-guard.js:18`) vs toast-based UI check (`asset-save.js:37`); different semantics, same name.

### Blockchain — contracts are solid, but:

OZ primitives used throughout, tight storage (4 slots/token, packed quota struct), correct `ReentrancyGuard` usage on all value-moving functions, tested Merkle replay protection (version-bump invalidation, tokenId-bound leaves). Issues:

- Duplication that belongs in the base: `InvalidPromptLength` / `InvalidNodeId` errors declared in both contracts + the same 3-line validation repeated 3× (`ArbeskAssetFree.sol:60-62`, `ArbeskAsset.sol:108-110,137-139`) → move `_validateGenerationInput()` + errors into `ArbeskAssetBase`.
- `Pausable` gates only payments/generation, not publishing / `updateAssetURI` / `updateEditors` / `burn` — either document as payment-pause-only or extend `whenNotPaused`.
- `publishAsset` accepts `editorRoot_ = bytes32(0)` and does not require the minter in the tree — a fat-fingered root permanently bricks the token (self-DoS only, low severity, one-line guard).
- `blockchain/test/ArbeskAsset.test.js:8-88` hand-rolls ~80 lines of Merkle helpers while the frontend already uses `SimpleMerkleTree` from `@openzeppelin/merkle-tree` — two implementations that must stay byte-compatible with `MerkleProof.sol` = drift risk. The test should import the library.
- **Backend never verifies on-chain payment/generation events** (`POST /api/v1/generations` checks session + rate limit only; BYOK bypasses entirely). Blast radius is zero today (only the mock adapter is wired; cloud returns 501) but must be wired before real cloud adapters land.
- `recordGeneration` evaluates `msg.sender != owner()` first (`ArbeskAssetFree.sol:72`) — an `owner()` SLOAD on every call; reordering to check the quota first skips it in the common case.
- `withdraw()` / `withdrawUSDC()` emit no events (minor).

### Tooling — dev-stack orchestration is well-built, but:

`start-dev.sh`, docker-compose loopback bindings, `create-worktree.sh`, and per-worker E2E stacks are genuinely solid engineering. Issues:

- Contract-address sync logic duplicated between `scripts/sync-deployed-addresses.mjs:44-69` and `e2e/global-setup.mjs:21-80` (same regexes, same targets — will drift).
- Worktree-id → compose-project derivation duplicated between bash (`start-dev.sh:32-39`) and Node (`e2e/lib/infra.mjs:27-49`) with subtly different sanitizers.
- Hardhat-RPC readiness wait and MockUSDC env cache-bust each implemented twice (shell + Node).
- Coverage npm-script sprawl: `test:coverage` = js+contracts while `test:coverage:all` = js+e2e — neither covers all three; `test:coverage:e2e` is a pure alias.
- Test layout inconsistency: ~10 frontend-domain Jest suites live at the `test/` root instead of `test/frontend/`; benchmark files (`*.bench.mjs`) live inside the test tree.
- The 9 benchmark scripts share ~30 lines of copy-pasted env-shim boilerplate each — if kept, extract `scripts/lib/bench-env.mjs`.

---

## 3. Dead code (all grep-verified)

### Safe deletes — backend

| Symbol | Location | Note |
|---|---|---|
| `validateParams` | `src/api/validation.js:57-70` | Zero imports anywhere |
| `hexStringSchema` | `src/api/schemas.js:16` | Zero references |
| `ASSETS_IPFS`, `IPFS_API_URL` exports | `src/config.js:152-153` | Callers re-read `process.env` directly |
| `getUsdcToken` | `src/config.js:90-96` | Only in a test's defensive module mock |
| `validateSession` re-export | `src/api/authorization.js:157` | Only importer uses `authorizeAssetAccess` |
| `apiAny._getFromIPFS` test hook | `src/api/index.js:95-98` | No test calls it; referenced only in a skill doc |
| Unreachable 400 checks | `src/api/assets/generate-node.js:43-51,61` | Zod schema already enforces (`min(1)`, `max(200)`) |
| Unused `_storage` param | `src/api/assets/generate-node.js:13` | — |
| Constant-true condition | `src/api/storage/kubo-adapter.js:50` | `result.cid` is always truthy |
| `INDEXER_DISABLE_TESTNET` | `src/config.js:54` | Read but set nowhere — undocumented kill-switch |

Test-only production exports (consider moving or accepting): `bumpManifestVersion` (`manifest-utils.js:27` — header comment is also stale), `parseSiweMessage` (`siwe-verify.js:37`), `createRateLimitMiddleware` (`rate-limiter.js:71`), `computeRoot` / `getProof` (`merkle-editors-node.js:50,72` — ~50 lines; production needs only `makeLeaf`/`verifyProof`).

### Safe deletes — frontend

**Legacy Library folder-model helpers (highest value):** `utils/library-items.js` — 4 of 8 exports (`isSupportedFile`, `getChildItems`, `sortItems`, `buildBreadcrumb`) operate on a `{folders, files}` state shape that `state/library-state.js` no longer has; production grew private same-named duplicates in `library-grid.js:168` and `library-toolbar.js:14` (drift trap). Its test file tests dead code.

| Symbol | Location |
|---|---|
| `scss/_studio-legacy.scss` | 1879 lines, not imported (only `styles.scss` compiles) |
| `scss/components/_timeline.scss` | Entire partial dead — `.version-badge` matches nothing; header admits the timeline was removed |
| `getNetworkName`, `getTxExplorerUrl`, `getTokenExplorerUrl`, `openExplorer` | `blockchain/explorer.js:29-84` |
| `getBlockExplorer`, `getSupportedChainIds` | `blockchain/network-config.js:68,85` |
| `isCdpInitialized`, `isCdpConnected`, `signSiweMessageWithCdp` | `blockchain/wallet-cdp.js:101,297,535` |
| `isWalletConnectConnected` | `blockchain/wallet-connect.js:193` |
| `clearWallets`, `stopDiscovery` | `blockchain/wallet-discovery.js:123,131` |
| `compressString`, `decompressToString` | `utils/compression.js:69,78` |
| `sha256Hex` | `utils/hash.js:249` |
| `TIER_NAMES`, `TIER_COSTS_USDC` exports | `blockchain/wallet-payments.js:461-462` |
| `applyManifestVersion` export | `engine/time-travel.js:201` |
| `registerMockNode` export | `engine/scene-graph.js:730` |
| `loadEditorListForToken`, `getEditorSetVersionForToken` | `services/asset-delete.js:198,202` |
| `COMMENT_THREAD_EVENTS` | `state/comment-thread.js:369` |
| `IPFS_CACHE_ENABLED = false` + ~50 lines LRU | `ipfs/remote-ipfs.js:27,85-135` — permanently-disabled cache path |
| `formats/handlers/example-format.js` | Copy-paste template shipped to `dist/` on every build; belongs in docs/fixtures |

Plus ~30 internal-only UI exports (`toggleSidebar`, `refreshOutliner`, `refreshLedger`, `addChatMessage`, `setTheme`/`getTheme`/`clearTheme`, `ascendOneLevel`/`resetNesting`, `openPopover`/`closePopover`, etc.) — harmless but inflate the public surface; E2E uses none of them.

### Safe deletes — blockchain

| Symbol | Location | Note |
|---|---|---|
| `paymentNonce` mapping + `getPaymentNonce()` + both increments | `ArbeskAsset.sol:53,112-115,144-147,165-167` | ~5k gas per payment for replay protection against nothing (vestige of removed `usedPayments` design) |
| Native-token payment path: `payForGeneration`, `costPerGeneration`, `setCost`, `CostUpdated`, `IncorrectPaymentAmount`, `TreasuryTransferFailed`, `withdraw()` | `ArbeskAsset.sol:28,32,45,103-127,171-176,198-203` | Zero callers anywhere — frontend pays USDC-only (`wallet-payments.js:358`) |
| `getAssetManifest()` | `ArbeskAssetBase.sol:99-112` | Frontend resolves via `tokenURI()` |
| `getTierCost()` | `ArbeskAsset.sol:161-163` | Duplicates the auto-generated `tierCosts(tier)` getter |
| `lastGenerationDay()` / `generationCountToday()` | `ArbeskAssetFree.sol:34-40` | Tests only |
| `MAX_EDITORS_PER_TOKEN` | `ArbeskAssetFree.sol:21`, `ArbeskAsset.sol:42` | Unenforced everywhere — delete, or enforce client-side in `merkle-editors.js` |
| Unreachable `TokenAlreadyMinted` guard in `initEditors` | `ArbeskAssetBase.sol:204-205` | `publishAsset`/`_mint` already revert on existing tokens; `burn` deletes the root |
| `deployments/megaethTestnet/`, `deployments/monadTestnet/` | git-tracked | Networks removed from `hardhat.config.js` / `constants/chains.js`; rejected by `deploy.js:26-31` |
| `verify.js` default contract | `blockchain/scripts/verify.js:5` | Defaults to `ArbeskAsset` (paid), which is never deployed on testnet; should default to `ArbeskAssetFree` |

### Safe deletes — tooling

- Unused deps (root `package.json`): `@walletconnect/ethereum-provider` (frontend loads from CDN deliberately — `wallet-connect.js:46,61`), `@noble/curves`, `@noble/hashes`, `@eslint/eslintrc`, `gltf-pipeline`, root `@gltf-transform/core` (frontend has its own declared copy).
- Unused deps (`frontend/package.json`): `mitt` (vendored `events/mitt.mjs` used instead — also undocumented in `vendor/README.md`), `javascript-obfuscator`.
- `scripts/apply-pinata-env.sh` — superseded by `start-dev.sh:134` (`--testnet` sources `.env.pinata` directly).
- Frontend browser-sync trio: `frontend/scripts/start.js`, `start-debug.js`, `sb-watch.js` + `browser-sync`/`chokidar`/`concurrently` devDeps — Start Bootstrap template leftovers; the documented workflow is `build:frontend` + Express serving `dist/`.
- 9 unreferenced one-off IPFS benchmark scripts in `scripts/` (~70 KB): `aggregate-size-comparison.mjs`, `compression-overhead-benchmark.mjs`, `compression-overhead-benchmark-pinata.mjs`, `dedup-size-comparison.mjs`, `store-15-variants.mjs`, `variant-ipfs-size-comparison.mjs`, `variant-pinata-size-comparison.mjs`, `variant-size-comparison.mjs`, `run-pinata-benchmark-from-env.mjs`. Archive under `scripts/archive/` with a note on what decision they informed, or delete.

Keep but document: `scripts/run-ipfs-gc.mjs` (unreferenced in docs but a legitimate ops CLI — add one line to `AGENTS.md §3`).

---

## 4. Replaceable custom code

Honest assessment: **very little left to replace** — the usual suspects were already migrated to proper libraries.

| Finding | Recommendation |
|---|---|
| `body-parser` (`src/index.js:6,143-144`) | Drop — Express ≥4.16 ships `express.json()` / `express.urlencoded()`. Zero-behavior-change dep removal. |
| `utils/compression.js` (pako) | Replace with `fflate` (`gzipSync`/`gunzipSync`) — **already a frontend dependency** (used by `3mf/zip.js`). One less runtime dep + importmap entry. |
| `mitt` / `workerpool` shadowed by vendored copies | Pick one strategy. Vendoring is justified for workers (documented in `vendor/README.md`) → the npm deps are dead weight; reconcile placement/docs. |
| Hand-rolled `.env.pinata` parser (`run-pinata-benchmark-from-env.mjs:22-42`) | `dotenv` is already a declared dep — two lines replace it. |
| `commander` (only in `run-ipfs-gc.mjs`) | Node ≥18 built-in `util.parseArgs` covers these four flags. Minor. |
| Custom p-limit (`utils/concurrency.js`, 72 lines) | **Keep** — tiny and test-covered. |
| Custom LRU + IndexedDB (`utils/content-cache.js`, 200 lines) | **Keep** — clean, test-covered; revisit only if IndexedDB edge cases bite. |
| Custom murmur3-32/128 (`utils/hash.js`, ~180 lines) | **Keep** — has dedicated parity tests (`hash-murmur128.test.js`, `dedup-hash-parity.test.js`); replacing trades tested code for a dep. |
| Custom session store (`src/api/sessions.js`, Map + interval sweep) | **Keep** — 15 lines of obvious code beats a dependency; only revisit for multi-process sharing (then Redis, not lru-cache). |
| Hand-rolled token indexer (`token-indexer.js`, 458 lines) | **Keep** — The Graph/Ponder/Envio are infrastructure commitments unjustified for two contracts on two chains. The real fixes are the route dedup and GC `endBlock` bug, not replacement. |
| Custom frontend build pipeline (~150 lines of trivial render/copy scripts) | **Keep** — no-framework app with import maps + CDN globals + vendored worker bundles; a bundler fights the design for zero payload benefit. Only prune the browser-sync leftovers. |
| `web3.js` + `viem` duality in backend | Optional long-term: viem-only would shrink the dep footprint substantially (web3 is huge), but it is a real refactor of the indexer and GC. Note, do not do now. |
| Hand-rolled Merkle helpers in contract tests (`ArbeskAsset.test.js:8-88`) | Replace with `@openzeppelin/merkle-tree` (the frontend's library) — real byte-compatibility drift risk, cheap fix. |

---

## 5. Doc drift worth fixing alongside

- `AGENTS.md` file map references non-existent files: `frontend/src/pug/library.pug` → `dist/library.html`, `frontend/src/js/library-init.js`, `ui/model-clock.js` (actual: `ui/model-clock-gizmo.js`), "Bootstrap 5 with custom Sass overrides" (live `styles.scss` explicitly replaces Bootstrap), `prev_manifest_cid` (code uses `prev_asset_manifest_cid`), stale spec-07 "material editor multi-primitive" description. Same staleness in `docs/ARCHITECTURE.md:478,519,689` and `docs/CURRENT_STATUS.md:25,276`.
- `e2e/README.md:189-197` documents `07-material-editor-multi-primitive.spec.js` — the file does not exist; the regression test for issue #25 lives only as Jest `material-editor.test.js`.
- `docker/nostr-relay.toml:38` sets `pubkey_whitelist` but `:33` has `restricted_writes = false` — the whitelist is inert.
- `@types/express@^5.0.6` vs `express@^4.18.2` — type/runtime major-version skew.
- Root `tsconfig.json` excludes `test/**` and `e2e/specs/**` from typechecking — tests are the least-checked code despite the strict-convention claim; state the policy explicitly.
- Minor schema/doc mismatches: `routes/ipfs.js:71` docstring says count "(1-50, default 1)" but `uploadUrlsSchema` allows `.max(200)`; `eoaAddress` regex duplicates `ethereumAddressSchema`; duplicated JSDoc block in `ipfs-gc.js:54-67`.

---

## 6. Suggested action order

1. **Package hygiene**: add the 5 phantom deps to package.json; remove the ~8 verified-unused deps. (Only finding that breaks a fresh install.)
2. **Delete broken/stale artifacts**: `gas-check.js`, `SECURITY.md` (rewrite or delete), stale deployment folders, `test:e2e:setup`.
3. **Fix the latent bugs**: `viem` declaration, schema thumbnail drift, GC cross-chain `endBlock`, indexer error-shape inconsistency.
4. **Dead-code sweep**: legacy `library-items.js` + dead SCSS (~1900 lines) + pruned exports + contract dead state (`paymentNonce`, native-payment path) — mostly pure deletions, low risk. Remember to prune matching entries in `deployment-integrity.test.js:54-88` and the unused mock in `test/api.test.js:172-183` when removing contract functions.
5. **Dedup hotspots**: `fetchWithSession()`, indexer route helper, shared asset-tag builder, `getActiveContract()`, address-sync shared module.
6. **Decisions, not code**: unpin ownership check, paymaster gating, `MAX_EDITORS_PER_TOKEN` fate, pause scope, `@ts-nocheck` policy, pako→fflate + mitt/workerpool consolidation.
7. **Before mainnet**: zero-root guard in `publishAsset`, backend payment verification wired before real cloud adapters, multisig owner.

---

## 7. What is well done (for the record)

- Thin-gatekeeper compliance is genuine: every server route satisfies at least one of the `AGENTS.md §2` server-side criteria (signature/session validation, rate limits, secret access, cross-user actions).
- Contracts: no unbounded loops, packed storage, OZ primitives everywhere, `receive`/`fallback` revert, Merkle leaves bind `(address, role, tokenId, editorSetVersion)` preventing cross-token and stale-proof replay, `burn` refunds storage, MockUSDC mint gated to local deploys.
- Frontend: single-document SPA with clean bootstrap, one event bus with centralized `EVENTS` constants, uniform `createStore` state modules, cycle-proof format registry, save/publish layering matches documentation, build pipeline has its own tests.
- E2E/worktree infrastructure: per-worker isolated stacks with deterministic ports, worktree-aware compose projects, loopback-only bindings, well-documented private-node lockdown.
- Backend has zero `@ts-nocheck` files; TypeScript suppressions are narrow and justified with comments.

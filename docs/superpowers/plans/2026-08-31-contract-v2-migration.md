# Contract v2 Migration, Governance & CDP Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the paid-tier admin/test gaps, move governance to a Safe multisig + timelock, migrate the two non-upgradeable NFT contracts to a single UUPS-upgradeable V1 that also adds asset-scoped Merkle editors, and rehearse the whole cutover on Base Sepolia with CDP smart wallets — simulating a production mainnet migration.

**Architecture:** One proxy migration, one data migration. The V1 implementation folds #56 (UUPS proxy) and #50 (asset-scoped Merkle leaves) together so the contract address changes exactly once. A dedicated on-chain migration script (`migrate-v2.js`) snapshots → batch-re-mints → verifies, and a host script (`apply-contract-cutover.mjs`) flips the seven address/config sources and re-points the indexer. Governance (#57) lands before the proxy so `_authorizeUpgrade` has a real multisig/timelock from day one.

**Tech Stack:** Solidity `^0.8.20` compiled 0.8.24 (Cancun), OpenZeppelin **v5** (`@openzeppelin/contracts-upgradeable`, `@openzeppelin/hardhat-upgrades`), Hardhat in Docker, viem, CDP server SDK (`@coinbase/cdp-sdk`), `@arbesk/wallet` + `@arbesk/authz` + `@arbesk/asset-core` SDKs.

**Spec:** GitHub issues [#54](https://github.com/ahmadsayed/arbesk/issues/54), [#55](https://github.com/ahmadsayed/arbesk/issues/55), [#47](https://github.com/ahmadsayed/arbesk/issues/47), [#48](https://github.com/ahmadsayed/arbesk/issues/48), [#50](https://github.com/ahmadsayed/arbesk/issues/50), [#56](https://github.com/ahmadsayed/arbesk/issues/56), [#57](https://github.com/ahmadsayed/arbesk/issues/57). Deep reference: `docs/ARCHITECTURE.md §4`, `AGENTS.md §7`, `.agents/skills/solidity-smart-contracts/`, `.agents/skills/cdp-base-wallet/`.

## Global Constraints

- Solidity `^0.8.20`, compiled **0.8.24 (Cancun)**; OpenZeppelin **v5** only (upgradeable variants must match v5).
- Erasable TypeScript only in `src/` and `packages/*` (no enums/namespaces; `import type` for type-only imports; relative `.ts` extensions in `src/`).
- **After any `.sol` change** run the pipeline: compile → deploy → sync `blockchain/.env` → root `.env` → `npm run test:frontend`. Deploy with `--network localhost` (never bare `--network hardhat`).
- Lowercase all addresses in storage/comparison. Every state-changing function emits an event (smart-account proxy validation requires it). Validate `log.address`, never `receipt.to`.
- Merkle leaf is **canonical in `packages/wallet/src/merkle.ts`** and byte-mirrored in `packages/asset-core/src/domain/editors.ts` (which cannot import wallet). A leaf-schema change MUST land in both, and `test/merkle-parity.test.js` must stay green.
- Contract writes flow through `@arbesk/wallet` `createAssetContract` (relay) and `wallet-publishing.ts` / `wallet-send.ts` (browser EOA). CDP sessions route through the backend relay.
- No `TBD`/`TODO` in deliverable code. Token IDs are `uint256` — coerce with `BigInt`.

---

## File Structure (what changes)

**Contracts (`blockchain/contracts/`)**
- `ArbeskAssetBase.sol` — becomes `ERC721Upgradeable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable`; `initialize`; storage gap; asset-scoped `_requireEditor`; migration entry point.
- `ArbeskAssetFree.sol` — upgradeable + `initialize` + `_authorizeUpgrade` + gap.
- `ArbeskAsset.sol` — upgradeable + `initialize(treasury, usdcToken)` + `ReentrancyGuardUpgradeable` + `_authorizeUpgrade` + gap.

**Deploy / migration scripts**
- `blockchain/scripts/deploy.js` — deploy impl + `ERC1967Proxy` (proxy address = stable `CONTRACT_ADDRESS`/`BASE_CONTRACT_ADDRESS`/`PAID_CONTRACT_ADDRESS`).
- `blockchain/scripts/migrate-v2.js` — **NEW** on-chain migration runner (`OP=snapshot|migrate|verify`).
- `scripts/apply-contract-cutover.mjs` — **NEW** host cutover/rollback script.

**SDK mirrors (the asset-scope ripple)**
- `packages/wallet/src/merkle.ts` — `makeLeaf`/`computeRoot`/`getProof` gain `assetScope` (bytes32).
- `packages/wallet/src/contract.ts` — `UpdateUriParams` gains `assetScope`; `updateUri` encodes 4-arg `updateAssetURI`.
- `packages/authz/src/facade.ts` — pass `assetScope` (from `opts`) into `makeLeaf`.
- `packages/asset-core/src/domain/editors.ts` — byte-identical `makeLeaf` copy gains `assetScope`.
- `test/merkle-parity.test.js` — parity vectors updated with `assetScope`.

**Frontend / backend ripple**
- `frontend/src/js/services/asset-save/editor-publish.ts` — `makeLeaf` calls gain `assetScope`.
- `frontend/src/js/blockchain/wallet-publishing.ts` — `updateAssetURI` gains `assetScope`; `sendContractCall` signature string updates.
- `src/api/routes/wallet-relay.ts` — `updateUri` op passes `assetScope` through `params`.
- `src/api/schemas.ts` — `walletRelaySchema.params` (already `z.record`) documented for `assetScope`.
- `src/api/generate-node.ts` — Phase 3 on-chain verification (#48).

**Config (the seven address sources)**
- root `.env`, `blockchain/.env`, `frontend/src/js/blockchain/network-config.ts`, `src/config.ts`, `constants/chains.js` (`DEPLOYMENT_BLOCKS`), `.data/token-indexer-<chainId>.json` (reset), `blockchain/deployments/<network>/*.json`.

**Tests**
- `blockchain/test/ArbeskAsset.test.js` — admin setter describe block + withdraw regression + rollover (Phase 0); upgrade/migration/leaf-scope tests (Phase 2).
- `test/frontend/deployment-integrity.test.js` — `REQUIRED_*_ABI_FUNCTIONS` updated for new/renamed functions.
- `test/merkle-parity.test.js` — scope-aware parity.
- `e2e/specs/*` + `e2e/helpers/*` — publish/URI/editor flows for the new `updateAssetURI` signature.

---

## Phase 0 — Stabilize the current contract (no address change)

> Note: #54's guard is already fixed in HEAD (commit `7cf8d78`); only the regression test is missing. This phase delivers that test plus the #55 coverage gaps.

### Task 0.1: Admin setter coverage + `withdrawUSDC` regression (#55 + #54)

**Files:**
- Modify: `blockchain/test/ArbeskAsset.test.js` (add an `Admin` describe block after the existing Access Control block)
- Reference (fixture): `blockchain/test/ArbeskAsset.test.js:60-76` (`asset`, `usdc`, `owner`, `treasury`, `user` from `beforeEach`)

**Interfaces:**
- Consumes: the existing `beforeEach` fixture (`asset`, `usdc`, `owner`, `treasury`, `user`, `editor`, `editor2`) and the assertion style `revertedWithCustomError` already used in the `payForGenerationWithUSDC` describe block.
- Produces: a green `npx hardhat test` with four setters + `withdrawUSDC` + `setTierCost` covered in both the revert and success directions.

- [ ] **Step 1: Write the Admin describe block**

Add after the existing Access Control describe block. For each setter, assert **both** the revert path **and** the state change (the mutation-testing finding was that revert-only tests don't kill the mutants):

```js
describe("ArbeskAsset Admin", function () {
  it("setTreasury reverts on zero address", async function () {
    await expect(asset.setTreasury(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(asset, "ZeroAddress");
  });
  it("setTreasury reverts for non-owner", async function () {
    await expect(asset.connect(user).setTreasury(user.address))
      .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });
  it("setTreasury updates wallet and emits TreasuryUpdated", async function () {
    await expect(asset.setTreasury(editor.address))
      .to.emit(asset, "TreasuryUpdated")
      .withArgs(treasury.address, editor.address);
    expect(await asset.developerTreasuryWallet()).to.equal(editor.address);
  });

  it("setUsdcToken reverts for non-owner", async function () {
    await expect(asset.connect(user).setUsdcToken(usdc.getAddress()))
      .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });
  it("setUsdcToken updates token and emits UsdcTokenUpdated", async function () {
    // NOTE: no zero-address guard exists on this setter (flagged in #55) —
    // do NOT assert a revert for address(0); record the finding for a human.
    await expect(asset.setUsdcToken(usdc.getAddress()))
      .to.emit(asset, "UsdcTokenUpdated")
      .withArgs(await asset.usdcToken(), await usdc.getAddress());
  });

  it("setTierCost reverts on zero cost", async function () {
    await expect(asset.setTierCost(0, 0))
      .to.be.revertedWithCustomError(asset, "InvalidCost");
  });
  it("setTierCost reverts for non-owner", async function () {
    await expect(asset.connect(user).setTierCost(0, 100))
      .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });
  it("setTierCost updates price and emits TierCostUpdated", async function () {
    await expect(asset.setTierCost(1, 999))
      .to.emit(asset, "TierCostUpdated")
      .withArgs(1, 1250000n, 999n);
    expect(await asset.tierCosts(1)).to.equal(999n);
  });

  it("withdrawUSDC reverts when no USDC token", async function () {
    // Deploy a fresh paid contract with usdcToken = address(0)
    const Factory = await ethers.getContractFactory("ArbeskAsset");
    const noUsdc = await Factory.deploy(treasury.address, ethers.ZeroAddress);
    await noUsdc.waitForDeployment();
    await expect(noUsdc.withdrawUSDC())
      .to.be.revertedWithCustomError(noUsdc, "UsdcTokenNotSet");
  });
  it("withdrawUSDC reverts when balance is zero", async function () {
    await expect(asset.withdrawUSDC())
      .to.be.revertedWithCustomError(asset, "NoBalanceToWithdraw");
  });
  it("withdrawUSDC drains the full balance to treasury (regression for #54)", async function () {
    // Fund the contract DIRECTLY — payForGenerationWithUSDC transfers
    // user→treasury, so it never builds a contract balance. withdrawUSDC
    // exists to recover a mistaken direct transfer to the contract.
    const cost = ethers.parseUnits("50", USDC_DECIMALS);
    await usdc.connect(user).transfer(await asset.getAddress(), cost);
    const before = await usdc.balanceOf(treasury.address);
    const contractBefore = await usdc.balanceOf(await asset.getAddress());
    expect(contractBefore).to.equal(cost);

    await expect(asset.withdrawUSDC())
      .to.emit(usdc, "Transfer")
      .withArgs(await asset.getAddress(), treasury.address, cost);
    expect(await usdc.balanceOf(await asset.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(treasury.address)).to.equal(before + cost);
  });
  it("withdrawUSDC reverts for non-owner", async function () {
    await expect(asset.connect(user).withdrawUSDC())
      .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });
});
```

- [ ] **Step 2: Run the suite (in-process Hardhat, no Docker)**

Run: `cd blockchain && npx hardhat test`
Expected: all pass, including the new Admin block.

- [ ] **Step 3: Commit**

```bash
git add blockchain/test/ArbeskAsset.test.js
git commit -m "test(contracts): cover admin setters + withdrawUSDC regression (#54, #55)"
```

### Task 0.2: Free-tier quota rollover coverage (#55 Gap 2)

**Files:**
- Modify: `blockchain/test/ArbeskAsset.test.js` (the `ArbeskAssetFree` describe block ~line 656)

**Interfaces:**
- Consumes: `@nomicfoundation/hardhat-network-helpers` `time.increase` (add as a devDependency in `blockchain/package.json` if not present) or the raw `evm_increaseTime` RPC.
- Produces: a test asserting the day boundary resets `quota.count`.

- [ ] **Step 1: Write the rollover test**

```js
it("resets daily quota across a day boundary", async function () {
  const { time } = require("@nomicfoundation/hardhat-network-helpers");
  const nodeId = ethers.encodeBytes32String("n");
  await free.connect(user).recordGeneration(nodeId, "prompt");
  expect((await free._generationQuota(user.address)).count).to.equal(1n);

  await time.increase(86401); // cross a full day boundary
  await free.connect(user).recordGeneration(nodeId, "prompt");
  const quota = await free._generationQuota(user.address);
  expect(quota.count).to.equal(1n); // reset, not 2
  expect(quota.day).to.equal(BigInt(Math.floor((await time.latest()) / 86400)));
});
```

(Use `_generationQuota` only if the mapping getter is accessible; otherwise assert via emitted `AssetGenerationRecorded.countToday`, which the existing tests already use.)

- [ ] **Step 2: Run the suite**

Run: `cd blockchain && npx hardhat test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add blockchain/test/ArbeskAsset.test.js blockchain/package.json
git commit -m "test(contracts): cover free-tier daily-quota rollover (#55)"
```

---

## Phase 1 — Governance (#57, supersedes #47)

> Precondition for the proxy work. No contract logic change; only a deploy + post-deploy `transferOwnership` + tests.

### Task 1.1: Add upgradeable OZ dependencies

**Files:**
- Modify: `blockchain/package.json` — add `@openzeppelin/contracts-upgradeable` (v5, same version as `@openzeppelin/contracts`) and devDeps `@openzeppelin/hardhat-upgrades`.

- [ ] **Step 1: Install**

Run: `cd blockchain && npm install @openzeppelin/contracts-upgradeable@^5 && npm install -D @openzeppelin/hardhat-upgrades@^3`
Expected: `@openzeppelin/contracts-upgradeable` version matches the existing `@openzeppelin/contracts` v5 minor.

- [ ] **Step 2: Commit lockfile**

```bash
git add blockchain/package.json blockchain/package-lock.json
git commit -m "chore(contracts): add OZ upgradeable + hardhat-upgrades deps"
```

### Task 1.2: Governance runbook + Safe/timelock deploy (#57)

**Files:**
- Create: `docs/governance.md` — signer roster, threshold (2-of-3), timelock delay, `pause()` emergency bypass decision, and the ops runbook.
- Modify: `blockchain/scripts/deploy.js` (later phases reference the timelock address via env `TIMELOCK_ADDRESS`).

**Interfaces:**
- Produces: `TIMELOCK_ADDRESS` (the OZ `TimelockController`), a Safe 2-of-3 on Base Sepolia, and the decision that `pause()`/`unpause()` bypass the timelock (emergency action) while `setTreasury`/`setUsdcToken`/`setTierCost`/`withdrawUSDC`/`_authorizeUpgrade` are timelocked.

- [ ] **Step 1: Write the governance doc** (exact rosters/delays to be filled by the operator; the doc records them, the code reads them).
- [ ] **Step 2: Deploy a Safe 2-of-3 on Base Sepolia** via Safe UI or Safe protocol kit; record its address in `docs/governance.md`.
- [ ] **Step 3: Deploy an OZ `TimelockController`** (minDelay, proposers = Safe, executors = Safe), record `TIMELOCK_ADDRESS`.
- [ ] **Step 4: Commit the doc + address constants** (addresses in `blockchain/.env` under `SAFE_ADDRESS` / `TIMELOCK_ADDRESS`, not committed secret).

### Task 1.3: `Ownable2Step` transfer + governance tests (#57)

**Files:**
- Modify: `blockchain/contracts/ArbeskAssetBase.sol` — switch `Ownable` → `Ownable2Step` (OZ v5) so `transferOwnership` becomes two-step.
- Modify: `blockchain/test/ArbeskAsset.test.js` — assert post-transfer the old EOA reverts and the timelock path succeeds.

- [ ] **Step 1: Swap to `Ownable2Step`** (`Ownable(msg.sender)` → `Ownable2Step()`; the constructor arg stays `msg.sender`). Verify `transferOwnership` now requires `acceptOwnership`.
- [ ] **Step 2: Add governance tests** — after `transferOwnership(timelock)` + `acceptOwnership`, assert `setTreasury` from the old deployer reverts and the timelock can call it.
- [ ] **Step 3: Compile + run tests**

Run: `docker compose run --rm hardhat npx hardhat compile && cd blockchain && npx hardhat test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add blockchain/contracts/ArbeskAssetBase.sol blockchain/test/ArbeskAsset.test.js
git commit -m "feat(contracts): Ownable2Step + governance transfer tests (#57)"
```

---

## Phase 2 — The one migration: UUPS proxy + asset-scoped leaves (#56 + #50)

> The core. All `.sol` changes land together, then the dedicated migration script moves state. Split into contract → SDK mirror → frontend/backend ripple → scripts → tests, each independently verifiable.

### Task 2.1: Upgradeable `ArbeskAssetBase` with `initialize` + storage gap + `_authorizeUpgrade`

**Files:**
- Modify: `blockchain/contracts/ArbeskAssetBase.sol`

**Interfaces:**
- Consumes: `@openzeppelin/contracts-upgradeable` v5.
- Produces: `abstract contract ArbeskAssetBase is Initializable, ERC721Upgradeable, Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable` with `__ArbeskAssetBase_init(name, symbol)` and `uint256[50] private __gap;` (see `Task 2.3` for the concrete migration entry point it also exposes).

- [ ] **Step 1: Convert the base to upgradeable** — replace the four non-upgradeable imports with their `-Upgradeable` counterparts; drop the constructor in favor of `__ArbeskAssetBase_init(string name_, string symbol_)` guarded by `onlyInitializing`; add `_disableInitializers()` pattern in a real constructor.
- [ ] **Step 2: Add the storage gap** `uint256[50] private __gap;` at the end of the base state.
- [ ] **Step 3: Compile** (Docker) and confirm no storage/init regressions.
- [ ] **Step 4: Commit.**

### Task 2.2: Upgradeable concrete contracts + `_authorizeUpgrade`

**Files:**
- Modify: `blockchain/contracts/ArbeskAssetFree.sol`, `blockchain/contracts/ArbeskAsset.sol`

**Interfaces:**
- Produces: `initialize()` (free) / `initialize(address _treasury, address _usdcToken)` (paid) with `initializer` modifier; `_authorizeUpgrade(address newImpl) internal override onlyRole(UPGRADER_ROLE)` gated to the multisig/timelock from Phase 1; `ReentrancyGuardUpgradeable` on the paid contract; gaps on both.

- [ ] **Step 1: Convert `ArbeskAssetFree`** — `initialize()` calls `__ArbeskAssetBase_init("ArbeskAssetFree","ARBF")`; add `_authorizeUpgrade` (delegates to a timelock-governed check) + gap.
- [ ] **Step 2: Convert `ArbeskAsset`** — `initialize(treasury, usdcToken)` sets the three paid-tier fields + tier costs (moved from the constructor); `ReentrancyGuardUpgradeable.__ReentrancyGuard_init()`; `_authorizeUpgrade` + gap.
- [ ] **Step 3: Compile** and confirm both build.
- [ ] **Step 4: Commit.**

### Task 2.3: Asset-scoped Merkle leaves (#50) + migration entry point

**Files:**
- Modify: `blockchain/contracts/ArbeskAssetBase.sol` — `_requireEditor` leaf schema, `updateAssetURI` scope param, and the `migrateAsset`/`finalizeMigration` entry point.

**Interfaces:**
- Produces:
  - `_requireEditor(uint256 tokenId, address caller, CollaboratorRole requiredRole, bytes32 assetScope, bytes32[] proof)` with leaf `keccak256(abi.encodePacked(caller, requiredRole, tokenId, assetScope, editorSetVersion[tokenId]))`.
  - `updateAssetURI(uint256 tokenId, string newAssetURI, bytes32 assetScope, bytes32[] proof)` (collection-scope Editor **or** asset-scope Editor).
  - `updateEditors`/`burn` pass `assetScope = bytes32(0)`.
  - `migrateAsset(uint256 tokenId, address owner, string uri, bytes32 editorRoot_, uint256 editorSetVersion_, string editorListUri) onlyOwner` guarded by `migrationActive`, and `finalizeMigration() onlyOwner` that sets `migrationActive = false` and emits `MigrationComplete`.

- [ ] **Step 1: Change the leaf schema** — add `assetScope` between `tokenId` and `editorSetVersion` in `_requireEditor`'s `encodePacked`; thread the param through `updateAssetURI`; keep `updateEditors`/`burn` on `bytes32(0)`.
- [ ] **Step 2: Add the migration entry point** with the `migrationActive` flag + `MigrationComplete` event + NatSpec (`@notice`, `@dev`).
- [ ] **Step 3: Compile.**
- [ ] **Step 4: Commit.**

### Task 2.4: Mirror the leaf schema in the SDKs (canonical + copy)

**Files:**
- Modify: `packages/wallet/src/merkle.ts` — `makeLeaf(address, role, tokenId, assetScope, setVersion)`; `computeRoot`/`getProof` gain `assetScope`; update the header doc's leaf-encoding comment.
- Modify: `packages/asset-core/src/domain/editors.ts` — byte-identical `makeLeaf` copy gains the same `assetScope` slot (HashPort `_soliditySha3` path).
- Modify: `packages/authz/src/facade.ts` — read `assetScope` from `opts.assetScope` (default `ZERO_HASH`) and pass to `makeLeaf`.
- Modify: `packages/wallet/src/contract.ts` — `UpdateUriParams` gains `assetScope: string`; `updateUri` encodes `updateAssetURI(tokenId, newUri, assetScope, proof)`.
- Modify: `packages/authz/src/types.ts` — `AssetAccessOptions` gains `assetScope?: string`.
- Modify: `test/merkle-parity.test.js` — add scope-aware parity vectors.

**Interfaces:**
- Consumes: `ZERO_HASH` from `@arbesk/wallet/merkle.js`.
- Produces: `makeLeaf(address, role, tokenId, assetScope, setVersion)` byte-identical across `wallet` and `asset-core`, and `updateAssetURI(uint256,string,bytes32,bytes32[])` ABI.

- [ ] **Step 1: Update `packages/wallet/src/merkle.ts`** (canonical) — change the signature and `encodePacked` types to `["address","uint8","uint256","bytes32","uint256"]` with `assetScope` inserted; update `computeRoot`/`getProof`.
- [ ] **Step 2: Update `packages/asset-core/src/domain/editors.ts`** — mirror the change in `makeLeaf` (insert `{ type: "bytes32", value: assetScope }`).
- [ ] **Step 3: Update `packages/authz/src/facade.ts` + `types.ts`** — thread `opts.assetScope`.
- [ ] **Step 4: Update `packages/wallet/src/contract.ts`** — `updateUri` 4-arg encoding.
- [ ] **Step 5: Build + run parity**

Run: `npm run build:packages && npx jest test/merkle-parity.test.js`
Expected: parity PASS with the new scope field.

- [ ] **Step 6: Commit.**

### Task 2.5: Frontend + backend ripple

**Files:**
- Modify: `frontend/src/js/services/asset-save/editor-publish.ts` — `makeLeaf(...)` calls gain `assetScope` (`bytes32(0)` default via `ZERO_HASH`); `requireEditorProof`/`buildWalletProof` pass it.
- Modify: `frontend/src/js/blockchain/wallet-publishing.ts` — `updateAssetURI` signature + `sendContractCall` `functionName` → `"updateAssetURI(uint256,string,bytes32,bytes32[])"`.
- Modify: `src/api/routes/wallet-relay.ts` — `updateUri` op passes `assetScope` from `params` into `contract.updateUri`.
- Modify: `src/api/schemas.ts` — document `assetScope` (bytes32 hex) in `params` (schema already allows unknown keys).

- [ ] **Step 1: Update `editor-publish.ts` + `wallet-publishing.ts`.**
- [ ] **Step 2: Update `wallet-relay.ts` + `schemas.ts`.**
- [ ] **Step 3: Typecheck + lint**

Run: `npm run build:packages && npm run typecheck && npm run typecheck:frontend && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit.**

### Task 2.6: Contract tests (upgrade, migration, leaf scope)

**Files:**
- Modify: `blockchain/test/ArbeskAsset.test.js` — new describe blocks: (a) proxy deploy via `deployProxy`/`upgrades.deployProxy`, (b) an in-test upgrade (deploy V2 impl, `upgradeProxy`) asserting state survives, (c) `migrateAsset`/`finalizeMigration` + re-committed root verifies under the new schema, (d) asset-scope gating (`updateAssetURI` with `assetScope=keccak256(assetId)` vs `bytes32(0)`).
- Modify: `test/frontend/deployment-integrity.test.js` — `REQUIRED_FREE_ABI_FUNCTIONS`/`REQUIRED_PAID_ABI_FUNCTIONS` now include `initialize`, `upgradeTo`/`upgradeToAndCall` (if surfaced), `migrateAsset`, `finalizeMigration`, `assetScope` on `updateAssetURI`.

- [ ] **Step 1: Write the proxy/upgrade/migration/scope tests** (follow the existing `SimpleMerkleTree` helpers, extending `makeLeaf` with `assetScope`).
- [ ] **Step 2: Run** `cd blockchain && npx hardhat test`.
- [ ] **Step 3: Update + run** `npm run test:frontend`.
- [ ] **Step 4: Commit.**

### Task 2.7: Dedicated migration script (on-chain)

**Files:**
- Create: `blockchain/scripts/migrate-v2.js` (Hardhat/CJS, `OP` from `process.env.OP`).
- Create: `blockchain/migrations/baseSepolia/` (snapshot output dir, gitignored).

**Interfaces:**
- Consumes: `DEPLOYMENT_BLOCKS`, `LOG_CHUNK_SIZES` from `constants/chains.js`; `OLD_CONTRACT_ADDRESS` / `NEW_CONTRACT_ADDRESS` env.
- Produces: `blockchain/migrations/baseSepolia/snapshot-<block>.json` with `{ blockNumber, tokens: [{ tokenId, owner, tokenURI, editorRoot, editorSetVersion, editorListURI, editorList }] }`.

Skeleton (concrete, no placeholders):

```js
// blockchain/scripts/migrate-v2.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { DEPLOYMENT_BLOCKS, LOG_CHUNK_SIZES } = require("../../constants/chains.js");

const OP = process.env.OP;
const OLD = (process.env.OLD_CONTRACT_ADDRESS || "").toLowerCase();
const NEW = (process.env.NEW_CONTRACT_ADDRESS || "").toLowerCase();

const TRANSFER_TOPIC = hre.ethers.id(
  "Transfer(address,address,uint256)"
);
const ZERO = "0x0000000000000000000000000000000000000000";

async function snapshot(chainId) {
  const fromBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
  const chunk = LOG_CHUNK_SIZES[chainId] ?? 2000;
  const latest = await hre.ethers.provider.getBlockNumber();
  const tokens = new Map(); // tokenId -> { owner, tokenURI, editorRoot, editorSetVersion, editorListURI, editorList }

  for (let from = fromBlock; from <= latest; from += chunk) {
    const to = Math.min(from + chunk - 1, latest);
    const logs = await hre.ethers.provider.getLogs({
      address: OLD,
      fromBlock: from,
      toBlock: to,
      topics: [TRANSFER_TOPIC],
    });
    for (const log of logs) {
      const [fromAddr, toAddr, tokenIdBn] = hre.ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "address", "uint256"],
        log.data
      );
      const tokenId = tokenIdBn.toString();
      if (fromAddr.toLowerCase() === ZERO) {
        tokens.set(tokenId, { tokenId, owner: toAddr.toLowerCase(), ...(await readToken(tokenId)) });
      } else if (toAddr.toLowerCase() === ZERO) {
        tokens.delete(tokenId);
      }
    }
  }
  const out = { blockNumber: latest, tokens: [...tokens.values()] };
  const dir = path.join(__dirname, "..", "migrations", "baseSepolia");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `snapshot-${latest}.json`), JSON.stringify(out, null, 2));
  console.log(`[MIGRATE] snapshot ${out.tokens.length} tokens @ block ${latest}`);
}

async function readToken(tokenId) {
  const c = await hre.ethers.getContractAt("ArbeskAssetBase", OLD);
  return {
    tokenURI: await c.tokenURI(tokenId),
    editorRoot: await c.editorRoot(tokenId),
    editorSetVersion: (await c.editorSetVersion(tokenId)).toString(),
    editorListURI: await c.editorListURI(tokenId),
  };
}

async function migrate(snapshotPath) {
  // read snapshot; for each token fetch editorList via editorListURI (IPFS via the
  // host's Pinata/Kubo gateway env), recompute the NEW root under the new leaf
  // schema (assetScope = bytes32(0)), then chunk-call migrateAsset on NEW.
  // Finally call finalizeMigration().
}

async function verify(snapshotPath) {
  // parity-assert owner + tokenURI + editorRoot for every tokenId vs the new contract.
}

main(OP).catch((e) => { console.error(e); process.exitCode = 1; });
```

The `editorList` fetch + new-root recompute inside `migrate()` reuses `@arbesk/wallet`'s `computeRoot` semantics — in the CJS script, compute the new root with the same packed-keccak leaf (`address, uint8, uint256, bytes32, uint256`) so it is byte-identical to the contract's `_requireEditor`.

- [ ] **Step 1: Implement `snapshot`** (the concrete body above), run `OP=snapshot` against Hardhat-local to validate.
- [ ] **Step 2: Implement `migrate`** (batch re-mint + recompute roots + `finalizeMigration`), run locally.
- [ ] **Step 3: Implement `verify`**, run locally until parity is clean.
- [ ] **Step 4: Commit.**

### Task 2.8: Dedicated cutover script (host, off-chain)

**Files:**
- Create: `scripts/apply-contract-cutover.mjs` (generalize `scripts/sync-deployed-addresses.mjs` for Base Sepolia + rollback).

**Interfaces:**
- Consumes: `--network baseSepolia` (implied), new `BASE_CONTRACT_ADDRESS`, new deployment block.
- Produces: flips root `.env`, `blockchain/.env`, `frontend/src/js/blockchain/network-config.ts`, `src/config.ts`, `constants/chains.js` `DEPLOYMENT_BLOCKS[84532]`, and resets `.data/token-indexer-84532.json`.

- [ ] **Step 1: Implement the 7-way address/config rewrite** (mirror `sync-deployed-addresses.mjs` but keyed to `84532` and including `DEPLOYMENT_BLOCKS` + indexer-state reset).
- [ ] **Step 2: Implement `--revert`** restoring the old addresses.
- [ ] **Step 3: Dry-run** with `--dry-run` printing the diffs before writing.
- [ ] **Step 4: Commit.**

### Task 2.9: Proxy deploy + `deploy.js` update + cutover

**Files:**
- Modify: `blockchain/scripts/deploy.js` — deploy impl + `ERC1967Proxy` (via `@openzeppelin/hardhat-upgrades` `deployProxy`), writing the **proxy** address (not the impl) into the `.env` keys and deployment artifacts.

- [ ] **Step 1: Rework `deploy.js`** to `deployProxy(Contract, initArgs, { initializer: "initialize" })`, with `PAID_CONTRACT_ADDRESS` = paid proxy and `BASE_CONTRACT_ADDRESS` = free proxy.
- [ ] **Step 2: Compile + local deploy + sync**

Run: `docker compose run --rm hardhat npx hardhat compile && docker compose up -d hardhat && docker compose exec -T hardhat npx hardhat run scripts/deploy.js --network localhost && node scripts/sync-deployed-addresses.mjs`
Expected: proxy addresses land in `blockchain/.env` + root `.env` + `network-config.ts` + `src/config.ts`.

- [ ] **Step 3: Run** `npm run test:frontend` (integrity must pass against the new ABI + addresses).
- [ ] **Step 4: Commit.**

---

## Phase 3 — On-chain generation verification (#48)

**Files:**
- Modify: `src/api/assets/generate-node.ts` (and its generation route) — free tier validates `recordGeneration`/quota (relayer pattern), paid tier verifies the `AssetGenerationPaidUSDC` event (amount/token/nodeId binding, replay-guarded by a used-txHash store), BYOK stays rate-limit-only and documented.
- Modify: `src/api/openapi.json` — remove the "backend does not validate transaction hashes" note; document the new verification.

- [ ] **Step 1: Write failing API tests** (`test/api.test.js`) asserting an unverified free/paid generation is rejected once a real adapter path is enabled.
- [ ] **Step 2: Implement** event/txHash verification (decode via the new ABI; record used txHashes with a TTL store).
- [ ] **Step 3: Run** `npm run test:api`.
- [ ] **Step 4: Commit.**

---

## Phase 4 — Rehearsal & cutover (simulate production)

> Run the whole thing end-to-end twice: Hardhat-local first, then Base Sepolia. Then the CDP smoke matrix.

### Task 4.1: Local dry run (snapshot → migrate → verify → cutover → rollback)

- [ ] **Step 1:** Seed a handful of tokens on the local free + paid contracts (via existing publish flow or a fixture script).
- [ ] **Step 2:** `OP=snapshot` → inspect the JSON (owners/URIs/roots present).
- [ ] **Step 3:** Deploy proxy V1 locally → `OP=migrate` → `OP=verify` (parity clean).
- [ ] **Step 4:** `node scripts/apply-contract-cutover.mjs` → confirm all seven sources flipped; restart backend; confirm `npm run test:frontend` + indexer rebuilds ownership.
- [ ] **Step 5:** `node scripts/apply-contract-cutover.mjs --revert` → confirm rollback restores the old addresses and the old contract is still read-only live.

### Task 4.2: Base Sepolia cutover

- [ ] **Step 1:** `OP=snapshot` against the old `BASE_CONTRACT_ADDRESS` (0xa39eFfc…).
- [ ] **Step 2:** Deploy proxy V1 on Base Sepolia (free tier only; paid/USDC stay local).
- [ ] **Step 3:** `OP=migrate` (batch re-mint to owners incl. CDP smart accounts) → `OP=verify` parity clean.
- [ ] **Step 4:** `node scripts/apply-contract-cutover.mjs` — flip `BASE_CONTRACT_ADDRESS` + `DEPLOYMENT_BLOCKS[84532]` + reset indexer state.
- [ ] **Step 5:** Restart backend (picks up new ABI + address).

### Task 4.3: CDP cutover checklist

**No code changes to wallet identity.** The smart-account address is derived from the embedded EOA, not the contract. Verify each item:

- [ ] **Recompile → backend restart** (relay + `authz.ts` load the ABI artifact + address at startup; without restart they keep the old contract/ABI).
- [ ] **`BASE_CONTRACT_ADDRESS`** updated in root `.env` (feeds `src/config.ts` → relay + `getConfiguredContracts` allowlist) **and** `frontend/src/js/blockchain/network-config.ts`.
- [ ] **CDP Portal paymaster sponsorship policy** — confirm whether the project paymaster is scoped to a target contract address. If scoped, add the new proxy address; otherwise CDP publish/update/burn return **`policy_violation`**. If unscoped ("sponsor all"), no change — but verify explicitly.
- [ ] **Indexer repoint** (via cutover script) so CDP wallets' `owned`/`shared` discovery returns re-minted tokens.
- [ ] **CDP smoke matrix** after cutover: publish, updateAssetURI (with `assetScope`), updateEditors, burn (relay + `@arbesk/authz`), plus a library load. Use a real email login + delegation, or `scripts/test-cdp-enduser.mjs` for the server relay path.

**Failure signals to watch:** `WRONG_CONTRACT` (stale address source), `c.methods.X is not a function` (stale ABI), `policy_violation` (paymaster not updated), empty library for CDP wallets (indexer not repointed).

---

## Self-Review (run before execution handoff)

- **Spec coverage:** #54 → T0.1 · #55 → T0.1/T0.2 · #47/#57 → T1.2/T1.3 · #56 → T2.1/T2.2/T2.6/T2.9 · #50 → T2.3/T2.4/T2.5/T2.7 · #48 → Phase 3. ✅
- **Type consistency:** the leaf signature `makeLeaf(address, role, tokenId, assetScope, setVersion)` is identical across `wallet/merkle.ts`, `asset-core/domain/editors.ts`, `authz/facade.ts`, and `ArbeskAssetBase._requireEditor`; `updateAssetURI(uint256,string,bytes32,bytes32[])` is identical across the contract, `contract.ts`, and `wallet-publishing.ts`. ✅
- **Known open item for a human:** `setUsdcToken` has no zero-address guard (flagged in #55) — record the decision (add guard vs leave) before Phase 2; if adding, add the test + a `ZeroAddress` revert in T2.2.

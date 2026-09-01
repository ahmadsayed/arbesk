# Base Sepolia Contract v2 Cutover — Runbook

Ready-to-execute sequence for the live cutover (the "Stage B" of the contract-v2
migration plan). Everything here was rehearsed on Hardhat local (`docs/superpowers/plans/2026-08-31-contract-v2-migration.md`).

**Do not run until:** deployer `PRIVATE_KEY` is confirmed funded, and CDP Portal
paymaster sponsorship policy is understood (see §7).

---

## 0. Pre-flight

```bash
cd blockchain
# Confirm the old live contract and its deployment block (these are the migration source).
grep BASE_CONTRACT_ADDRESS .env          # expect 0xa39eFfc859b326CCCeB177CfBbef00C1876e18d8
grep -n "BASE_TESTNET" ../constants/chains.js  # expect DEPLOYMENT_BLOCKS 44309130
docker compose run --rm hardhat npx hardhat compile   # fresh artifacts (ABI)
```

Two code items must land **before** the cutover (flagged; implement as separate commits):

1. **`verify.js` is not proxy-aware.** It verifies a flat contract with constructor
   args; the V1 is a UUPS proxy. Update it to verify the *implementation* (no args)
   then the *proxy* (via `@openzeppelin/hardhat-upgrades`, linking impl→proxy so
   Basescan shows "Read as Proxy").
2. **`deploy.js` reuses a stale `USDC_TOKEN`** if present (local-only, Base Sepolia
   deploys no USDC — but add a `code exists` / zero-address sanity check for hygiene).

---

## 1. Deploy the proxy

```bash
cd blockchain
docker compose run --rm hardhat npx hardhat run scripts/deploy.js --network baseSepolia
# → "ArbeskAssetFree proxy deployed to: 0xNEW"
# → writes BASE_CONTRACT_ADDRESS=0xNEW to blockchain/.env
```

Record `0xNEW` and its deployment block (Basescan shows the tx block).

## 2. Verify on Basescan

```bash
docker compose run --rm hardhat npx hardhat run scripts/verify.js --network baseSepolia
```
Requires the §0 fix. Confirm Basescan renders the proxy + implementation source.

## 3. Snapshot the old contract

```bash
cd blockchain
docker compose run --rm -e OP=snapshot \
  -e OLD_CONTRACT_ADDRESS=0xa39eFfc859b326CCCeB177CfBbef00C1876e18d8 \
  -e NEW_CONTRACT_ADDRESS=0xNEW \
  -e IPFS_GATEWAY_URL=<pinata-or-kubo-gateway> \
  hardhat npx hardhat run scripts/migrate-v2.js --network baseSepolia
```
→ writes `migrations/snapshot-84532-<block>.json`. Inspect it: token count, owners,
`editorListURI` presence.

## 4. Migrate to the new proxy

```bash
docker compose run --rm -e OP=migrate \
  -e SNAPSHOT_PATH=migrations/snapshot-84532-<block>.json \
  -e NEW_CONTRACT_ADDRESS=0xNEW \
  -e IPFS_GATEWAY_URL=<pinata-or-kubo-gateway> \
  hardhat npx hardhat run scripts/migrate-v2.js --network baseSepolia
```
Recomputes each editor root under the new asset-scoped leaf (collection-wide scope),
batch `migrateAsset`, then `finalizeMigration()`. Warnings "editor-list re-commit
failed … migrating old root" are tolerated (provenance is on IPFS; re-run remediates).

## 5. Verify parity

```bash
docker compose run --rm -e OP=verify \
  -e SNAPSHOT_PATH=migrations/snapshot-84532-<block>.json \
  -e NEW_CONTRACT_ADDRESS=0xNEW \
  hardhat npx hardhat run scripts/migrate-v2.js --network baseSepolia
```
Expect `N tokens, 0 drifted`.

## 6. Cutover the address sources

```bash
cd ..   # repo root
node scripts/apply-contract-cutover.mjs --new 0xNEW --block <deployment-block>
```
Flips `blockchain/.env`, root `.env`, `network-config.ts`, `src/config.ts`,
`constants/chains.js` (`DEPLOYMENT_BLOCKS[84532]`), and resets the indexer state.
Backup saved to `blockchain/deployments/baseSepolia/.cutover-backup.json`.

## 7. Backend restart + CDP updates

1. **Restart the backend** (picks up new ABI artifact + `BASE_CONTRACT_ADDRESS`).
2. **CDP Portal paymaster** — confirm whether sponsorship is scoped to a target
   contract address. If scoped, add `0xNEW`; otherwise CDP ops fail `policy_violation`.
3. **Indexer** — already re-pointed by §6; confirm `[INDEXER]` backfills the new contract.

## 8. Smoke matrix

- **EOA**: publish → updateAssetURI → updateEditors → burn → library load.
- **CDP** (email login + delegation): publish → updateAssetURI → updateEditors → burn
  (via backend relay + `@arbesk/authz`), and library load (`owned`/`shared`).
- Watch for: `WRONG_CONTRACT` (stale address), `c.methods.X is not a function` (stale
  ABI), `policy_violation` (paymaster), empty library (indexer).

## 9. Rollback

```bash
node scripts/apply-contract-cutover.mjs --revert
```
Restores all six sources to the old address/block. The old contract stays read-only
live (never destroyed).

---

## Dependencies & sequencing

Governance (`#57`) — Safe 2-of-3 + `TimelockController` deploy and `transferOwnership`
on the new proxy — should be sequenced **before or immediately after** this cutover,
since `_authorizeUpgrade` is `onlyOwner`. See `docs/superpowers/plans/2026-08-31-contract-v2-migration.md` §Phase 1.

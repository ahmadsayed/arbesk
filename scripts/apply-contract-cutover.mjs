#!/usr/bin/env node
// Base Sepolia contract cutover + rollback (host script, off-chain).
//
// Flips the contract address + indexer deployment block across every source
// of truth, and resets the indexer state, in one atomic step. Generalizes
// scripts/sync-deployed-addresses.mjs (which handles Hardhat Local only).
//
//   node scripts/apply-contract-cutover.mjs --new 0xNEW --block 123456
//   node scripts/apply-contract-cutover.mjs --revert
//
// Sources updated:
//   1. blockchain/.env            (BASE_CONTRACT_ADDRESS)
//   2. root .env                  (BASE_CONTRACT_ADDRESS)
//   3. frontend/.../network-config.ts (NETWORK_CONFIGS[84532].contractAddress)
//   4. src/config.ts              (NETWORK_CONFIGS[84532].contractAddress fallback)
//   5. constants/chains.js        (DEPLOYMENT_BLOCKS[84532])
//   6. .data/token-indexer-84532.json  (reset lastScannedBlock to the new block)
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CHAIN_ID = 84532;

const FILES = [
  "blockchain/.env",
  ".env",
  "frontend/src/js/blockchain/network-config.ts",
  "src/config.ts",
];
const CHAINS_FILE = "constants/chains.js";
const INDEXER_STATE = `.data/token-indexer-${CHAIN_ID}.json`;
const BACKUP = "blockchain/deployments/baseSepolia/.cutover-backup.json";

/**
 * @returns {string}
 */
function readBaseAddress() {
  for (const f of ["blockchain/.env", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^BASE_CONTRACT_ADDRESS=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("BASE_CONTRACT_ADDRESS not found in blockchain/.env or .env");
}

/**
 * @returns {string}
 */
function readDeploymentBlock() {
  const p = path.join(ROOT, CHAINS_FILE);
  const m = fs.readFileSync(p, "utf8").match(
    /\[CHAIN_IDS\.BASE_TESTNET\]:\s*(\d+)/
  );
  if (!m) throw new Error("DEPLOYMENT_BLOCKS[84532] not found in constants/chains.js");
  return m[1];
}

/**
 * Replace a value (case-insensitive) across every address/config source.
 * @param {string} oldVal
 * @param {string} newVal
 * @param {string[]} files
 */
function replaceInFiles(oldVal, newVal, files) {
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) {
      console.warn(`⚠️  skip missing: ${f}`);
      continue;
    }
    const src = fs.readFileSync(p, "utf8");
    if (!src.toLowerCase().includes(oldVal.toLowerCase())) {
      console.warn(`⚠️  ${f}: old value not found`);
      continue;
    }
    // Case-insensitive replace, preserving nothing (new address is canonical).
    const re = new RegExp(oldVal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    fs.writeFileSync(p, src.replace(re, newVal));
    console.log(`✅ ${f}`);
  }
}

/**
 * @param {string} oldBlock
 * @param {string} newBlock
 */
function replaceBlock(oldBlock, newBlock) {
  const p = path.join(ROOT, CHAINS_FILE);
  const src = fs.readFileSync(p, "utf8");
  const re = new RegExp(
    `(\\[CHAIN_IDS\\.BASE_TESTNET\\]:\\s*)${oldBlock}`,
    ""
  );
  if (!re.test(src)) throw new Error("DEPLOYMENT_BLOCKS block not found");
  fs.writeFileSync(p, src.replace(re, `$1${newBlock}`));
  console.log(`✅ ${CHAINS_FILE}`);
}

/**
 * @param {string} newBlock
 */
function resetIndexer(newBlock) {
  const p = path.join(ROOT, INDEXER_STATE);
  if (!fs.existsSync(p)) {
    console.log(`ℹ️  no indexer state to reset (${INDEXER_STATE})`);
    return;
  }
  try {
    const state = JSON.parse(fs.readFileSync(p, "utf8"));
    state.lastScannedBlock = Number(newBlock);
    // Force a clean re-scan of the new contract from its deployment block.
    state.ownership = {};
    state.tokenEditors = {};
    state.editorTokens = {};
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
    console.log(`✅ ${INDEXER_STATE} reset to block ${newBlock}`);
  } catch (err) {
    console.warn(`⚠️  could not reset indexer state: ${(/** @type {Error} */ (err)).message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  /**
   * @param {string} flag
   */
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const isRevert = args.includes("--revert");

  const backupPath = path.join(ROOT, BACKUP);

  if (isRevert) {
    if (!fs.existsSync(backupPath)) {
      console.error("No cutover backup found to revert.");
      process.exit(1);
    }
    const { oldAddress, oldBlock, newAddress, newBlock } = JSON.parse(
      fs.readFileSync(backupPath, "utf8")
    );
    replaceInFiles(newAddress, oldAddress, FILES);
    replaceBlock(newBlock, oldBlock);
    resetIndexer(oldBlock);
    fs.rmSync(backupPath);
    console.log(`↩️  reverted to ${oldAddress} @ block ${oldBlock}`);
    return;
  }

  const newAddress = get("--new");
  const newBlock = get("--block");
  if (!newAddress || !newBlock) {
    console.error("Usage: apply-contract-cutover.mjs --new 0xADDR --block N");
    process.exit(1);
  }

  const oldAddress = readBaseAddress();
  const oldBlock = readDeploymentBlock();

  // Persist a backup BEFORE mutating anything.
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ oldAddress, oldBlock, newAddress, newBlock }, null, 2)
  );

  replaceInFiles(oldAddress, newAddress, FILES);
  replaceBlock(oldBlock, newBlock);
  resetIndexer(newBlock);

  console.log(`🚀 cutover to ${newAddress} @ block ${newBlock}`);
  console.log(`   (backup saved to ${BACKUP} for --revert)`);
}

main();

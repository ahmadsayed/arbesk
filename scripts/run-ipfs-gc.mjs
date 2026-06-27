#!/usr/bin/env node
// @ts-check
/**
 * Standalone IPFS garbage collector for Arbesk.
 *
 * Scans the configured EVM chain for live Arbesk tokens, walks their manifest
 * chains, and unpins any pinned CID that is no longer reachable.
 *
 * Usage:
 *   node scripts/run-ipfs-gc.mjs --dry-run
 *   node scripts/run-ipfs-gc.mjs --live --max-unpin 500
 *   node scripts/run-ipfs-gc.mjs --chain-id 31337 --live
 */

import { Command } from "commander";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIpfsGC } from "../src/api/ipfs-gc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load environment before importing config/storage modules.
dotenv.config({ path: path.join(ROOT, ".env") });
dotenv.config({ path: path.join(ROOT, "blockchain", ".env") });

const program = new Command()
  .name("run-ipfs-gc.mjs")
  .description(
    "Scans live tokens on the configured EVM chain, walks their manifest chains, and unpins pinned CIDs that are no longer reachable.",
  )
  .option("--dry-run", "Report orphans without unpinning (default)", true)
  .option("--live", "Actually unpin orphaned CIDs", false)
  .option(
    "--max-unpin <number>",
    "Limit the number of CIDs to unpin",
    parseFloat,
    Infinity,
  )
  .option(
    "--chain-id <id>",
    "Override chain ID (default: env CHAIN_ID)",
    process.env.CHAIN_ID,
  );

program.parse();

const opts = program.opts();
const dryRun = opts.live ? false : opts.dryRun;

async function main() {
  console.log(
    `[GC-CLI] starting | dryRun=${dryRun} maxUnpin=${opts.maxUnpin} chainId=${opts.chainId}`,
  );

  const result = await runIpfsGC({
    dryRun,
    maxUnpin: opts.maxUnpin,
    chainId: opts.chainId,
  });

  console.log("\n[GC-CLI] result:");
  console.log(JSON.stringify(result, null, 2));

  if (result.errors?.length) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error("[GC-CLI] fatal error:", err.message);
  process.exit(1);
});

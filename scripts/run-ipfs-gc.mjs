#!/usr/bin/env bun
// @ts-check
/**
 * Standalone IPFS garbage collector for Arbesk.
 *
 * Scans the configured EVM chain for live Arbesk tokens, walks their manifest
 * chains, and unpins any pinned CID that is no longer reachable.
 *
 * Usage:
 *   bun scripts/run-ipfs-gc.mjs --dry-run
 *   bun scripts/run-ipfs-gc.mjs --live --max-unpin 500
 *   bun scripts/run-ipfs-gc.mjs --chain-id 31337 --live
 *
 * A live run unpins only CIDs that a previous live run already saw orphaned
 * at least --grace-hours ago (state in .data/ipfs-gc-state.json), so the
 * first live run just marks.
 *
 * The compiled server runs the same collector as `arbesk-server gc ...`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load environment before importing config/storage modules.
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {}
try {
  process.loadEnvFile(path.join(ROOT, "blockchain", ".env"));
} catch {}

const { runGcCli } = await import("../src/api/ipfs-gc-cli.ts");
process.exit(await runGcCli(process.argv.slice(2)));

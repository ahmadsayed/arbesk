// @ts-nocheck
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = process.cwd();

/**
 * Detect whether ROOT is the main git checkout (`.git` is a directory) or a
 * linked worktree (`.git` is a file pointing back to the main repository).
 */
function isMainCheckout(root) {
  const gitPath = path.join(root, ".git");
  try {
    return fs.statSync(gitPath).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeIdPart(part) {
  return part.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
}

function deriveWorktreeId(root) {
  const base = sanitizeIdPart(path.basename(root)) || "arbesk";
  const hash = crypto
    .createHash("sha256")
    .update(root)
    .digest("hex")
    .slice(0, 8);
  return `${base}-${hash}`;
}

function deriveBackendPort(root, worktreeId) {
  // Keep the familiar default port for the primary checkout so existing docs
  // and muscle memory keep working. Linked worktrees get a deterministic port
  // in the private/dynamic range.
  if (isMainCheckout(root)) return 9090;
  const hash = crypto.createHash("sha256").update(worktreeId).digest("hex");
  return 30000 + (parseInt(hash.slice(0, 8), 16) % 10000);
}

export const WORKTREE_ID = deriveWorktreeId(ROOT);

// Docker Compose project names are restricted to [a-z0-9_-].
export const COMPOSE_PROJECT = `arbesk-${WORKTREE_ID.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;

const BACKEND_PORT_BASE = deriveBackendPort(ROOT, WORKTREE_ID);

// Default to a single worker / single stack (lightest, matches CI and low-RAM
// machines). Opt into parallel isolated stacks with E2E_WORKERS=N.
export const E2E_WORKERS = Number(process.env.E2E_WORKERS) || 1;

/**
 * Return the host ports/URLs for a given Playwright worker index.
 * Worker 0 keeps the current single-stack project/ports (backward compatible
 * with the existing one-stack E2E flow); worker i > 0 offsets from there.
 */
export function portsForWorker(i) {
  const backendPort = BACKEND_PORT_BASE + i;
  const suffix = i === 0 ? "" : `-w${i}`;
  return {
    backendPort,
    backendUrl: `http://127.0.0.1:${backendPort}`,
    hardhatRpc: `http://127.0.0.1:${8545 + i}`,
    ipfsApiUrl: `http://127.0.0.1:${5001 + i}`,
    ipfsGatewayUrl: `http://127.0.0.1:${8080 + i}`,
    nostrUrl: `ws://127.0.0.1:${7777 + i}`,
    composeProject: `${COMPOSE_PROJECT}${suffix}`,
  };
}

const CURRENT_WORKER_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
export const BACKEND_PORT = portsForWorker(CURRENT_WORKER_INDEX).backendPort;
export const BACKEND_URL = portsForWorker(CURRENT_WORKER_INDEX).backendUrl;
export const HARDHAT_RPC = portsForWorker(CURRENT_WORKER_INDEX).hardhatRpc;
export const IPFS_GATEWAY = portsForWorker(CURRENT_WORKER_INDEX).ipfsGatewayUrl;

// Shared handoff between global setup and global teardown. Playwright loads the
// setup and teardown modules in separate evaluations, so in-memory state (the
// spawned backend pid, whether we started Docker) cannot be shared via module
// scope - it must round-trip through a file. Keep the file per-worktree so
// concurrent runs from different worktrees do not clobber each other.
export const STATE_FILE = path.join(
  os.tmpdir(),
  `arbesk-e2e-state-${WORKTREE_ID}.json`,
);

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function log(step) {
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[E2E ${ts}] ${step}`);
}

/**
 * Check whether a Docker Compose service is running for the given project.
 * Defaults to this worktree's project. Using the project name isolates
 * worktrees and parallel workers from each other.
 */
export function isServiceRunning(service, composeProject = COMPOSE_PROJECT) {
  try {
    const out = execSync(
      `docker compose -p "${composeProject}" ps --services --filter "status=running"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .includes(service);
  } catch {
    return false;
  }
}

export function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function clearState() {
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // already gone
  }
}

async function rpc(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error)
    throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result;
}

/**
 * Wipe the local Hardhat node back to genesis so every E2E run starts from a
 * clean chain. This is the key to cross-run determinism: a fresh chain means
 * no leftover ERC-721 tokens (gallery assertions stay deterministic) and a
 * reset free-tier daily generation quota (no on-chain "10 gen/day" exhaustion
 * after repeated runs on a reused container).
 *
 * After the reset the previously deployed contracts have no bytecode, so
 * start-dev.sh re-detects that and redeploys fresh contracts at the same
 * deterministic addresses.
 *
 * No-op when the Hardhat node isn't reachable yet - in that case
 * start-dev.sh will start it and deploy fresh anyway.
 */
export async function resetHardhatChain(rpcUrl = HARDHAT_RPC) {
  try {
    await rpc(rpcUrl, "hardhat_reset");
    log("Hardhat chain reset to genesis (forces fresh contract deploy)");
  } catch (err) {
    log("Hardhat not reachable for reset (will deploy fresh): " + err.message);
  }
}

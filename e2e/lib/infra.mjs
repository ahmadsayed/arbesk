import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = process.cwd();

// Shared handoff between global setup and global teardown. Playwright loads the
// setup and teardown modules in separate evaluations, so in-memory state (the
// spawned backend pid, whether we started Docker) cannot be shared via module
// scope — it must round-trip through a file.
export const STATE_FILE = path.join(os.tmpdir(), "arbesk-e2e-state.json");

const HARDHAT_RPC = "http://127.0.0.1:8545";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function log(step) {
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[E2E ${ts}] ${step}`);
}

export function isContainerRunning(name) {
  try {
    const out = execSync(
      `docker ps --filter "name=${name}" --filter "status=running" --format "{{.Names}}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    return out.trim().includes(name);
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

async function rpc(method, params = []) {
  const res = await fetch(HARDHAT_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
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
 * No-op when the Hardhat node isn't reachable yet — in that case start-dev.sh
 * will start it and deploy fresh anyway.
 */
export async function resetHardhatChain() {
  try {
    await rpc("hardhat_reset");
    log("Hardhat chain reset to genesis (forces fresh contract deploy)");
  } catch (err) {
    log("Hardhat not reachable for reset (will deploy fresh): " + err.message);
  }
}

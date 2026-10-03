#!/usr/bin/env bun
// Pre-flight for `bun run test:all`: the Hardhat node keeps its chain in
// memory, so a container restart (reboot, `docker compose restart`) leaves it
// at genesis with no contracts and the on-chain integrity tests fail with
// "returned no data (0x)". Only when the free contract has no code do we run
// `start-dev.sh --setup-only` - it wipes volumes and redeploys, so it must not
// run on every test invocation.
import { spawnSync } from "node:child_process";

const HARDHAT_RPC = "http://127.0.0.1:8545";

/**
 * @param {string} method
 * @param {unknown[]} params
 * @returns {Promise<unknown>}
 */
async function rpc(method, params) {
  const res = await fetch(HARDHAT_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = /** @type {{ result?: unknown }} */ (await res.json());
  return body.result;
}

/** @returns {Promise<string | null>} why setup is needed, or null if ready */
async function setupReason() {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) return "CONTRACT_ADDRESS is not set in .env";
  try {
    const code = await rpc("eth_getCode", [address, "latest"]);
    return code && code !== "0x" ? null : `no contract code at ${address}`;
  } catch {
    return `Hardhat not reachable at ${HARDHAT_RPC}`;
  }
}

const reason = await setupReason();
if (!reason) {
  console.log("✅ Local chain has deployed contracts");
  process.exit(0);
}

console.log(`⚙️  ${reason} - running start-dev.sh --setup-only`);
const { status } = spawnSync("./scripts/start-dev.sh", ["--setup-only"], {
  stdio: "inherit",
});
process.exit(status ?? 1);

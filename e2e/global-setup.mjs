import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  log,
  sleep,
  isContainerRunning,
  resetHardhatChain,
  writeState,
} from "./lib/infra.mjs";

function readEnvVar(envPath, key) {
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function patchConfigFile(configPath, freeAddress, paidAddress, usdcAddress) {
  let config = fs.readFileSync(configPath, "utf8");
  // Replace only the address values inside the Hardhat Local config block
  // so that other fields (chainId, blockExplorer, etc.) are preserved.
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?contractAddress: )"[^"]*"/,
    `$1"${freeAddress}"`
  );
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?paidContractAddress: )"[^"]*"/,
    `$1"${paidAddress}"`
  );
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?usdcToken: )"[^"]*"/,
    `$1"${usdcAddress || "0x5FbDB2315678afecb367f032d93F642f64180aa3"}"`
  );
  fs.writeFileSync(configPath, config);
}

function syncNetworkConfigWithDeployedAddresses() {
  const blockchainEnvPath = path.join(ROOT, "blockchain", ".env");
  const networkConfigPath = path.join(
    ROOT,
    "frontend",
    "src",
    "js",
    "blockchain",
    "network-config.js"
  );
  const backendConfigPath = path.join(ROOT, "src", "config.js");

  const freeAddress = readEnvVar(blockchainEnvPath, "CONTRACT_ADDRESS");
  const paidAddress = readEnvVar(blockchainEnvPath, "PAID_CONTRACT_ADDRESS");
  const usdcAddress = readEnvVar(blockchainEnvPath, "USDC_TOKEN");

  if (!freeAddress || !paidAddress) {
    log("WARN: Could not read contract addresses from blockchain/.env; skipping network-config patch");
    return;
  }

  patchConfigFile(networkConfigPath, freeAddress, paidAddress, usdcAddress);
  log(`Patched network-config.js for Hardhat Local: free=${freeAddress} paid=${paidAddress}`);

  if (fs.existsSync(backendConfigPath)) {
    patchConfigFile(backendConfigPath, freeAddress, paidAddress, usdcAddress);
    log(`Patched src/config.js for Hardhat Local: free=${freeAddress} paid=${paidAddress}`);
  }
}

async function waitForPort(port, host = "127.0.0.1", timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${host}:${port}`);
      if (res.ok || res.status === 404) return;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  throw new Error(`Port ${port} did not become ready in ${timeoutMs}ms`);
}

export default async function globalSetup() {
  log("Starting infrastructure...");

  const ipfsRunning = isContainerRunning("arbesk-private-ipfs");
  const hardhatRunning = isContainerRunning("arbesk-hardhat");
  log(`Existing containers: ipfs=${ipfsRunning} hardhat=${hardhatRunning}`);
  const weStartedInfra = !ipfsRunning || !hardhatRunning;

  // Clean-chain reset BEFORE start-dev.sh: if Hardhat is already running we wipe
  // it so the next deploy is fresh (no leftover tokens, reset daily quota).
  // start-dev.sh then sees the old contract has no bytecode and redeploys.
  if (hardhatRunning) {
    await resetHardhatChain();
  }

  log("Running start-dev.sh --setup-only...");
  execSync("./scripts/start-dev.sh --setup-only", {
    stdio: "inherit",
    cwd: ROOT,
    timeout: 300000,
  });
  log("start-dev.sh finished");

  log("Syncing network-config.js with deployed contract addresses...");
  syncNetworkConfigWithDeployedAddresses();
  log("Rebuilding frontend with synced contract addresses...");
  execSync("npm run build:frontend", { stdio: "inherit", cwd: ROOT, timeout: 120000 });
  log("Frontend rebuilt");

  log("Checking backend on 9090...");
  let backendAlreadyRunning = false;
  try {
    const res = await fetch("http://127.0.0.1:9090/studio.html");
    if (res.ok) {
      backendAlreadyRunning = true;
      log("Backend already running on 9090; reusing it");
    }
  } catch {
    // not running — start it
  }

  let backendPid = null;
  if (!backendAlreadyRunning) {
    log("Starting backend on 9090...");
    const backendProcess = spawn("node", ["src/index.js"], {
      cwd: ROOT,
      env: { ...process.env, MOCK_3D_GENERATION: "true" },
      detached: false,
      stdio: "inherit",
    });

    backendProcess.on("error", (err) => {
      console.error("[E2E] backend process error:", err.message);
    });

    backendPid = backendProcess.pid;
    await waitForPort(9090);
    log("Backend ready on 9090");
  }

  // Persist handoff state for teardown (separate module evaluation).
  writeState({ weStartedInfra, backendPid });

  log("Infrastructure ready");

  // Reset the in-memory backend rate limiter so repeated E2E runs do not
  // exhaust the per-wallet generation quota left over from previous runs.
  try {
    const resetRes = await fetch("http://127.0.0.1:9090/api/v1/test/reset-rate-limit", {
      method: "POST",
    });
    if (resetRes.ok) {
      log("Rate limiter reset");
    } else {
      log("WARN: rate-limiter reset endpoint returned " + resetRes.status);
    }
  } catch (err) {
    log("WARN: could not reset rate limiter: " + err.message);
  }
}

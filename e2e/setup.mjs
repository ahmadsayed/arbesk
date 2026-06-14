import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

let weStartedInfra = false;

function log(step) {
  const ts = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`[E2E ${ts}] ${step}`);
}

function isContainerRunning(name) {
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

function readEnvVar(path, key) {
  const content = fs.readFileSync(path, "utf8");
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
  weStartedInfra = !ipfsRunning || !hardhatRunning;

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
  try {
    const res = await fetch("http://127.0.0.1:9090/studio.html");
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    log("Backend already running on 9090; reusing it");
  } catch (err) {
    throw new Error(
      `Backend not reachable on http://127.0.0.1:9090. Please start it manually with: MOCK_3D_GENERATION=true node src/index.js (${err.message})`
    );
  }

  log("Infrastructure ready");
}

export async function globalTeardown() {
  log("Tearing down...");
  if (weStartedInfra) {
    execSync("docker-compose down", { stdio: "inherit", cwd: ROOT, timeout: 60000 });
  } else {
    log("Leaving existing IPFS/Hardhat containers running");
  }
}

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import {
  ROOT,
  E2E_WORKERS,
  portsForWorker,
  log,
  sleep,
  resetHardhatChain,
  writeState,
} from "./lib/infra.mjs";

function readEnvVar(envPath, key) {
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function patchConfigFile(configPath, freeAddress, paidAddress, usdcAddress, hardhatRpc) {
  let config = fs.readFileSync(configPath, "utf8");
  // Replace only the address/rpc values inside the Hardhat Local config block
  // so that other fields (chainId, blockExplorer, etc.) are preserved.
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?contractAddress: )"[^"]*"/,
    `$1"${freeAddress}"`,
  );
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?paidContractAddress: )"[^"]*"/,
    `$1"${paidAddress}"`,
  );
  config = config.replace(
    /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?usdcToken: )"[^"]*"/,
    `$1"${usdcAddress || "0x5FbDB2315678afecb367f032d93F642f64180aa3"}"`,
  );
  if (hardhatRpc) {
    config = config.replace(
      /(\[CHAIN_IDS\.HARDHAT_LOCAL\]: \{[\s\S]*?rpcUrl: )"[^"]*"/,
      `$1"${hardhatRpc}"`,
    );
  }
  fs.writeFileSync(configPath, config);
}

function syncNetworkConfigWithDeployedAddresses(hardhatRpc) {
  const blockchainEnvPath = path.join(ROOT, "blockchain", ".env");
  const networkConfigPath = path.join(
    ROOT,
    "frontend",
    "src",
    "js",
    "blockchain",
    "network-config.js",
  );
  const backendConfigPath = path.join(ROOT, "src", "config.js");

  const freeAddress = readEnvVar(blockchainEnvPath, "CONTRACT_ADDRESS");
  const paidAddress = readEnvVar(blockchainEnvPath, "PAID_CONTRACT_ADDRESS");
  const usdcAddress = readEnvVar(blockchainEnvPath, "USDC_TOKEN");

  if (!freeAddress || !paidAddress) {
    log(
      "WARN: Could not read contract addresses from blockchain/.env; skipping network-config patch",
    );
    return;
  }

  patchConfigFile(networkConfigPath, freeAddress, paidAddress, usdcAddress, hardhatRpc);
  log(
    `Patched network-config.js for Hardhat Local: free=${freeAddress} paid=${paidAddress}`,
  );

  if (fs.existsSync(backendConfigPath)) {
    patchConfigFile(backendConfigPath, freeAddress, paidAddress, usdcAddress, hardhatRpc);
    log(
      `Patched src/config.js for Hardhat Local: free=${freeAddress} paid=${paidAddress}`,
    );
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

async function waitForHardhatRpc(rpcUrl, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
      });
      const data = await res.json();
      if (data.result !== undefined) return;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  throw new Error(`Hardhat RPC ${rpcUrl} did not become ready in ${timeoutMs}ms`);
}

async function waitForIpfsApi(apiUrl, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${apiUrl}/api/v0/version`, { method: "POST" });
      if (res.ok) return;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  throw new Error(`IPFS API ${apiUrl} did not become ready in ${timeoutMs}ms`);
}

async function waitForNostrRelay(nostrUrl, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(nostrUrl);
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error("timeout"));
        }, 2000);
        ws.on("open", () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        });
        ws.on("error", (err) => {
          clearTimeout(timer);
          ws.terminate();
          reject(err);
        });
      });
      return;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  throw new Error(`Nostr relay ${nostrUrl} did not become ready in ${timeoutMs}ms`);
}

function clearUsdcTokenEnv() {
  const envPath = path.join(ROOT, "blockchain", ".env");
  if (!fs.existsSync(envPath)) return;
  const env = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("USDC_TOKEN="))
    .join("\n");
  fs.writeFileSync(envPath, env);
}

async function startStack(i) {
  const ports = portsForWorker(i);
  log(`Starting stack for worker ${i} (project ${ports.composeProject})...`);

  // Always begin from a clean state for this worker's project.
  try {
    execSync(`docker compose -p "${ports.composeProject}" down --volumes --remove-orphans`, {
      stdio: "ignore",
      cwd: ROOT,
      timeout: 60000,
    });
  } catch {
    // ignore cleanup errors
  }

  const env = {
    ...process.env,
    HARDHAT_HOST_PORT: String(8545 + i),
    IPFS_API_PORT: String(5001 + i),
    IPFS_GW_PORT: String(8080 + i),
    NOSTR_HOST_PORT: String(7777 + i),
  };

  execSync(`docker compose -p "${ports.composeProject}" up -d`, {
    stdio: "inherit",
    cwd: ROOT,
    env,
    timeout: 120000,
  });

  // Wait for the services we need before returning.
  await waitForHardhatRpc(ports.hardhatRpc);
  log(`Worker ${i}: Hardhat RPC ready on ${ports.hardhatRpc}`);
  await waitForIpfsApi(ports.ipfsApiUrl);
  log(`Worker ${i}: IPFS API ready on ${ports.ipfsApiUrl}`);
  await waitForNostrRelay(ports.nostrUrl);
  log(`Worker ${i}: Nostr relay ready on ${ports.nostrUrl}`);
}

async function deployToStack(composeProject) {
  // Force a fresh MockUSDC deploy by removing any cached address.
  clearUsdcTokenEnv();

  // The deploy runs inside the container, so it targets the container's own
  // Hardhat node on port 8545 regardless of the host port mapping.
  execSync(
    `docker compose -p "${composeProject}" exec -T hardhat npx hardhat run scripts/deploy.js --network localhost`,
    {
      stdio: "inherit",
      cwd: ROOT,
      timeout: 120000,
    },
  );
}

async function startBackend(i) {
  const ports = portsForWorker(i);
  log(`Checking backend for worker ${i} on ${ports.backendPort}...`);

  let backendAlreadyRunning = false;
  try {
    const res = await fetch(`${ports.backendUrl}/studio`);
    if (res.ok) {
      backendAlreadyRunning = true;
    }
  } catch {
    // not running - start it
  }

  let backendPid = null;
  if (backendAlreadyRunning) {
    // Only reuse a backend that is actually E2E-compatible. A stray dev
    // backend — e.g. start-dev.sh --testnet (Pinata + Base Sepolia) — would
    // otherwise be reused silently and specs fail with confusing symptoms
    // (IPFS 504s on gateway fetches, indexer returning no owned tokens).
    let cfg = null;
    try {
      const cfgRes = await fetch(`${ports.backendUrl}/api/v1/config`);
      cfg = cfgRes.ok ? await cfgRes.json() : null;
    } catch {
      cfg = null;
    }
    const mismatches = [];
    if (!cfg) {
      mismatches.push("no /api/v1/config");
    } else {
      if (cfg.ipfsBackend !== "kubo")
        mismatches.push(`ipfsBackend=${cfg.ipfsBackend}`);
      if (cfg.mockGeneration !== true) mismatches.push("mockGeneration off");
      if (cfg.hardhatRpcUrl !== ports.hardhatRpc)
        mismatches.push(`hardhatRpcUrl=${cfg.hardhatRpcUrl}`);
    }
    if (mismatches.length > 0) {
      throw new Error(
        `Worker ${i}: a foreign backend is occupying ${ports.backendUrl} ` +
          `(${mismatches.join(", ")}). Stop it (e.g. the start-dev.sh dev ` +
          `server) and re-run the E2E suite.`,
      );
    }
    log(
      `Worker ${i}: compatible backend already running on ${ports.backendPort}; reusing it`,
    );
  }

  if (!backendAlreadyRunning) {
    log(`Worker ${i}: starting backend on ${ports.backendPort}...`);
    const backendProcess = spawn("node", ["src/index.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(ports.backendPort),
        API_URL: ports.hardhatRpc,
        HARDHAT_RPC_URL: ports.hardhatRpc,
        IPFS_API_URL: ports.ipfsApiUrl,
        IPFS_GATEWAY_URL: `${ports.ipfsGatewayUrl}/ipfs/`,
        NOSTR_RELAY_URL: ports.nostrUrl,
        IPFS_BACKEND: "kubo",
        MOCK_3D_GENERATION: "true",
        // E2E repeatedly decomposes glTF nodes and mints upload credentials;
        // keep the per-minute credential limit from blocking the suite.
        UPLOAD_URL_RATE_LIMIT_MAX: "9999",
      },
      detached: false,
      stdio: "inherit",
    });

    backendProcess.on("error", (err) => {
      console.error(`[E2E] backend process error (worker ${i}):`, err.message);
    });

    backendPid = backendProcess.pid;
    await waitForPort(ports.backendPort);
    log(`Worker ${i}: backend ready on ${ports.backendPort}`);
  }

  // Reset the in-memory backend rate limiter so repeated E2E runs do not
  // exhaust the per-wallet generation quota left over from previous runs.
  try {
    const resetRes = await fetch(
      `${ports.backendUrl}/api/v1/test/reset-rate-limit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (resetRes.ok) {
      log(`Worker ${i}: rate limiter reset`);
    } else {
      log(
        `Worker ${i}: WARN: rate-limiter reset endpoint returned ${resetRes.status}`,
      );
    }
  } catch (err) {
    log(`Worker ${i}: WARN: could not reset rate limiter: ${err.message}`);
  }

  return {
    workerIndex: i,
    composeProject: ports.composeProject,
    backendPid,
    backendPort: ports.backendPort,
    weStartedInfra: true,
  };
}

export default async function globalSetup() {
  log(`Starting infrastructure for ${E2E_WORKERS} E2E worker(s)...`);

  // Phase 1: start all Docker stacks in parallel.
  await Promise.all(
    Array.from({ length: E2E_WORKERS }, (_, i) => startStack(i)),
  );
  log("All Docker stacks ready");

  // Phase 2: compile once. blockchain/artifacts is host-mounted and shared
  // across all Hardhat containers.
  const ports0 = portsForWorker(0);
  log("Compiling contracts once (shared artifacts)...");
  execSync(
    `docker compose -p "${ports0.composeProject}" exec -T hardhat npx hardhat compile`,
    {
      stdio: "inherit",
      cwd: ROOT,
      timeout: 120000,
    },
  );
  log("Contracts compiled");

  // Phase 3: deploy sequentially per worker. Sequential avoids a race writing
  // the shared blockchain/.env; deterministic addresses mean order is irrelevant.
  for (let i = 0; i < E2E_WORKERS; i++) {
    const ports = portsForWorker(i);
    log(`Deploying contracts for worker ${i}...`);
    await resetHardhatChain(ports.hardhatRpc);
    await deployToStack(ports.composeProject);
    log(`Worker ${i}: contracts deployed`);
  }

  // Phase 4: sync addresses and build frontend once. Contract addresses are
  // identical across workers, so a single build serves all workers.
  log("Syncing network-config.js with deployed contract addresses...");
  syncNetworkConfigWithDeployedAddresses(ports0.hardhatRpc);
  log("Rebuilding frontend with synced contract addresses...");
  execSync("npm run build:frontend", {
    stdio: "inherit",
    cwd: ROOT,
    timeout: 120000,
  });
  log("Frontend rebuilt");

  // Phase 5: start backends in parallel.
  const workers = await Promise.all(
    Array.from({ length: E2E_WORKERS }, (_, i) => startBackend(i)),
  );

  // Persist handoff state for teardown (separate module evaluation).
  writeState({ workers });

  log("Infrastructure ready");
}

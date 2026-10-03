import { spawn } from "node:child_process";
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
  rpc,
  run,
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
    "network-config.ts",
  );
  const backendConfigPath = path.join(ROOT, "src", "config.ts");

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
    `Patched network-config.ts for Hardhat Local: free=${freeAddress} paid=${paidAddress}`,
  );

  if (fs.existsSync(backendConfigPath)) {
    patchConfigFile(backendConfigPath, freeAddress, paidAddress, usdcAddress, hardhatRpc);
    log(
      `Patched src/config.ts for Hardhat Local: free=${freeAddress} paid=${paidAddress}`,
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
    await run(
      `docker compose -p "${ports.composeProject}" down --volumes --remove-orphans >/dev/null 2>&1`,
      { timeout: 60000 },
    );
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

  await run(`docker compose -p "${ports.composeProject}" up -d`, { env });

  // Wait for the services we need before returning.
  await waitForHardhatRpc(ports.hardhatRpc);
  log(`Worker ${i}: Hardhat RPC ready on ${ports.hardhatRpc}`);
  await waitForIpfsApi(ports.ipfsApiUrl);
  log(`Worker ${i}: IPFS API ready on ${ports.ipfsApiUrl}`);
  await waitForNostrRelay(ports.nostrUrl);
  log(`Worker ${i}: Nostr relay ready on ${ports.nostrUrl}`);
}

/**
 * @param {string} composeProject
 * @param {boolean} writesSharedFiles true for exactly one stack: deploy.js
 *   read-modify-writes the host-mounted blockchain/.env and deployments/, so
 *   the concurrent deploys must leave them alone (DEPLOY_SKIP_SHARED_WRITES).
 *   They still get a fresh MockUSDC: an empty USDC_TOKEN wins over .env
 *   because dotenv never overrides variables that are already set.
 */
async function deployToStack(composeProject, writesSharedFiles) {
  if (writesSharedFiles) {
    // Force a fresh MockUSDC deploy by removing any cached address.
    clearUsdcTokenEnv();
  }
  const envFlags = writesSharedFiles
    ? ""
    : "-e DEPLOY_SKIP_SHARED_WRITES=1 -e USDC_TOKEN= ";

  // The deploy runs inside the container, so it targets the container's own
  // Hardhat node on port 8545 regardless of the host port mapping.
  await run(
    `docker compose -p "${composeProject}" exec -T ${envFlags}hardhat npx hardhat run scripts/deploy.js --network localhost`,
  );
}

/**
 * Fail fast if a stack that skipped the shared writes did not end up with
 * contracts at the addresses the first deploy recorded.
 */
async function assertContractsDeployed(i) {
  const envPath = path.join(ROOT, "blockchain", ".env");
  const { hardhatRpc } = portsForWorker(i);
  for (const key of ["CONTRACT_ADDRESS", "PAID_CONTRACT_ADDRESS", "USDC_TOKEN"]) {
    const address = readEnvVar(envPath, key);
    const code = address ? await rpc(hardhatRpc, "eth_getCode", [address, "latest"]) : null;
    if (!code || code === "0x") {
      throw new Error(`Worker ${i}: no contract code for ${key}=${address} on ${hardhatRpc}`);
    }
  }
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
    const backendProcess = spawn("bun", ["src/index.ts"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(ports.backendPort),
        API_URL: ports.hardhatRpc,
        HARDHAT_RPC_URL: ports.hardhatRpc,
        IPFS_API_URL: ports.ipfsApiUrl,
        IPFS_GATEWAY_URL: `${ports.ipfsGatewayUrl}/ipfs/`,
        NOSTR_RELAY_URL: ports.nostrUrl,
        // Browser-facing relay: without it the page falls back to host:7777,
        // which is worker 0's relay on every parallel stack.
        PUBLIC_NOSTR_URL: ports.nostrUrl,
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

  // Step 1: start all Docker stacks in parallel.
  await Promise.all(
    Array.from({ length: E2E_WORKERS }, (_, i) => startStack(i)),
  );
  log("All Docker stacks ready");

  // Step 2: compile once. blockchain/artifacts is host-mounted and shared
  // across all Hardhat containers.
  const ports0 = portsForWorker(0);
  log("Compiling contracts once (shared artifacts)...");
  await run(
    `docker compose -p "${ports0.composeProject}" exec -T hardhat npx hardhat compile`,
  );
  log("Contracts compiled");

  const deployWorker = async (i) => {
    log(`Deploying contracts for worker ${i}...`);
    await resetHardhatChain(portsForWorker(i).hardhatRpc);
    await deployToStack(portsForWorker(i).composeProject, i === 0);
    log(`Worker ${i}: contracts deployed`);
  };

  // Step 3: worker 0 deploys alone and records the addresses in the shared
  // blockchain/.env + deployments/. Addresses are deterministic (same
  // deployer, fresh chain), so they hold for every worker.
  await deployWorker(0);

  // Step 4: the remaining workers deploy concurrently (no shared writes)
  // while the frontend is built once from worker 0's addresses.
  const buildFrontend = async () => {
    log("Syncing network-config.ts with deployed contract addresses...");
    syncNetworkConfigWithDeployedAddresses(ports0.hardhatRpc);
    log("Rebuilding frontend with synced contract addresses...");
    await run("bun run build:frontend");
    log("Frontend rebuilt");
  };
  const deployOthers = async () => {
    const others = Array.from({ length: E2E_WORKERS - 1 }, (_, k) => k + 1);
    await Promise.all(others.map(deployWorker));
    await Promise.all(others.map(assertContractsDeployed));
  };
  await Promise.all([buildFrontend(), deployOthers()]);

  // Step 5: start backends in parallel.
  const workers = await Promise.all(
    Array.from({ length: E2E_WORKERS }, (_, i) => startBackend(i)),
  );

  // Persist handoff state for teardown (separate module evaluation).
  writeState({ workers });

  log("Infrastructure ready");
}

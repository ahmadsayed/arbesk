import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BLOCKCHAIN_ENV = path.join(ROOT, "blockchain", ".env");
const ROOT_ENV = path.join(ROOT, ".env");

let backendProc = null;

async function waitForPort(port, host = "127.0.0.1", timeoutMs = 60000) {
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

async function deployContracts() {
  console.log("[E2E] Deploying contracts to Hardhat...");
  execSync(
    "docker-compose run --rm hardhat npx hardhat run scripts/deploy.js --network hardhat",
    { stdio: "inherit", cwd: ROOT }
  );

  const blockchainEnv = fs.readFileSync(BLOCKCHAIN_ENV, "utf8");
  const lines = blockchainEnv.split("\n").filter((line) =>
    /^(CONTRACT_ADDRESS|PAID_CONTRACT_ADDRESS|USDC_ADDRESS)=/.test(line)
  );
  if (!lines.length) {
    throw new Error("Deploy did not produce contract addresses in blockchain/.env");
  }
  let rootEnv = fs.existsSync(ROOT_ENV) ? fs.readFileSync(ROOT_ENV, "utf8") : "";
  for (const line of lines) {
    const [key] = line.split("=");
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(rootEnv)) {
      rootEnv = rootEnv.replace(regex, line);
    } else {
      rootEnv += `\n${line}`;
    }
  }
  fs.writeFileSync(ROOT_ENV, rootEnv.trim() + "\n");
  console.log("[E2E] Synced contract addresses to root .env");
}

function startBackend() {
  console.log("[E2E] Starting backend...");
  backendProc = spawn("node", ["src/index.js"], {
    cwd: ROOT,
    env: { ...process.env, MOCK_3D_GENERATION: "true" },
    stdio: "inherit",
  });
}

export default async function globalSetup() {
  console.log("[E2E] Starting infrastructure...");
  execSync("docker-compose up -d ipfs hardhat", { stdio: "inherit", cwd: ROOT });

  await waitForPort(5001); // IPFS API
  await waitForPort(8545); // Hardhat RPC

  await deployContracts();

  execSync("npm run build:frontend", { stdio: "inherit", cwd: ROOT });
  startBackend();
  await waitForPort(9090); // Express backend

  console.log("[E2E] Infrastructure ready");
}

export async function globalTeardown() {
  console.log("[E2E] Tearing down...");
  if (backendProc) {
    backendProc.kill("SIGTERM");
    await sleep(2000);
    if (!backendProc.killed) backendProc.kill("SIGKILL");
  }
  execSync("docker-compose down", { stdio: "inherit", cwd: ROOT });
}

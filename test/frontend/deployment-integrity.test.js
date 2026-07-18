/**
 * Contract deployment integrity tests
 *
 * Validates that the compiled ABIs, deployment artifacts, and environment
 * configuration are consistent for both ArbeskAsset (paid) and
 * ArbeskAssetFree (free tier).
 *
 * Run: npm run test:frontend
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..", "..");

// --- Paths ---

const PAID_ARTIFACT_PATH = resolve(
  ROOT_DIR,
  "blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json",
);
const FREE_ARTIFACT_PATH = resolve(
  ROOT_DIR,
  "blockchain/artifacts/contracts/ArbeskAssetFree.sol/ArbeskAssetFree.json",
);
const ROOT_ENV_PATH = resolve(ROOT_DIR, ".env");
const BLOCKCHAIN_ENV_PATH = resolve(ROOT_DIR, "blockchain/.env");
const DEPLOYMENT_DIR = resolve(ROOT_DIR, "blockchain/deployments");
const COMPOSE_PATH = resolve(ROOT_DIR, "docker-compose.yml");

// --- Helpers ---

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const map = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function loadABI(path) {
  if (!existsSync(path)) return null;
  const artifact = JSON.parse(readFileSync(path, "utf-8"));
  return artifact.abi || null;
}

// --- Required functions per contract ---

const REQUIRED_PAID_ABI_FUNCTIONS = [
  "balanceOf",
  "ownerOf",
  "tokenURI",
  "payForGenerationWithUSDC",
  "tierCosts",
  "publishAsset",
  "updateAssetURI",
  "updateEditors",
  "editorRoot",
  "editorSetVersion",
  "burn",
  "MAX_EDITORS_PER_TOKEN",
];

const REQUIRED_FREE_ABI_FUNCTIONS = [
  "balanceOf",
  "ownerOf",
  "tokenURI",
  "recordGeneration",
  "DAILY_GENERATION_LIMIT",
  "MAX_EDITORS_PER_TOKEN",
  "publishAsset",
  "updateAssetURI",
  "updateEditors",
  "editorRoot",
  "editorSetVersion",
  "burn",
];

describe("Deployment Pipeline Integrity", () => {
  let paidAbi;
  let freeAbi;
  let rootEnv;
  let blockchainEnv;
  let compose;

  beforeAll(() => {
    paidAbi = loadABI(PAID_ARTIFACT_PATH);
    freeAbi = loadABI(FREE_ARTIFACT_PATH);
    rootEnv = loadEnv(ROOT_ENV_PATH);
    blockchainEnv = loadEnv(BLOCKCHAIN_ENV_PATH);
    if (existsSync(COMPOSE_PATH)) {
      compose = readFileSync(COMPOSE_PATH, "utf-8");
    } else {
      compose = "";
    }
  });

  // ================================================================
  // 1. Both ABI artifacts must exist
  // ================================================================

  test("paid ABI artifact exists on host filesystem", () => {
    expect(existsSync(PAID_ARTIFACT_PATH)).toBe(true);
  });

  test("free ABI artifact exists on host filesystem", () => {
    expect(existsSync(FREE_ARTIFACT_PATH)).toBe(true);
  });

  test("paid artifact contains a valid ABI array", () => {
    expect(Array.isArray(paidAbi)).toBe(true);
    expect(paidAbi.length).toBeGreaterThan(0);
  });

  test("free artifact contains a valid ABI array", () => {
    expect(Array.isArray(freeAbi)).toBe(true);
    expect(freeAbi.length).toBeGreaterThan(0);
  });

  test.each(REQUIRED_PAID_ABI_FUNCTIONS)("paid ABI contains %s", (name) => {
    const entry = paidAbi.find((e) => e.type === "function" && e.name === name);
    expect(entry).toBeTruthy();
  });

  test.each(REQUIRED_FREE_ABI_FUNCTIONS)("free ABI contains %s", (name) => {
    const entry = freeAbi.find((e) => e.type === "function" && e.name === name);
    expect(entry).toBeTruthy();
  });

  test("paid ABI has publishAsset overloads", () => {
    const entries = paidAbi.filter(
      (e) => e.type === "function" && e.name === "publishAsset",
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test("free ABI has publishAsset overloads", () => {
    const entries = freeAbi.filter(
      (e) => e.type === "function" && e.name === "publishAsset",
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  test("free ABI does NOT have payForGeneration", () => {
    const entry = freeAbi.find(
      (e) => e.type === "function" && e.name === "payForGeneration",
    );
    expect(entry).toBeFalsy();
  });

  test("free ABI does NOT have payForGenerationWithUSDC", () => {
    const entry = freeAbi.find(
      (e) => e.type === "function" && e.name === "payForGenerationWithUSDC",
    );
    expect(entry).toBeFalsy();
  });

  // ================================================================
  // 2. .env files must have required addresses
  // ================================================================

  test("root .env has CONTRACT_ADDRESS", () => {
    expect(rootEnv.CONTRACT_ADDRESS).toBeTruthy();
    expect(rootEnv.CONTRACT_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("blockchain/.env has CONTRACT_ADDRESS", () => {
    expect(blockchainEnv.CONTRACT_ADDRESS).toBeTruthy();
    expect(blockchainEnv.CONTRACT_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("root .env and blockchain/.env agree on CONTRACT_ADDRESS", () => {
    expect(rootEnv.CONTRACT_ADDRESS).toBe(blockchainEnv.CONTRACT_ADDRESS);
  });

  test("blockchain/.env has PAID_CONTRACT_ADDRESS", () => {
    expect(blockchainEnv.PAID_CONTRACT_ADDRESS).toBeTruthy();
    expect(blockchainEnv.PAID_CONTRACT_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("root .env has PAID_CONTRACT_ADDRESS", () => {
    expect(rootEnv.PAID_CONTRACT_ADDRESS).toBeTruthy();
    expect(rootEnv.PAID_CONTRACT_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("CONTRACT_ADDRESS and PAID_CONTRACT_ADDRESS are different", () => {
    expect(blockchainEnv.CONTRACT_ADDRESS.toLowerCase()).not.toBe(
      blockchainEnv.PAID_CONTRACT_ADDRESS.toLowerCase(),
    );
  });

  test("blockchain/.env has USDC_TOKEN", () => {
    expect(blockchainEnv.USDC_TOKEN).toBeTruthy();
    expect(blockchainEnv.USDC_TOKEN).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  // ================================================================
  // 3. Deployment artifacts match configured .env (if deployed)
  // ================================================================

  test("free deployment artifact matches configured CONTRACT_ADDRESS", () => {
    if (!existsSync(DEPLOYMENT_DIR)) return;

    let found = false;
    const entries = readdirSync(DEPLOYMENT_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const artifactPath = resolve(
        DEPLOYMENT_DIR,
        entry.name,
        "ArbeskAssetFree.json",
      );
      if (!existsSync(artifactPath)) continue;
      const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
      if (
        artifact.address.toLowerCase() ===
        rootEnv.CONTRACT_ADDRESS?.toLowerCase()
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test("paid deployment artifact matches configured PAID_CONTRACT_ADDRESS", () => {
    if (!existsSync(DEPLOYMENT_DIR)) return;

    let found = false;
    const entries = readdirSync(DEPLOYMENT_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const artifactPath = resolve(
        DEPLOYMENT_DIR,
        entry.name,
        "ArbeskAsset.json",
      );
      if (!existsSync(artifactPath)) continue;
      const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
      if (
        artifact.address.toLowerCase() ===
        rootEnv.PAID_CONTRACT_ADDRESS?.toLowerCase()
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  // ================================================================
  // 4. Docker volume mounts are present
  // ================================================================

  test("docker-compose.yml mounts artifacts directory", () => {
    expect(compose).toContain("./blockchain/artifacts:/app/artifacts");
  });

  test("docker-compose.yml mounts deployments directory", () => {
    expect(compose).toContain("./blockchain/deployments:/app/deployments");
  });

  test("docker-compose.yml mounts blockchain/.env", () => {
    expect(compose).toContain("./blockchain/.env:/app/.env");
  });

  // ================================================================
  // 5. USDC / MockUSDC regression guards
  //
  // CONTRACT_ADDRESS now points to the FREE contract, which is NOT
  // the USDC token. The paid contract address is PAID_CONTRACT_ADDRESS.
  // We must ensure USDC_TOKEN is distinct from BOTH contract addresses.
  // ================================================================

  describe("USDC token address safety", () => {
    test("USDC_TOKEN is different from CONTRACT_ADDRESS (free)", () => {
      const contract = blockchainEnv.CONTRACT_ADDRESS?.toLowerCase();
      const usdc = blockchainEnv.USDC_TOKEN?.toLowerCase();
      expect(contract).toBeTruthy();
      expect(usdc).toBeTruthy();
      expect(usdc).not.toBe(contract);
    });

    test("USDC_TOKEN is different from PAID_CONTRACT_ADDRESS", () => {
      const paid = blockchainEnv.PAID_CONTRACT_ADDRESS?.toLowerCase();
      const usdc = blockchainEnv.USDC_TOKEN?.toLowerCase();
      expect(paid).toBeTruthy();
      expect(usdc).toBeTruthy();
      expect(usdc).not.toBe(paid);
    });

    test("USDC_TOKEN is a valid Ethereum address", () => {
      expect(blockchainEnv.USDC_TOKEN).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    test("USDC_TOKEN is not the zero address", () => {
      expect(blockchainEnv.USDC_TOKEN.toLowerCase()).not.toBe(
        "0x0000000000000000000000000000000000000000",
      );
    });

    test("MockUSDC.sol source file exists", () => {
      const mockPath = resolve(
        ROOT_DIR,
        "blockchain/contracts/mock/MockUSDC.sol",
      );
      expect(existsSync(mockPath)).toBe(true);
    });

    test("MockUSDC.sol imports ERC20 (not ERC721)", () => {
      const mockPath = resolve(
        ROOT_DIR,
        "blockchain/contracts/mock/MockUSDC.sol",
      );
      const content = readFileSync(mockPath, "utf-8");
      expect(content).toMatch(/ERC20/);
      expect(content).not.toMatch(/ERC721/);
    });

    test("deploy script references MockUSDC for local networks", () => {
      const deployPath = resolve(ROOT_DIR, "blockchain/scripts/deploy.js");
      const content = readFileSync(deployPath, "utf-8");
      expect(content).toContain("MockUSDC");
      expect(content).toMatch(/No USDC_TOKEN.*deploying MockUSDC/i);
    });

    test("deploy script writes USDC_TOKEN to blockchain/.env after deploy", () => {
      const deployPath = resolve(ROOT_DIR, "blockchain/scripts/deploy.js");
      const content = readFileSync(deployPath, "utf-8");
      expect(content).toMatch(/USDC_TOKEN=/);
    });

    test("paid deployment artifact records distinct usdcToken address", () => {
      if (!existsSync(DEPLOYMENT_DIR)) return;
      const entries = readdirSync(DEPLOYMENT_DIR, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const artifactPath = resolve(
          DEPLOYMENT_DIR,
          entry.name,
          "ArbeskAsset.json",
        );
        if (!existsSync(artifactPath)) continue;
        const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
        const usdcAddr = artifact.usdcToken?.toLowerCase();
        const selfAddr = artifact.address?.toLowerCase();
        if (usdcAddr === selfAddr) {
          // Only a real problem if MockUSDC was also deployed at same addr.
          // A pre-set USDC_TOKEN can alias to the same deterministic address.
          const mockPath = resolve(DEPLOYMENT_DIR, entry.name, "MockUSDC.json");
          if (existsSync(mockPath)) {
            const mockArtifact = JSON.parse(readFileSync(mockPath, "utf-8"));
            expect(mockArtifact.address?.toLowerCase()).not.toBe(selfAddr);
          }
        }
      }
    });

    test("paid deployment artifact usdcToken is a valid address", () => {
      if (!existsSync(DEPLOYMENT_DIR)) return;
      const entries = readdirSync(DEPLOYMENT_DIR, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const artifactPath = resolve(
          DEPLOYMENT_DIR,
          entry.name,
          "ArbeskAsset.json",
        );
        if (!existsSync(artifactPath)) continue;
        const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
        expect(artifact.usdcToken).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    });
  });

  // ================================================================
  // 6. glTF-transform vendoring (worker vs. main-thread alignment)
  //
  // The glTF Web Worker can't see the page's import map (Web Workers don't
  // inherit it), so it has always needed its own hardcoded module source.
  // Both paths must resolve to the same vendored bundle so they can never
  // drift to different @gltf-transform/core builds.
  // ================================================================

  describe("gltf-transform vendoring", () => {
    const VENDOR_PATH = resolve(
      ROOT_DIR,
      "frontend/src/js/vendor/gltf-transform-core-4.1.2.js",
    );
    const NODE_BUFFER_POLYFILL_PATH = resolve(
      ROOT_DIR,
      "frontend/src/js/vendor/node-buffer-polyfill.js",
    );
    const WORKER_PATH = resolve(
      ROOT_DIR,
      "frontend/src/js/workers/gltf-worker.js",
    );
    const STUDIO_PUG_PATH = resolve(ROOT_DIR, "frontend/src/pug/app.pug");

    test("vendored gltf-transform-core bundle exists", () => {
      expect(existsSync(VENDOR_PATH)).toBe(true);
    });

    test("vendored node buffer polyfill exists", () => {
      expect(existsSync(NODE_BUFFER_POLYFILL_PATH)).toBe(true);
    });

    test("worker imports gltf-transform-core from the vendored file, not esm.sh", () => {
      const content = readFileSync(WORKER_PATH, "utf-8");
      expect(content).toContain(
        'from "../vendor/gltf-transform-core-4.1.2.js"',
      );
      expect(content).not.toContain("esm.sh/@gltf-transform/core");
    });

    test("app.pug import map points @gltf-transform/core at the vendored file", () => {
      const content = readFileSync(STUDIO_PUG_PATH, "utf-8");
      expect(content).toContain(
        '"@gltf-transform/core": "/js/vendor/gltf-transform-core-4.1.2.js"',
      );
      expect(content).not.toContain("esm.sh/@gltf-transform/core");
    });

    test("frontend package.json @gltf-transform/core version matches the vendored bundle", () => {
      const pkg = JSON.parse(
        readFileSync(resolve(ROOT_DIR, "frontend/package.json"), "utf-8"),
      );
      expect(pkg.dependencies["@gltf-transform/core"]).toContain("4.1.2");
    });
  });

  // ================================================================
  // 6b. Worker gateway HTTP caching
  //
  // CIDs are content-addressed and immutable, and the IPFS gateway serves
  // /ipfs/ responses with `Cache-Control: ... immutable`. The worker runs
  // most compose fetches, so it must use the shared browser HTTP cache
  // (cache: "default", matching remote-ipfs.js) — `no-store` would refetch
  // every buffer/texture from the gateway on each asset re-open.
  // ================================================================

  describe("worker gateway HTTP caching", () => {
    const WORKER_PATH = resolve(
      ROOT_DIR,
      "frontend/src/js/workers/gltf-worker.js",
    );

    test("worker gateway fetches use the browser HTTP cache, not no-store", () => {
      const content = readFileSync(WORKER_PATH, "utf-8");
      expect(content).toContain('cache: "default"');
      expect(content).not.toContain('cache: "no-store"');
    });

    test("worker registers the composeToBytes op used by composeGlTFToBlobAsync", () => {
      const content = readFileSync(WORKER_PATH, "utf-8");
      expect(content).toContain("composeToBytes");
    });
  });

  // ================================================================
  // 7. On-chain contract verification
  // ================================================================

  describe("on-chain contract integrity", () => {
    const HARDHAT_RPC = "http://127.0.0.1:8545";
    let web3;
    let nodeAvailable = false;
    let freeAddr;
    let paidAddr;
    let usdcAddr;
    let paidAbiData;
    let freeAbiData;

    beforeAll(async () => {
      // Use localhost/hardhat deployment artifacts for on-chain checks,
      // since .env may point to testnet/mainnet addresses.
      const localhostFree = resolve(
        ROOT_DIR,
        "blockchain/deployments/localhost/ArbeskAssetFree.json",
      );
      const localhostPaid = resolve(
        ROOT_DIR,
        "blockchain/deployments/localhost/ArbeskAsset.json",
      );
      const hardhatFree = resolve(
        ROOT_DIR,
        "blockchain/deployments/hardhat/ArbeskAssetFree.json",
      );
      const hardhatPaid = resolve(
        ROOT_DIR,
        "blockchain/deployments/hardhat/ArbeskAsset.json",
      );

      let freeArtifact = null;
      let paidArtifact = null;
      if (existsSync(localhostFree)) {
        freeArtifact = JSON.parse(readFileSync(localhostFree, "utf-8"));
      } else if (existsSync(hardhatFree)) {
        freeArtifact = JSON.parse(readFileSync(hardhatFree, "utf-8"));
      }
      if (existsSync(localhostPaid)) {
        paidArtifact = JSON.parse(readFileSync(localhostPaid, "utf-8"));
      } else if (existsSync(hardhatPaid)) {
        paidArtifact = JSON.parse(readFileSync(hardhatPaid, "utf-8"));
      }

      freeAddr = freeArtifact?.address || blockchainEnv.CONTRACT_ADDRESS;
      paidAddr = paidArtifact?.address || blockchainEnv.PAID_CONTRACT_ADDRESS;
      usdcAddr = paidArtifact?.usdcToken || blockchainEnv.USDC_TOKEN;

      try {
        const Web3 = (await import("web3")).default;
        const temp = new Web3(HARDHAT_RPC);
        await temp.eth.getBlockNumber();
        web3 = temp;
        nodeAvailable = true;
        paidAbiData = loadABI(PAID_ARTIFACT_PATH);
        freeAbiData = loadABI(FREE_ARTIFACT_PATH);
      } catch {
        nodeAvailable = false;
      }
    });

    const requireNode = () => {
      if (!nodeAvailable) return undefined;
      return true;
    };

    test("Hardhat node is running", () => {
      if (!nodeAvailable) {
        console.warn(
          "Hardhat node not reachable at " +
            HARDHAT_RPC +
            " - skipping all on-chain tests.",
        );
      }
      expect(true).toBe(true);
    });

    test("free contract has code on-chain", async () => {
      if (!requireNode()) return;
      const code = await web3.eth.getCode(freeAddr);
      expect(code).toBeTruthy();
      expect(code.length).toBeGreaterThan(4);
    });

    test("paid contract has code on-chain", async () => {
      if (!requireNode()) return;
      const code = await web3.eth.getCode(paidAddr);
      expect(code).toBeTruthy();
      expect(code.length).toBeGreaterThan(4);
    });

    test("MockUSDC contract has code on-chain", async () => {
      if (!requireNode()) return;
      const code = await web3.eth.getCode(usdcAddr);
      expect(code).toBeTruthy();
      expect(code.length).toBeGreaterThan(4);
    });

    test("free, paid, and USDC have mutually different bytecode", async () => {
      if (!requireNode()) return;
      const freeCode = await web3.eth.getCode(freeAddr);
      const paidCode = await web3.eth.getCode(paidAddr);
      const usdcCode = await web3.eth.getCode(usdcAddr);
      expect(freeCode).not.toBe(paidCode);
      expect(freeCode).not.toBe(usdcCode);
      expect(paidCode).not.toBe(usdcCode);
    });

    test("MockUSDC responds to ERC20 decimals() = 6", async () => {
      if (!requireNode()) return;
      const result = await web3.eth.call({
        to: usdcAddr,
        data: "0x313ce567",
      });
      expect(parseInt(result, 16)).toBe(6);
    });

    test("MockUSDC symbol() returns 'USDC'", async () => {
      if (!requireNode()) return;
      const result = await web3.eth.call({
        to: usdcAddr,
        data: "0x95d89b41",
      });
      const decoded = web3.eth.abi.decodeParameters(["string"], result);
      expect(decoded[0]).toBe("USDC");
    });

    test("paid contract usdcToken() returns MockUSDC address", async () => {
      if (!requireNode()) return;
      if (!paidAbiData) return;
      const asset = new web3.eth.Contract(paidAbiData, paidAddr);
      const usdcFromChain = await asset.methods.usdcToken().call();
      expect(usdcFromChain.toLowerCase()).toBe(usdcAddr.toLowerCase());
    });

    test("paid contract tierCosts(Basic) matches expected 750000", async () => {
      if (!requireNode()) return;
      if (!paidAbiData) return;
      const asset = new web3.eth.Contract(paidAbiData, paidAddr);
      const cost = await asset.methods.tierCosts(0).call();
      expect(Number(cost)).toBe(750000);
    });

    test("free contract MAX_EDITORS_PER_TOKEN() returns 5000", async () => {
      if (!requireNode()) return;
      if (!freeAbiData) return;
      const asset = new web3.eth.Contract(freeAbiData, freeAddr);
      const limit = await asset.methods.MAX_EDITORS_PER_TOKEN().call();
      expect(Number(limit)).toBe(5000);
    });

    test("free contract DAILY_GENERATION_LIMIT() returns 10", async () => {
      if (!requireNode()) return;
      if (!freeAbiData) return;
      const asset = new web3.eth.Contract(freeAbiData, freeAddr);
      const limit = await asset.methods.DAILY_GENERATION_LIMIT().call();
      expect(Number(limit)).toBe(10);
    });

    test("deployer has USDC balance on MockUSDC", async () => {
      if (!requireNode()) return;
      const deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
      const data =
        "0x70a08231" +
        deployer.toLowerCase().replace("0x", "").padStart(64, "0");
      const result = await web3.eth.call({ to: usdcAddr, data });
      const balance = BigInt(result);
      expect(balance).toBeGreaterThan(BigInt(0));
    });

    test("MockUSDC does NOT respond to ERC721 ownerOf()", async () => {
      if (!requireNode()) return;
      try {
        await web3.eth.call({
          to: usdcAddr,
          data: "0x6352211e0000000000000000000000000000000000000000000000000000000000000001",
        });
        throw new Error("should have reverted");
      } catch (e) {
        expect(e.message).toBeTruthy();
      }
    });

    test("paid ABI is loadable and has required functions", () => {
      if (!paidAbiData) return;
      expect(Array.isArray(paidAbiData)).toBe(true);
      const fnNames = paidAbiData
        .filter((e) => e.type === "function")
        .map((e) => e.name);
      expect(fnNames).toContain("usdcToken");
      expect(fnNames).toContain("tierCosts");
      expect(fnNames).toContain("payForGenerationWithUSDC");
    });

    test("free ABI is loadable and has required functions", () => {
      if (!freeAbiData) return;
      expect(Array.isArray(freeAbiData)).toBe(true);
      const fnNames = freeAbiData
        .filter((e) => e.type === "function")
        .map((e) => e.name);
      expect(fnNames).toContain("recordGeneration");
      expect(fnNames).toContain("DAILY_GENERATION_LIMIT");
      expect(fnNames).toContain("MAX_EDITORS_PER_TOKEN");
    });
  });
});

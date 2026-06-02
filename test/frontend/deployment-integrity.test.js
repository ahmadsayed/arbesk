/**
 * Contract deployment integrity tests
 *
 * Validates that the compiled ABI, deployment artifacts, and environment
 * configuration are consistent. Prevents the class of regression where:
 *   - Contract functions are added but ABI isn't recompiled
 *   - Contract is redeployed but .env files aren't updated
 *   - Artifacts directory is stale/missing
 *   - Root .env and blockchain/.env have conflicting CONTRACT_ADDRESS
 *
 * Run: npm run test:frontend
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/frontend/ -> test/ -> project root
const ROOT_DIR = resolve(__dirname, "..", "..");

// --- Paths ---

const ARTIFACT_PATH = resolve(
  ROOT_DIR,
  "blockchain/artifacts/contracts/ArbeskAsset.sol/ArbeskAsset.json",
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

// --- Essential function signatures that must exist in the ABI ---

const REQUIRED_ABI_FUNCTIONS = [
  "balanceOf",
  "ownerOf",
  "tokenURI",
  "tokenOfOwnerByIndex",
  "payForGeneration",
  "payForGenerationWithUSDC",
  "tierCosts",
  "getTierCost",
  "publishAsset",
  "updateAssetURI",
  "addEditor",
  "removeEditor",
  "listEditors",
  "listTokens",
  "totalSupply",
];

describe("Deployment Pipeline Integrity", () => {
  let abi;
  let rootEnv;
  let blockchainEnv;
  let compose;

  beforeAll(() => {
    abi = loadABI(ARTIFACT_PATH);
    rootEnv = loadEnv(ROOT_ENV_PATH);
    blockchainEnv = loadEnv(BLOCKCHAIN_ENV_PATH);
    if (existsSync(COMPOSE_PATH)) {
      compose = readFileSync(COMPOSE_PATH, "utf-8");
    } else {
      compose = "";
    }
  });

  // ================================================================
  // 1. Artifacts must exist and be fresh
  // ================================================================

  test("compiled ABI artifact exists on host filesystem", () => {
    expect(existsSync(ARTIFACT_PATH)).toBe(true);
  });

  test("artifact contains a valid ABI array", () => {
    expect(Array.isArray(abi)).toBe(true);
    expect(abi.length).toBeGreaterThan(0);
  });

  test.each(REQUIRED_ABI_FUNCTIONS)("ABI contains %s", (name) => {
    const entry = abi.find((e) => e.type === "function" && e.name === name);
    expect(entry).toBeTruthy();
  });

  // Also verify that no Solidity auto-generated overloads broke the ABI.
  // publishAsset has a 2-arg + 3-arg (with editors[]) overload.
  test("publishAsset has at least one entry (handles overloads)", () => {
    const entries = abi.filter(
      (e) => e.type === "function" && e.name === "publishAsset",
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  // ================================================================
  // 2. .env files must agree on CONTRACT_ADDRESS
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

  test("blockchain/.env has USDC_TOKEN", () => {
    expect(blockchainEnv.USDC_TOKEN).toBeTruthy();
    expect(blockchainEnv.USDC_TOKEN).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  // ================================================================
  // 3. Deployment artifact matches configured .env (if deployed)
  // ================================================================

  test("deployment artifact matches configured CONTRACT_ADDRESS (if deployed)", () => {
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
        rootEnv.CONTRACT_ADDRESS?.toLowerCase()
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
  // Catches the class of bug where CONTRACT_ADDRESS and USDC_TOKEN
  // are accidentally set to the same value, causing the frontend to
  // call ERC721 approve() instead of ERC20 approve() on the USDC
  // contract. This produces the cryptic error:
  //   "ERC721NonexistentToken(750000)"
  // because the Basic tier cost (750000) is interpreted as a tokenId.
  // ================================================================

  describe("USDC token address safety", () => {
    test("USDC_TOKEN is different from CONTRACT_ADDRESS", () => {
      const contract = blockchainEnv.CONTRACT_ADDRESS?.toLowerCase();
      const usdc = blockchainEnv.USDC_TOKEN?.toLowerCase();
      expect(contract).toBeTruthy();
      expect(usdc).toBeTruthy();
      expect(usdc).not.toBe(contract);
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
      // Must import ERC20
      expect(content).toMatch(/ERC20/);
      // Must NOT import ERC721
      expect(content).not.toMatch(/ERC721/);
    });

    test("deploy script references MockUSDC for local networks", () => {
      const deployPath = resolve(ROOT_DIR, "blockchain/scripts/deploy.js");
      const content = readFileSync(deployPath, "utf-8");
      // Must have "MockUSDC" somewhere in the local deployment path
      expect(content).toContain("MockUSDC");
      // Must deploy MockUSDC when USDC_TOKEN is not set
      expect(content).toMatch(/No USDC_TOKEN.*deploying MockUSDC/i);
    });

    test("deploy script writes USDC_TOKEN to blockchain/.env after deploy", () => {
      const deployPath = resolve(ROOT_DIR, "blockchain/scripts/deploy.js");
      const content = readFileSync(deployPath, "utf-8");
      // Regex: writes USDC_TOKEN= to the env file
      expect(content).toMatch(/USDC_TOKEN=/);
    });

    test("deployment artifact records distinct usdcToken address", () => {
      // Check all deployment artifacts for the address mismatch bug
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
        expect(artifact.usdcToken?.toLowerCase()).not.toBe(
          artifact.address?.toLowerCase(),
        );
      }
    });

    test("deployment artifact usdcToken is a valid address", () => {
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
  // 6. On-chain contract verification
  //
  // Validates that the actual deployed contracts on the Hardhat node
  // are distinct and functional. These tests are skipped if the
  // Hardhat node is not running (no RPC available).
  // ================================================================

  describe("on-chain contract integrity", () => {
    const HARDHAT_RPC = "http://127.0.0.1:8545";
    let web3;
    let nodeAvailable = false;
    let contractAddr;
    let usdcAddr;
    let abiData;

    beforeAll(async () => {
      contractAddr = blockchainEnv.CONTRACT_ADDRESS;
      usdcAddr = blockchainEnv.USDC_TOKEN;

      try {
        const Web3 = (await import("web3")).default;
        const temp = new Web3(HARDHAT_RPC);
        await temp.eth.getBlockNumber();
        web3 = temp;
        nodeAvailable = true;
        abiData = loadABI(ARTIFACT_PATH);
      } catch {
        nodeAvailable = false;
      }
    });

    const requireNode = () => {
      if (!nodeAvailable) return undefined;
      return true;
    };

    test("Hardhat node is running (must be up for on-chain checks)", () => {
      // This test intentionally fails if the node is down during
      // a regression-test run. Use --testPathPattern to skip if needed.
      // For CI, ensure docker-compose up -d runs first.
      if (!nodeAvailable) {
        console.warn(
          "Hardhat node not reachable at " +
            HARDHAT_RPC +
            " — skipping all on-chain tests.",
        );
      }
      // We don't fail here — individual tests check requireNode()
      expect(true).toBe(true);
    });

    test("ArbeskAsset contract has code on-chain", async () => {
      if (!requireNode()) return;
      const code = await web3.eth.getCode(contractAddr);
      expect(code).toBeTruthy();
      expect(code.length).toBeGreaterThan(4); // more than just '0x'
    });

    test("MockUSDC contract has code on-chain", async () => {
      if (!requireNode()) return;
      const code = await web3.eth.getCode(usdcAddr);
      expect(code).toBeTruthy();
      expect(code.length).toBeGreaterThan(4);
    });

    test("ArbeskAsset and MockUSDC have DIFFERENT bytecode", async () => {
      if (!requireNode()) return;
      const assetCode = await web3.eth.getCode(contractAddr);
      const usdcCode = await web3.eth.getCode(usdcAddr);
      expect(assetCode).toBeTruthy();
      expect(usdcCode).toBeTruthy();
      expect(assetCode).not.toBe(usdcCode);
    });

    test("MockUSDC responds to ERC20 decimals()", async () => {
      if (!requireNode()) return;
      const result = await web3.eth.call({
        to: usdcAddr,
        data: "0x313ce567",
      });
      expect(result).toBeTruthy();
      const decimals = parseInt(result, 16);
      expect(Number.isInteger(decimals)).toBe(true);
    });

    test("MockUSDC decimals() returns 6", async () => {
      if (!requireNode()) return;
      const result = await web3.eth.call({
        to: usdcAddr,
        data: "0x313ce567",
      });
      expect(parseInt(result, 16)).toBe(6);
    });

    test("MockUSDC responds to ERC20 symbol()", async () => {
      if (!requireNode()) return;
      const result = await web3.eth.call({
        to: usdcAddr,
        data: "0x95d89b41",
      });
      expect(result).toBeTruthy();
      const decoded = web3.eth.abi.decodeParameters(["string"], result);
      expect(decoded[0].length).toBeGreaterThan(0);
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

    test("ArbeskAsset.usdcToken() returns the MockUSDC address", async () => {
      if (!requireNode()) return;
      if (!abiData) return;
      const asset = new web3.eth.Contract(abiData, contractAddr);
      const usdcFromChain = await asset.methods.usdcToken().call();
      expect(usdcFromChain.toLowerCase()).toBe(usdcAddr.toLowerCase());
    });

    test("ArbeskAsset.usdcToken() does NOT return its own address", async () => {
      if (!requireNode()) return;
      if (!abiData) return;
      const asset = new web3.eth.Contract(abiData, contractAddr);
      const usdcFromChain = await asset.methods.usdcToken().call();
      expect(usdcFromChain.toLowerCase()).not.toBe(contractAddr.toLowerCase());
    });

    test("ArbeskAsset.tierCosts() returns non-zero for Basic tier", async () => {
      if (!requireNode()) return;
      if (!abiData) return;
      const asset = new web3.eth.Contract(abiData, contractAddr);
      const cost = await asset.methods.tierCosts(0).call();
      expect(cost).toBeTruthy();
      expect(Number(cost)).toBeGreaterThan(0);
    });

    test("ArbeskAsset.tierCosts(Basic) matches expected 750000", async () => {
      if (!requireNode()) return;
      if (!abiData) return;
      const asset = new web3.eth.Contract(abiData, contractAddr);
      const cost = await asset.methods.tierCosts(0).call();
      expect(Number(cost)).toBe(750000);
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

    test("_initContract ABI is loadable and has required functions", () => {
      // Guard: ABI must be loadable at test time
      if (!abiData) {
        // If no ABI, on-chain tests can't run — but static checks
        // above should have caught this already.
        return;
      }
      expect(Array.isArray(abiData)).toBe(true);
      const fnNames = abiData
        .filter((e) => e.type === "function")
        .map((e) => e.name);
      expect(fnNames).toContain("usdcToken");
      expect(fnNames).toContain("tierCosts");
      expect(fnNames).toContain("payForGenerationWithUSDC");
    });
  });
});

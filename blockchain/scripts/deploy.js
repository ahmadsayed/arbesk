const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy both ArbeskAsset (paid) and ArbeskAssetFree (free tier) to the selected network.
 *
 * Constructors:
 *   ArbeskAsset(address _treasury, address _usdcToken)
 *   ArbeskAssetFree() — no args
 *
 * USDC addresses:
 *   Optimism Sepolia: 0x5fd84259d66Cd461235407180D3B4c8d0F273e15
 *   Optimism mainnet: 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85
 *   Local/Hardhat: will deploy MockUSDC first unless USDC_TOKEN env is set
 */

// Known USDC addresses per network
const USDC_ADDRESSES = {
  optimismSepolia: "0x5fd84259d66Cd461235407180D3B4c8d0F273e15",
  optimismMainnet: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const network = hre.network.name;
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("Treasury wallet:", treasury);

  // Determine USDC address
  let usdcAddress = process.env.USDC_TOKEN || USDC_ADDRESSES[network];

  // For local networks without a pre-set USDC address, deploy MockUSDC
  if (!usdcAddress && (network === "hardhat" || network === "localhost")) {
    console.log(
      "No USDC_TOKEN env var — deploying MockUSDC for local testing..."
    );
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    console.log("MockUSDC deployed to:", usdcAddress);

    // Mint 1,000,000 USDC to deployer for testing
    const mintAmount = hre.ethers.parseUnits("1000000", 6);
    await mockUsdc.mint(deployer.address, mintAmount);
    console.log("Minted 1,000,000 USDC to deployer for testing");
  }

  if (!usdcAddress) {
    console.warn(
      "WARNING: No USDC address found for network '" +
        network +
        "'. Deploying with address(0) — USDC payments disabled."
    );
    usdcAddress = hre.ethers.ZeroAddress;
  }

  console.log("USDC token address:", usdcAddress);

  // ── Deploy ArbeskAssetFree (free tier) — DEFAULT contract ──
  const ArbeskAssetFree = await hre.ethers.getContractFactory("ArbeskAssetFree");
  const freeAsset = await ArbeskAssetFree.deploy();
  await freeAsset.waitForDeployment();
  const freeAddress = await freeAsset.getAddress();
  console.log("ArbeskAssetFree deployed to:", freeAddress);

  // ── Deploy ArbeskAsset (paid tier) ──
  const ArbeskAsset = await hre.ethers.getContractFactory("ArbeskAsset");
  const paidAsset = await ArbeskAsset.deploy(treasury, usdcAddress);
  await paidAsset.waitForDeployment();
  const paidAddress = await paidAsset.getAddress();
  console.log("ArbeskAsset deployed to:", paidAddress);

  // ── Save deployment artifacts ──
  const deployDir = path.join(__dirname, "..", "deployments", network);
  fs.mkdirSync(deployDir, { recursive: true });

  fs.writeFileSync(
    path.join(deployDir, "ArbeskAssetFree.json"),
    JSON.stringify(
      {
        address: freeAddress,
        deployer: deployer.address,
        blockNumber: await hre.ethers.provider.getBlockNumber(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(deployDir, "ArbeskAsset.json"),
    JSON.stringify(
      {
        address: paidAddress,
        treasury,
        usdcToken: usdcAddress,
        deployer: deployer.address,
        blockNumber: await hre.ethers.provider.getBlockNumber(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log("Deployment artifacts saved to deployments/" + network);

  // ── Update .env for local networks ──
  if (network === "hardhat" || network === "localhost") {
    const envPath = path.join(__dirname, "..", ".env");
    let env = "";
    if (fs.existsSync(envPath)) {
      env = fs.readFileSync(envPath, "utf8");
      // Free contract is the default CONTRACT_ADDRESS
      if (env.includes("CONTRACT_ADDRESS=")) {
        env = env.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${freeAddress}`);
      } else {
        env += `\nCONTRACT_ADDRESS=${freeAddress}\n`;
      }
      // Paid contract stored separately
      if (env.includes("PAID_CONTRACT_ADDRESS=")) {
        env = env.replace(/PAID_CONTRACT_ADDRESS=.*/g, `PAID_CONTRACT_ADDRESS=${paidAddress}`);
      } else {
        env += `\nPAID_CONTRACT_ADDRESS=${paidAddress}\n`;
      }
      if (!env.includes("USDC_TOKEN=")) {
        env += `\nUSDC_TOKEN=${usdcAddress}\n`;
      } else {
        env = env.replace(/USDC_TOKEN=.*/g, `USDC_TOKEN=${usdcAddress}`);
      }
    } else {
      env = `CONTRACT_ADDRESS=${freeAddress}\nPAID_CONTRACT_ADDRESS=${paidAddress}\nUSDC_TOKEN=${usdcAddress}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log("Updated blockchain/.env with CONTRACT_ADDRESS (free) + PAID_CONTRACT_ADDRESS + USDC_TOKEN");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

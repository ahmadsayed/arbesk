const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy ArbeskAsset to the selected network.
 *
 * Constructor: ArbeskAsset(address _treasury, address _usdcToken)
 *
 * USDC addresses:
 *   Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   Local/Hardhat: will deploy MockUSDC first unless USDC_TOKEN env is set
 */

// Known USDC addresses per network
const USDC_ADDRESSES = {
  baseSepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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

  // Deploy ArbeskAsset
  const ArbeskAsset = await hre.ethers.getContractFactory("ArbeskAsset");
  const asset = await ArbeskAsset.deploy(treasury, usdcAddress);
  await asset.waitForDeployment();

  const address = await asset.getAddress();
  console.log("ArbeskAsset deployed to:", address);

  // Save deployment artifact
  const deployDir = path.join(__dirname, "..", "deployments", network);
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(
    path.join(deployDir, "ArbeskAsset.json"),
    JSON.stringify(
      {
        address,
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
  console.log("Deployment artifact saved to deployments/" + network);

  // Update .env with CONTRACT_ADDRESS for local networks
  if (network === "hardhat" || network === "localhost") {
    const envPath = path.join(__dirname, "..", ".env");
    let env = "";
    if (fs.existsSync(envPath)) {
      env = fs.readFileSync(envPath, "utf8");
      env = env.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${address}`);
      if (!env.includes("USDC_TOKEN=")) {
        env += `\nUSDC_TOKEN=${usdcAddress}\n`;
      } else {
        env = env.replace(/USDC_TOKEN=.*/g, `USDC_TOKEN=${usdcAddress}`);
      }
    } else {
      env = `CONTRACT_ADDRESS=${address}\nUSDC_TOKEN=${usdcAddress}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log("Updated blockchain/.env with CONTRACT_ADDRESS + USDC_TOKEN");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

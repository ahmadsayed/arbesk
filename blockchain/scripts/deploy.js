const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploy ArbeskAssetFree (free tier) to the selected network.
 *
 * Network gating:
 *   hardhat / localhost → deploy ArbeskAssetFree + ArbeskAsset (paid) + MockUSDC
 *   megaethTestnet     → deploy ArbeskAssetFree only (no paid, no USDC)
 *   any other          → error
 *
 * ArbeskAssetFree() - no constructor args
 */

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const network = hre.network.name;
  console.log("Network:", network);

  const isLocal = network === "hardhat" || network === "localhost";
  const isTestnet = network === "megaethTestnet";

  if (!isLocal && !isTestnet) {
    console.error(
      `ERROR: Unsupported network "${network}". Supported: hardhat, localhost, megaethTestnet`
    );
    process.exit(1);
  }

  // ── Deploy ArbeskAssetFree (free tier) - always deployed ──
  const ArbeskAssetFree = await hre.ethers.getContractFactory(
    "ArbeskAssetFree"
  );
  const freeAsset = await ArbeskAssetFree.deploy();
  await freeAsset.waitForDeployment();
  const freeAddress = await freeAsset.getAddress();
  console.log("ArbeskAssetFree deployed to:", freeAddress);

  let paidAddress = null;
  let usdcAddress = null;

  if (isLocal) {
    // ── Local: deploy MockUSDC + ArbeskAsset (paid tier) for testing ──
    usdcAddress = process.env.USDC_TOKEN;
    if (!usdcAddress) {
      console.log(
        "No USDC_TOKEN env var - deploying MockUSDC for local testing..."
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

    const treasury = process.env.TREASURY_ADDRESS || deployer.address;
    console.log("Treasury wallet:", treasury);
    console.log("USDC token address:", usdcAddress);

    const ArbeskAsset = await hre.ethers.getContractFactory("ArbeskAsset");
    const paidAsset = await ArbeskAsset.deploy(treasury, usdcAddress);
    await paidAsset.waitForDeployment();
    paidAddress = await paidAsset.getAddress();
    console.log("ArbeskAsset (paid) deployed to:", paidAddress);
  } else {
    // ── Testnet: free tier only ──
    console.log(
      "Skipping ArbeskAsset (paid) and USDC - not deployed on testnet"
    );
  }

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

  if (paidAddress) {
    fs.writeFileSync(
      path.join(deployDir, "ArbeskAsset.json"),
      JSON.stringify(
        {
          address: paidAddress,
          treasury: process.env.TREASURY_ADDRESS || deployer.address,
          usdcToken: usdcAddress,
          deployer: deployer.address,
          blockNumber: await hre.ethers.provider.getBlockNumber(),
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  console.log("Deployment artifacts saved to deployments/" + network);

  // ── Update .env for local networks ──
  if (isLocal) {
    const envPath = path.join(__dirname, "..", ".env");
    let env = "";
    if (fs.existsSync(envPath)) {
      env = fs.readFileSync(envPath, "utf8");
      if (env.includes("CONTRACT_ADDRESS=")) {
        env = env.replace(
          /CONTRACT_ADDRESS=.*/g,
          `CONTRACT_ADDRESS=${freeAddress}`
        );
      } else {
        env += `\nCONTRACT_ADDRESS=${freeAddress}\n`;
      }
      if (env.includes("PAID_CONTRACT_ADDRESS=")) {
        env = env.replace(
          /PAID_CONTRACT_ADDRESS=.*/g,
          `PAID_CONTRACT_ADDRESS=${paidAddress}`
        );
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
    console.log(
      "Updated blockchain/.env with CONTRACT_ADDRESS (free) + PAID_CONTRACT_ADDRESS + USDC_TOKEN"
    );
  }

  if (isTestnet) {
    console.log("\n=== Next steps for MegaETH Testnet ===");
    console.log("1. Copy CONTRACT_ADDRESS to blockchain/.env and root .env:");
    console.log(`   CONTRACT_ADDRESS=${freeAddress}`);
    console.log(
      "2. Update frontend/src/js/blockchain/network-config.js with the new address"
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

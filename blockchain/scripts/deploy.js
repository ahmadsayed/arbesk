const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const treasury = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("Treasury wallet:", treasury);

  const ArbeskAsset = await hre.ethers.getContractFactory("ArbeskAsset");
  const asset = await ArbeskAsset.deploy(treasury);
  await asset.waitForDeployment();

  const address = await asset.getAddress();
  console.log("ArbeskAsset deployed to:", address);

  // Save deployment artifact
  const network = hre.network.name;
  const deployDir = path.join(__dirname, "..", "deployments", network);
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(
    path.join(deployDir, "ArbeskAsset.json"),
    JSON.stringify({
      address,
      treasury,
      deployer: deployer.address,
      blockNumber: await hre.ethers.provider.getBlockNumber(),
      timestamp: new Date().toISOString()
    }, null, 2)
  );

  // Update .env if local network
  if (network === "hardhat" || network === "localhost") {
    const envPath = path.join(__dirname, "..", ".env");
    let env = "";
    if (fs.existsSync(envPath)) {
      env = fs.readFileSync(envPath, "utf8");
      env = env.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${address}`);
    } else {
      env = `CONTRACT_ADDRESS=${address}\n`;
    }
    fs.writeFileSync(envPath, env);
    console.log("Updated blockchain/.env with CONTRACT_ADDRESS");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const hre = require("hardhat");

async function main() {
  // Determine which contract to verify (free tier is the one deployed on testnet)
  const contractName = process.env.VERIFY_CONTRACT || "ArbeskAssetFree";
  // deploy.js writes the testnet free-tier address to BASE_CONTRACT_ADDRESS;
  // local deploys use CONTRACT_ADDRESS.
  const address =
    contractName === "ArbeskAssetFree"
      ? hre.network.name === "baseSepolia"
        ? process.env.BASE_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS
        : process.env.CONTRACT_ADDRESS
      : process.env.PAID_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS;

  const treasury = process.env.TREASURY_ADDRESS;

  if (!address) {
    console.error(
      `Set CONTRACT_ADDRESS (or BASE_CONTRACT_ADDRESS / PAID_CONTRACT_ADDRESS) in .env`
    );
    process.exit(1);
  }

  console.log(`Verifying ${contractName} at:`, address);

  let constructorArguments;
  if (contractName === "ArbeskAssetFree") {
    constructorArguments = [];
  } else {
    // ArbeskAsset (paid tier)
    if (!treasury) {
      console.error("Set TREASURY_ADDRESS in .env for ArbeskAsset verification");
      process.exit(1);
    }
    const usdcAddress = process.env.USDC_TOKEN || hre.ethers.ZeroAddress;
    constructorArguments = [treasury, usdcAddress];
  }

  await hre.run("verify:verify", {
    address,
    constructorArguments,
  });
}

main().catch(console.error);

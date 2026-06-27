const hre = require("hardhat");

async function main() {
  // Determine which contract to verify
  const contractName = process.env.VERIFY_CONTRACT || "ArbeskAsset";
  const address =
    contractName === "ArbeskAssetFree"
      ? process.env.CONTRACT_ADDRESS
      : process.env.PAID_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS;

  const treasury = process.env.TREASURY_ADDRESS;

  if (!address) {
    console.error(`Set CONTRACT_ADDRESS (or PAID_CONTRACT_ADDRESS) in .env`);
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

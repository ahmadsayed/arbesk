const hre = require("hardhat");

async function main() {
  const address = process.env.CONTRACT_ADDRESS;
  const treasury = process.env.TREASURY_ADDRESS;
  if (!address || !treasury) {
    console.error("Set CONTRACT_ADDRESS and TREASURY_ADDRESS in .env");
    process.exit(1);
  }

  console.log("Verifying ArbeskAsset at:", address);
  await hre.run("verify:verify", {
    address,
    constructorArguments: [treasury],
  });
}

main().catch(console.error);

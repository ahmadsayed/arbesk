const hre = require("hardhat");

/**
 * Proxy-aware Basescan verification for the UUPS-upgradeable contracts.
 * @remarks Contracts are deployed behind an ERC1967 proxy, so the
 *   flat-contract `verify:verify` with constructor args does not apply.
 */
async function main() {
  const contractName = process.env.VERIFY_CONTRACT || "ArbeskAssetFree";
  // deploy.js writes the testnet free-tier proxy to BASE_CONTRACT_ADDRESS;
  // local deploys use CONTRACT_ADDRESS.
  const proxyAddress =
    contractName === "ArbeskAssetFree"
      ? hre.network.name === "baseSepolia"
        ? process.env.BASE_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS
        : process.env.CONTRACT_ADDRESS
      : process.env.PAID_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS;

  if (!proxyAddress) {
    console.error(
      `Set CONTRACT_ADDRESS (or BASE_CONTRACT_ADDRESS / PAID_CONTRACT_ADDRESS) in .env`
    );
    process.exit(1);
  }

  const { upgrades } = hre;
  const implAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log(`Proxy (${contractName}): ${proxyAddress}`);
  console.log(`Implementation: ${implAddress}`);

  // Verify the implementation — no constructor args (UUPS uses initialize()).
  await hre.run("verify:verify", { address: implAddress });

  // Verify the proxy (ERC1967Proxy constructor: implementation + empty data).
  await hre.run("verify:verify", {
    address: proxyAddress,
    constructorArguments: [implAddress, "0x"],
  });
}

main().catch(console.error);

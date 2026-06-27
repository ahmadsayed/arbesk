const hre = require("hardhat");

async function main() {
  let tx;
  let receipt;

  const [owner, user] = await hre.ethers.getSigners();

  const FreeFactory = await hre.ethers.getContractFactory("ArbeskAssetFree");
  const free = await FreeFactory.deploy();
  await free.waitForDeployment();

  const PaidFactory = await hre.ethers.getContractFactory("ArbeskAsset");
  const paid = await PaidFactory.deploy(owner.address, hre.ethers.ZeroAddress);
  await paid.waitForDeployment();

  const nodeId = hre.ethers.encodeBytes32String("node_001");
  const prompt = "A modern workbench";

  console.log("\n=== ArbeskAssetFree.recordGeneration() ===");

  // Cold start: first user call
  tx = await free.connect(user).recordGeneration(nodeId, prompt);
  receipt = await tx.wait();
  console.log(`User first call (cold): ${receipt.gasUsed} gas`);

  // Warm: second user call same day
  tx = await free.connect(user).recordGeneration(nodeId, prompt);
  receipt = await tx.wait();
  console.log(`User second call (warm): ${receipt.gasUsed} gas`);

  // Owner calls
  tx = await free.connect(owner).recordGeneration(nodeId, prompt);
  receipt = await tx.wait();
  console.log(`Owner first call (cold): ${receipt.gasUsed} gas`);

  tx = await free.connect(owner).recordGeneration(nodeId, prompt);
  receipt = await tx.wait();
  console.log(`Owner second call (warm): ${receipt.gasUsed} gas`);

  console.log("\n=== ArbeskAssetFree.addEditor() ===");

  // User publishes and fills editors to max
  await free.connect(user).publishAsset("uri", 1);
  const freeCap = Number(await free.maxEditorsPerToken());
  const wallets = Array.from({ length: freeCap }, () => hre.ethers.Wallet.createRandom());

  tx = await free.connect(user)["addEditor(uint256,address[])"](
    1,
    wallets.slice(0, freeCap - 1).map((w) => w.address)
  );
  receipt = await tx.wait();
  console.log(`User batch add ${freeCap - 1} editors: ${receipt.gasUsed} gas`);

  // Owner publishes and adds beyond cap
  await free.connect(owner).publishAsset("owner_uri", 2);
  const ownerWallets = Array.from({ length: freeCap + 5 }, () =>
    hre.ethers.Wallet.createRandom()
  );
  tx = await free.connect(owner)["addEditor(uint256,address[])"](
    2,
    ownerWallets.map((w) => w.address)
  );
  receipt = await tx.wait();
  console.log(
    `Owner batch add ${freeCap + 5} editors (bypassing cap): ${receipt.gasUsed} gas`
  );

  console.log("\n=== ArbeskAsset (paid) addEditor() ===");

  await paid.connect(user).publishAsset("uri", 1);
  const paidCap = Number(await paid.maxEditorsPerToken());
  const paidWallets = Array.from({ length: paidCap }, () =>
    hre.ethers.Wallet.createRandom()
  );

  tx = await paid.connect(user)["addEditor(uint256,address[])"](
    1,
    paidWallets.slice(0, paidCap - 1).map((w) => w.address)
  );
  receipt = await tx.wait();
  console.log(`User batch add ${paidCap - 1} editors: ${receipt.gasUsed} gas`);

  await paid.connect(owner).publishAsset("owner_uri", 2);
  const ownerPaidWallets = Array.from({ length: paidCap + 5 }, () =>
    hre.ethers.Wallet.createRandom()
  );
  tx = await paid.connect(owner)["addEditor(uint256,address[])"](
    2,
    ownerPaidWallets.map((w) => w.address)
  );
  receipt = await tx.wait();
  console.log(
    `Owner batch add ${paidCap + 5} editors (bypassing cap): ${receipt.gasUsed} gas`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

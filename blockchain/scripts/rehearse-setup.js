// Local dry-run setup (rehearsal only, not part of the production flow).
//
// Seeds a handful of tokens on the currently-deployed CONTRACT_ADDRESS proxy
// (the "old" contract) and deploys a fresh proxy (the "new" contract), then
// prints OLD/NEW so migrate-v2.js (OP=snapshot|migrate|verify) can run
// against them. Run after `scripts/deploy.js --network localhost`.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const { upgrades } = hre;
  const [deployer] = await hre.ethers.getSigners();

  const envPath = path.join(__dirname, "..", ".env");
  const env = fs.readFileSync(envPath, "utf8");
  const m = env.match(/^CONTRACT_ADDRESS=(.+)$/m);
  if (!m) throw new Error("CONTRACT_ADDRESS not in blockchain/.env — run deploy.js first");
  const oldAddress = m[1].trim();

  const old = await hre.ethers.getContractAt("ArbeskAssetFree", oldAddress);

  // Seed 3 tokens on the "old" contract (editorListUri empty → migration
  // falls back to migrating the root as-is, no IPFS fetch).
  for (let i = 1; i <= 3; i++) {
    const root = hre.ethers.id(`seed-root-${i}`);
    await (await old.connect(deployer).publishAsset(`ipfs://seed-${i}`, i, root, "")).wait();
    console.log(`seeded token ${i} on old contract`);
  }

  // Deploy a fresh "new" proxy (simulating the v2 redeploy).
  const Free = await hre.ethers.getContractFactory("ArbeskAssetFree");
  const newProxy = await upgrades.deployProxy(Free, [], { initializer: "initialize" });
  const newAddress = await newProxy.getAddress();

  console.log(`\nOLD=${oldAddress}`);
  console.log(`NEW=${newAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

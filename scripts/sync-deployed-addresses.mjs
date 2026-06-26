#!/usr/bin/env node
// Reads freshly deployed Hardhat-local contract addresses straight off the
// host filesystem (the hardhat container volume-mounts ./blockchain, so its
// deployment artifacts are already readable here - no docker exec needed)
// and syncs them into every place that needs them: blockchain/.env, root
// .env, and the frontend/backend network configs for Hardhat Local.
import fs from "node:fs";

const DEPLOYMENTS_DIR = "blockchain/deployments/localhost";

function readField(file, field) {
  const path = `${DEPLOYMENTS_DIR}/${file}`;
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, "utf8"))[field] ?? null;
}

function upsertEnvKeys(path, values) {
  if (!fs.existsSync(path)) return;
  const keys = Object.keys(values);
  const lines = fs
    .readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line && !keys.some((key) => line.startsWith(`${key}=`)));
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(path, `${lines.join("\n")}\n`);
}

function syncNetworkConfig(values) {
  const files = ["frontend/src/js/blockchain/network-config.js", "src/config.js"];
  const fields = {
    contractAddress: values.CONTRACT_ADDRESS,
    paidContractAddress: values.PAID_CONTRACT_ADDRESS,
    usdcToken: values.USDC_TOKEN,
  };
  for (const path of files) {
    if (!fs.existsSync(path)) {
      console.warn(`⚠️  Config file not found: ${path}`);
      continue;
    }
    let config = fs.readFileSync(path, "utf8");
    for (const [field, value] of Object.entries(fields)) {
      config = config.replace(
        new RegExp(`(\\[CHAIN_IDS\\.HARDHAT_LOCAL\\]: \\{[\\s\\S]*?${field}: )"[^"]*"`),
        `$1"${value}"`
      );
    }
    fs.writeFileSync(path, config);
    console.log(`✅ Synced ${path}`);
  }
}

const free = readField("ArbeskAssetFree.json", "address");
const paid = readField("ArbeskAsset.json", "address");
const usdc = readField("ArbeskAsset.json", "usdcToken");

if (!free || !paid || !usdc) {
  console.warn("⚠️  Could not read deployed addresses from artifacts");
  process.exit(1);
}

const values = { CONTRACT_ADDRESS: free, PAID_CONTRACT_ADDRESS: paid, USDC_TOKEN: usdc };

upsertEnvKeys("blockchain/.env", values);
upsertEnvKeys(".env", values);
syncNetworkConfig(values);

console.log(`✅ Contract deployed at ${free}`);
console.log(`✅ Paid contract deployed at ${paid}`);
console.log(`✅ MockUSDC deployed at ${usdc}`);
console.log("✅ Root .env synced with deployed addresses");

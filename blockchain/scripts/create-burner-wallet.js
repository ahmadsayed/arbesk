/**
 * Create TWO random burner wallets for testnet use.
 *
 * Wallet 1 = Deployer (pays gas to deploy the contract)
 * Wallet 2 = Treasury (receives generation payments)
 *
 * Usage:
 *   docker compose run --rm hardhat node scripts/create-burner-wallet.js
 *
 * WARNING: This generates random key pairs. Store them temporarily only.
 *          Never use burner wallets for mainnet or with real funds.
 */

const { Wallet } = require("ethers");

function printWallet(label, wallet, index) {
  console.log(`\n========================================`);
  console.log(`  TESTNET BURNER WALLET #${index}: ${label}`);
  console.log(`========================================\n`);
  console.log("Address:        ", wallet.address);
  console.log("Private Key:    ", wallet.privateKey);
  console.log("Mnemonic:       ", wallet.mnemonic?.phrase || "N/A");
}

const deployer = Wallet.createRandom();
const treasury = Wallet.createRandom();

printWallet("DEPLOYER (pays gas, deploys contract)", deployer, 1);
printWallet("TREASURY (receives payments)", treasury, 2);

console.log("\n----------------------------------------");
console.log("  Copy-paste into blockchain/.env:");
console.log("----------------------------------------\n");

console.log(`# Wallet #1 - Deployer`);
console.log(`PRIVATE_KEY=${deployer.privateKey.replace(/^0x/, "")}`);
console.log(`PUBLIC_KEY=${deployer.address}`);
console.log("");
console.log(`# Wallet #2 - Treasury (receives generation fees)`);
console.log(`TREASURY_ADDRESS=${treasury.address}`);

console.log("\n----------------------------------------");
console.log("  MetaMask / Brave Wallet import:");
console.log("----------------------------------------\n");
console.log("Deployer Private Key:", deployer.privateKey);
console.log("Treasury Private Key: ", treasury.privateKey);

console.log("\n----------------------------------------");
console.log("  Next steps:");
console.log("----------------------------------------\n");
console.log("1. Copy the .env lines above into blockchain/.env");
console.log("2. Import BOTH private keys into MetaMask / Brave Wallet:");
console.log("   - Click account icon → Import account → Paste private key");
console.log("3. Get testnet ETH for the DEPLOYER wallet from:");
console.log("   https://www.alchemy.com/faucets/base-sepolia");
console.log("4. Check balances at:");
console.log(`   https://sepolia.basescan.org/address/${deployer.address}`);
console.log(`   https://sepolia.basescan.org/address/${treasury.address}`);
console.log("\n⚠️  KEEP THESE PRIVATE KEYS SECRET. BURNER WALLETS ONLY.\n");

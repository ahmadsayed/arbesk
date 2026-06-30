require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      chainId: 31415822,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    // ── Base Sepolia Testnet ──
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 84532,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { API_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

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
    // ── MegaETH Testnet ──
    megaethTestnet: {
      url: "https://carrot.megaeth.com/rpc",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 6343,
    },
  },
  etherscan: {
    // A single-string apiKey enables Etherscan API v2 (unified endpoint,
    // multi-chain). MegaETH's legacy per-chain endpoints (megaexplorer.xyz,
    // api-*-mega.etherscan.io) are deprecated/dead as of mid-2025.
    // The plugin auto-appends chainid=6343 to every v2 request.
    apiKey: ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "megaethTestnet",
        chainId: 6343,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://testnet-mega.etherscan.io",
        },
      },
    ],
  },
};

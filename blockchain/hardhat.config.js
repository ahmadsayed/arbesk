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
    // ── MegaETH Testnet ──
    megaethTestnet: {
      url: "https://carrot.megaeth.com/rpc",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 6343,
    },
    // ── Monad Testnet ──
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz/",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 10143,
    },
    // ── Base Sepolia Testnet ──
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 84532,
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
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api.monadexplorer.com/api",
          browserURL: "https://testnet.monadexplorer.com",
        },
      },
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
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadvision.com",
  },
};

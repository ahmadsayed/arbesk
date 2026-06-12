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
    // ── Filecoin FEVM (legacy, kept for backward compat) ──
    filecoinCalibration: {
      url: API_URL || "https://api.calibration.node.glif.io/rpc/v1",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
    },
    filecoin: {
      url: API_URL || "https://api.node.glif.io/rpc/v1",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
    },
    // ── Optimism L2 ──
    optimismSepolia: {
      url: "https://sepolia.optimism.io",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 11155420,
    },
    optimismMainnet: {
      url: "https://mainnet.optimism.io",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 10,
    },
  },
  etherscan: {
    apiKey: {
      filecoinCalibration: ETHERSCAN_API_KEY || "",
      filecoin: ETHERSCAN_API_KEY || "",
      optimismSepolia: ETHERSCAN_API_KEY || "",
      optimismMainnet: ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "filecoinCalibration",
        chainId: 314159,
        urls: {
          apiURL: "https://calibration.filfox.info/api/v1/tools/verify",
          browserURL: "https://calibration.filfox.info",
        },
      },
      {
        network: "filecoin",
        chainId: 314,
        urls: {
          apiURL: "https://filfox.info/api/v1/tools/verify",
          browserURL: "https://filfox.info",
        },
      },
      {
        network: "optimismSepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimism.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io",
        },
      },
      {
        network: "optimismMainnet",
        chainId: 10,
        urls: {
          apiURL: "https://api-optimistic.etherscan.io/api",
          browserURL: "https://optimistic.etherscan.io",
        },
      },
    ],
  },
};

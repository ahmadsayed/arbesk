require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { API_URL, PRIVATE_KEY, ETHERSCAN_API_KEY, BASESCAN_API_KEY } =
  process.env;

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
    // ── Base L2 ──
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 84532,
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: {
      filecoinCalibration: ETHERSCAN_API_KEY || "",
      filecoin: ETHERSCAN_API_KEY || "",
      baseSepolia: BASESCAN_API_KEY || "",
      base: BASESCAN_API_KEY || "",
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
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
    ],
  },
};

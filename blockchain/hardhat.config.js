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
    filecoinCalibration: {
      url: API_URL || "https://api.calibration.node.glif.io/rpc/v1",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
    },
    filecoin: {
      url: API_URL || "https://api.node.glif.io/rpc/v1",
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`] : [],
    },
  },
  etherscan: {
    apiKey: {
      filecoinCalibration: ETHERSCAN_API_KEY || "",
      filecoin: ETHERSCAN_API_KEY || "",
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
    ],
  },
};

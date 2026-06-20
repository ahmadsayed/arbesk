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
      chainId: 6342,
    },
  },
  etherscan: {
    apiKey: {
      megaethTestnet: ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "megaethTestnet",
        chainId: 6342,
        urls: {
          apiURL: "https://megaexplorer.xyz/api",
          browserURL: "https://megaexplorer.xyz",
        },
      },
    ],
  },
};

/**
 * Arbesk Wallet Connection
 *
 * Web3Modal + Web3.js for Filecoin FEVM.
 * Handles connection, network switching, generation payment, NFT minting,
 * tokenURI updates, and editor management.
 */

// Filecoin FEVM network configurations
const NETWORKS = {
  hardhat: {
    chainId: "0x1df5e0e", // 31415822 in hex
    chainName: "Hardhat Local",
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: { name: "TestFIL", symbol: "tFIL", decimals: 18 },
    blockExplorerUrls: [],
  },
  calibration: {
    chainId: "0x4cb2f", // 314159 in hex
    chainName: "Filecoin Calibration",
    rpcUrls: ["https://api.calibration.node.glif.io/rpc/v1"],
    nativeCurrency: { name: "TestFIL", symbol: "tFIL", decimals: 18 },
    blockExplorerUrls: ["https://calibration.filfox.info"],
  },
  mainnet: {
    chainId: "0x13a", // 314 in hex
    chainName: "Filecoin Mainnet",
    rpcUrls: ["https://api.node.glif.io/rpc/v1"],
    nativeCurrency: { name: "Filecoin", symbol: "FIL", decimals: 18 },
    blockExplorerUrls: ["https://filfox.info"],
  },
};

const HARHAT_CHAIN_ID_DEC = 31415822;

const providerOptions = {};

let web3Modal = null;
let web3Provider = null;
let web3 = null;
let contract = null;
let contractAddress = null;

/**
 * Initialize Web3Modal. Does NOT auto-connect silently.
 */
function initWallet() {
  const hasWeb3Modal = typeof window.Web3Modal === "function";
  if (!hasWeb3Modal) {
    console.warn(
      "Web3Modal not loaded; direct MetaMask fallback will be used on connect."
    );
    return;
  }

  try {
    web3Modal = new window.Web3Modal({
      cacheProvider: true,
      providerOptions,
      disableInjectedProvider: false,
    });
  } catch (e) {
    console.error("Web3Modal init failed:", e);
  }
}

/**
 * Initialize contract instance if ABI and address are available.
 */
async function _initContract() {
  try {
    const [addr, abiData] = await Promise.all([
      getContractAddress(),
      getContractArtifact("ArbeskAsset"),
    ]);
    if (!addr) return;
    if (!abiData?.abi) return;

    contractAddress = addr;
    contract = new web3.eth.Contract(abiData.abi, contractAddress);
  } catch (e) {
    console.warn("Contract initialization failed:", e.message);
  }
}

/**
 * Prompt MetaMask to switch/add the Hardhat network.
 */
async function _promptHardhatNetwork() {
  const ethereum = web3Provider || window.ethereum;
  if (!ethereum) return false;

  const net = NETWORKS.hardhat;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net.chainId }],
    });
    return true;
  } catch (switchError) {
    if (switchError.code === 4902) {
      try {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [net],
        });
        return true;
      } catch (addError) {
        console.error("Failed to add Hardhat network:", addError);
        alert(
          "Please add the Hardhat Local network manually:\nRPC: http://127.0.0.1:8545\nChain ID: 31415822"
        );
        return false;
      }
    } else if (switchError.code === 4001) {
      // User rejected
      return false;
    } else {
      console.error("Network switch failed:", switchError);
      return false;
    }
  }
}

/**
 * Check wallet balance and warn if too low for generation.
 */
async function _checkBalance() {
  if (!web3 || !window.walletAddress) return;
  try {
    const balanceWei = await web3.eth.getBalance(window.walletAddress);
    const balanceEth = web3.utils.fromWei(balanceWei, "ether");
    console.log("Balance:", balanceEth, "tFIL");

    if (parseFloat(balanceEth) < 0.1) {
      console.warn("Low balance detected");
      // Only warn if we're actually on Hardhat
      let chainId = await web3.eth.getChainId();
      chainId = Number(chainId);
      if (chainId === HARHAT_CHAIN_ID_DEC) {
        // Hardhat dev key for account #0
        const devKey =
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        const devAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        if (window.walletAddress.toLowerCase() !== devAddress.toLowerCase()) {
          alert(
            "Your wallet has insufficient funds on the Hardhat local network.\n\n" +
              "To get test funds, import this dev account into MetaMask:\n\n" +
              "Address: " +
              devAddress +
              "\n" +
              "Private key:\n" +
              devKey +
              "\n\n" +
              "This account has 10,000 tFIL pre-funded."
          );
        }
      }
    }
  } catch (e) {
    console.warn("Balance check failed:", e);
  }
}

/**
 * Auto-connect wallet on page load if previously authorized.
 * Uses silent methods (no popup) to restore connection.
 */
async function autoConnectWallet() {
  try {
    // 1. Try Web3Modal cached provider (no popup)
    if (web3Modal && web3Modal.cachedProvider) {
      web3Provider = await web3Modal.connect();
      web3 = new Web3(web3Provider);
    }
    // 2. Fallback: try MetaMask silent eth_accounts (no popup)
    else if (window.ethereum) {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });
      if (!accounts || accounts.length === 0) {
        return; // Never connected — stay disconnected
      }
      web3Provider = window.ethereum;
      web3 = new Web3(web3Provider);
    } else {
      return; // No provider available
    }

    const accounts = await web3.eth.getAccounts();
    if (!accounts || accounts.length === 0) {
      console.error("No accounts found");
      return;
    }
    await _finishWalletSetup(accounts[0]);
  } catch (error) {
    console.error("Auto-connect failed:", error);
  }
}

/**
 * Shared setup after provider is established (accounts, chain, contract, listeners).
 */
async function _finishWalletSetup(address) {
  window.walletAddress = address;

  let chainId = Number(await web3.eth.getChainId());
  window.chainId = chainId;
  console.log("Connected wallet:", window.walletAddress, "chainId:", chainId);

  // Prompt network switch if not on Hardhat
  if (chainId !== HARHAT_CHAIN_ID_DEC) {
    const switched = await _promptHardhatNetwork();
    if (switched) {
      // Re-read chainId after switch
      chainId = Number(await web3.eth.getChainId());
      window.chainId = chainId;
    } else {
      console.warn("User did not switch to Hardhat network");
    }
  }

  await _initContract();
  window.contractAddress = contractAddress;
  await _checkBalance();

  document.dispatchEvent(
    new CustomEvent("wallet:connected", {
      detail: { address: window.walletAddress, chainId },
    })
  );

  // Setup listeners (only once)
  const provider = web3Provider;
  if (provider.on && !provider._arbeskListenersAttached) {
    provider._arbeskListenersAttached = true;
    provider.on("accountsChanged", (accounts) => {
      if (accounts.length === 0) {
        disconnectWallet();
      } else {
        window.walletAddress = accounts[0];
        _checkBalance();
        document.dispatchEvent(
          new CustomEvent("wallet:connected", {
            detail: { address: window.walletAddress, chainId: null },
          })
        );
      }
    });

    provider.on("chainChanged", () => {
      window.location.reload();
    });
  }
}

/**
 * Connect wallet and setup listeners.
 * Always triggers the MetaMask / wallet popup.
 */
async function connectWallet() {
  try {
    if (web3Modal) {
      web3Provider = await web3Modal.connect();
      web3 = new Web3(web3Provider);
    } else if (window.ethereum) {
      // Direct MetaMask/Rabby fallback — always request accounts to show popup
      web3Provider = window.ethereum;
      web3 = new Web3(web3Provider);
      await window.ethereum.request({ method: "eth_requestAccounts" });
    } else {
      console.error("No wallet provider found. Install MetaMask or Rabby.");
      alert("No wallet provider found. Please install MetaMask or Rabby.");
      return;
    }

    const accounts = await web3.eth.getAccounts();
    if (!accounts || accounts.length === 0) {
      console.error("No accounts found");
      return;
    }
    await _finishWalletSetup(accounts[0]);
  } catch (error) {
    console.error("Wallet connection failed:", error);
    if (error.code === 4001) {
      console.log("User rejected connection");
    }
  }
}

/**
 * Disconnect wallet.
 */
async function disconnectWallet() {
  if (web3Modal) {
    await web3Modal.clearCachedProvider();
  }
  web3Provider = null;
  web3 = null;
  contract = null;
  contractAddress = null;
  window.walletAddress = null;
  document.dispatchEvent(new CustomEvent("wallet:disconnected"));
}

/**
 * Request network switch/add for a target network.
 */
async function switchNetwork(networkKey) {
  if (!web3Provider) return;
  const net = NETWORKS[networkKey];
  if (!net) return;

  const ethereum = web3Provider;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net.chainId }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [net],
      });
    } else {
      throw switchError;
    }
  }
}

/**
 * Pay for a generation using the ArbeskAsset contract.
 * @param {string} nodeId — hex or string node identifier
 * @param {string} prompt — generation prompt
 * @returns {string|null} txHash on success, null on failure
 */
async function payForGeneration(nodeId, prompt) {
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress) {
    alert("Wallet not connected. Please connect your wallet first.");
    return null;
  }

  // Check we're on Hardhat
  let chainId = await w3.eth.getChainId();
  chainId = Number(chainId);
  if (chainId !== HARHAT_CHAIN_ID_DEC) {
    const ok = confirm(
      "You are not on the Hardhat Local network (chain " +
        chainId +
        ").\n\n" +
        "Switch to Hardhat Local now?\n(RPC: http://127.0.0.1:8545, Chain ID: 31415822)"
    );
    if (ok) {
      const switched = await _promptHardhatNetwork();
      if (!switched) return null;
    } else {
      return null;
    }
  }

  try {
    const c = _getContract();
    if (!c || !contractAddress) {
      console.warn("No contract configured; falling back to mock tx");
      return _mockPayForGeneration(nodeId, prompt);
    }

    const cost = await c.methods.costPerGeneration().call();
    console.log("[PAY] costPerGeneration =", cost, "wei (" + Number(cost)/1e18 + " tFIL)");
    const nodeIdBytes32 = w3.utils.padRight(w3.utils.utf8ToHex(nodeId), 64);

    const tx = c.methods.payForGeneration(nodeIdBytes32, prompt);
    console.log("[PAY] estimating gas for payForGeneration...");
    const gas = await tx.estimateGas({
      from: window.walletAddress,
      value: cost,
    });
    console.log("[PAY] estimated gas =", gas, "-> using", Math.floor(Number(gas) * 1.2));
    const receipt = await tx.send({
      from: window.walletAddress,
      value: cost,
      gas: Math.floor(Number(gas) * 1.2),
    });
    console.log("[PAY] transaction sent! txHash =", receipt.transactionHash);

    document.dispatchEvent(
      new CustomEvent("wallet:generationPaid", {
        detail: {
          txHash: receipt.transactionHash,
          nodeId,
          prompt,
          blockNumber: receipt.blockNumber,
          contractAddress,
        },
      })
    );

    return receipt.transactionHash;
  } catch (error) {
    console.error("payForGeneration failed:", error);
    console.error("[PAY] error details:", JSON.stringify({ message: error.message, code: error.code, data: error.data }, null, 2));

    // Detect specific errors and show helpful messages
    const msg = error.message || "";
    if (msg.includes("insufficient funds")) {
      const devAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
      const devKey =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
      alert(
        "Insufficient funds on Hardhat Local network.\n\n" +
          "Your connected account does not have enough tFIL.\n\n" +
          "Import the dev account into MetaMask:\n" +
          "Address: " +
          devAddress +
          "\n" +
          "Private key:\n" +
          devKey +
          "\n\n" +
          "This account has 10,000 tFIL pre-funded by Hardhat."
      );
    } else if (
      msg.includes("User denied") ||
      msg.includes("rejected") ||
      error.code === 4001
    ) {
      // User cancelled — silent
    } else {
      alert("Payment failed: " + msg);
    }
    return null;
  }
}

/**
 * Mint a asset token.
 * @param {string} tokenURI — manifest CID or URI
 * @param {number|string} tokenId — unique token identifier
 * @returns {string|null} txHash on success, null on failure
 */
function _getWeb3() {
  return web3 || window.web3 || null;
}

function _getContract() {
  return contract || window.contract || null;
}

async function publishAsset(tokenURI, tokenId) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.publishAsset(tokenURI, tokenId);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });

    document.dispatchEvent(
      new CustomEvent("asset:published", {
        detail: { tokenId, tokenURI, txHash: receipt.transactionHash },
      })
    );

    return receipt.transactionHash;
  } catch (error) {
    console.error("publishAsset failed:", error);
    return null;
  }
}

/**
 * Update token URI (manifest CID). Owner or editor only.
 * @param {number|string} tokenId
 * @param {string} newTokenURI
 * @returns {string|null} txHash on success
 */
async function updateAssetURI(tokenId, newTokenURI) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.updateAssetURI(tokenId, newTokenURI);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("updateAssetURI failed:", error);
    return null;
  }
}

/**
 * Add an editor to a token. Owner only.
 * @param {number|string} tokenId
 * @param {string} editorAddress
 * @returns {string|null} txHash on success
 */
async function addEditor(tokenId, editorAddress) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.addEditor(tokenId, editorAddress);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("addEditor failed:", error);
    return null;
  }
}

/**
 * Remove an editor from a token. Owner only.
 * @param {number|string} tokenId
 * @param {string} editorAddress
 * @returns {string|null} txHash on success
 */
async function removeEditor(tokenId, editorAddress) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.removeEditor(tokenId, editorAddress);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("removeEditor failed:", error);
    return null;
  }
}

// Retain mock flow for offline development when contract is not deployed
async function _mockPayForGeneration(nodeId, prompt) {
  const w3 = _getWeb3();
  // Send a 0-value transfer to the dev account (MetaMask blocks self-transfers with data)
  const devAccount = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const tx = {
    from: window.walletAddress,
    to: devAccount,
    value: w3.utils.toWei("0", "ether"),
    gas: 21000,
  };
  const receipt = await w3.eth.sendTransaction(tx);
  document.dispatchEvent(
    new CustomEvent("wallet:generationPaid", {
      detail: { txHash: receipt.transactionHash, nodeId, prompt },
    })
  );
  return receipt.transactionHash;
}

// Expose to window for inline onclick handlers if needed
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;
window.payForGeneration = payForGeneration;
window.publishAsset = publishAsset;
window.updateAssetURI = updateAssetURI;
window.addEditor = addEditor;
window.removeEditor = removeEditor;
window.switchNetwork = switchNetwork;

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(async () => {
    initWallet();
    // Try silent auto-connect if user previously authorized
    await autoConnectWallet();
  }, 100);
});

export {
  connectWallet,
  disconnectWallet,
  payForGeneration,
  publishAsset,
  updateAssetURI,
  addEditor,
  removeEditor,
  switchNetwork,
  initWallet,
  autoConnectWallet,
  web3,
  contract,
};

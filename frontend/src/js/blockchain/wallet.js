/**
 * Arbesk Wallet Connection
 *
 * EIP-6963 multi-wallet discovery + WalletConnect v2 + Web3.js
 * for EVM-compatible chains.
 *
 * Handles connection, network switching, generation payment, NFT minting,
 * tokenURI updates, editor management, role-based collaboration, and burn.
 */

import { showToast } from "../ui/toasts.js";
import {
  startDiscovery,
  requestWallets,
  getWalletByRdns,
  stopDiscovery,
} from "./wallet-discovery.js";
import {
  getWalletConnectProvider,
  connectWalletConnect,
  disconnectWalletConnect,
  onWalletConnectEvent,
  offWalletConnectEvent,
  isWalletConnectConnected,
} from "./wallet-connect.js";
import { showWalletModal } from "../ui/wallet-modal.js";
import {
  getContractAddress as getNetworkContractAddress,
  getUsdcToken as getNetworkUsdcToken,
  getNetworkConfig,
} from "./network-config.js";

// Supported networks
const NETWORKS = {
  hardhat: {
    chainId: "0x1df5e0e", // 31415822 in hex
    chainName: "Hardhat Local",
    rpcUrls: ["http://127.0.0.1:8545"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: [],
  },
  baseSepolia: {
    chainId: "0x14a34", // 84532 in hex
    chainName: "Base Sepolia",
    rpcUrls: ["https://sepolia.base.org"],
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://sepolia.basescan.org"],
  },
  polygonAmoy: {
    chainId: "0x13882", // 80002 in hex
    chainName: "Polygon Amoy",
    rpcUrls: ["https://rpc-amoy.polygon.technology"],
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    blockExplorerUrls: ["https://amoy.polygonscan.com"],
  },
};

const HARHAT_CHAIN_ID_DEC = 31415822;
// Hardhat local + Base Sepolia testnet
const SUPPORTED_CHAIN_IDS = [HARHAT_CHAIN_ID_DEC, 84532];

/** @type {string|null} 'injected' | 'walletconnect' | null */
let activeConnectionSource = null;

/** @type {string|null} rdns of the injected wallet (e.g., 'io.metamask') */
let activeWalletRdns = null;

let web3Provider = null;
let web3 = null;
let contract = null;
let contractAddress = null;

const LAST_WALLET_KEY = "arbesk-last-wallet";

/**
 * Initialize wallet system. Starts EIP-6963 discovery.
 * Does NOT auto-connect.
 */
function initWallet() {
  startDiscovery();
  console.log("[WALLET] EIP-6963 discovery started");
}

/**
 * Initialize contract instance if ABI and address are available.
 * Uses network-aware configuration: picks the contract address
 * based on the wallet's current chainId.
 */
async function _initContract() {
  try {
    const chainId = Number(await web3.eth.getChainId());
    const network = getNetworkConfig(chainId);

    let addr = getNetworkContractAddress(chainId);
    if (!addr) {
      // Fallback to backend config for unknown networks
      addr = await getContractAddress();
      console.warn(
        `[CONTRACT] No network config for chain ${chainId}. ` +
          `Falling back to backend address: ${addr}`
      );
    } else {
      console.log(
        `[CONTRACT] Using ${network.name} config — ` +
          `contract=${addr} usdc=${network.usdcToken}`
      );
    }

    const abiData = await getContractArtifact("ArbeskAsset");
    if (!addr) return;
    if (!abiData?.abi) return;

    // Verify contract actually exists at this address on the current chain
    const code = await web3.eth.getCode(addr);
    if (!code || code === "0x" || code === "0x0") {
      console.warn(
        `[CONTRACT] No bytecode at ${addr}. ` +
          `Wrong network? Current chain: ${chainId}`
      );
      contractAddress = null;
      contract = null;
      return;
    }

    contractAddress = addr;
    contract = new web3.eth.Contract(abiData.abi, contractAddress);
  } catch (e) {
    console.warn("Contract initialization failed:", e.message);
  }
}

/**
 * Prompt wallet to switch/add a target network.
 * @param {string} networkKey - key in NETWORKS object
 */
async function _promptNetworkSwitch(networkKey) {
  const ethereum = web3Provider;
  if (!ethereum) return false;

  const net = NETWORKS[networkKey];
  if (!net) {
    console.error(`[WALLET] Unknown network key: ${networkKey}`);
    return false;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net.chainId }],
    });
    return true;
  } catch (switchError) {
    if (switchError.code === 4902) {
      // Chain not in wallet — try wallet_addEthereumChain first.
      try {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: net.chainId,
              chainName: net.chainName,
              rpcUrls: net.rpcUrls,
              nativeCurrency: net.nativeCurrency,
              blockExplorerUrls: net.blockExplorerUrls,
            },
          ],
        });
        console.log(
          `[WALLET] wallet_addEthereumChain succeeded for ${net.chainName}`
        );
        return true;
      } catch (addError) {
        console.warn(
          `[WALLET] wallet_addEthereumChain also failed:`,
          addError.message || addError
        );
        showToast({
          type: "warning",
          title: `Switch to ${net.chainName}`,
          message: `Please add/switch to ${
            net.chainName
          } manually in your wallet. RPC: ${
            net.rpcUrls[0]
          }, Chain ID: ${parseInt(net.chainId, 16)}`,
          duration: 0,
        });
        return false;
      }
    } else if (switchError.code === 4001) {
      // User rejected
      showToast({
        type: "warning",
        title: "Wrong Network",
        message: `Arbesk requires ${net.chainName}. Please switch networks to continue.`,
        duration: 0,
      });
      return false;
    } else {
      console.error("Network switch failed:", switchError);
      showToast({
        type: "warning",
        title: "Network Switch Failed",
        message: switchError.message || "Could not switch network.",
        duration: 0,
      });
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
    console.log("Balance:", balanceEth, "ETH");

    if (parseFloat(balanceEth) < 0.1) {
      console.warn("Low balance detected");
      // Only warn if we're actually on Hardhat
      let chainId = await web3.eth.getChainId();
      chainId = Number(chainId);
      if (chainId === HARHAT_CHAIN_ID_DEC) {
        // Hardhat dev key for account #0
        const { DEV_ACCOUNT_ADDRESS } = await import("./dev-account.js");

        if (
          window.walletAddress.toLowerCase() !==
          DEV_ACCOUNT_ADDRESS.toLowerCase()
        ) {
          showToast({
            type: "warning",
            title: "Low Balance",
            message: `Your wallet has insufficient funds on Hardhat. Import dev account: ${devAddress}`,
            duration: 0,
          });
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
    const lastWallet = localStorage.getItem(LAST_WALLET_KEY);

    if (lastWallet === "walletconnect") {
      // Try WalletConnect silent restore
      const wcProvider = await getWalletConnectProvider();
      if (wcProvider && wcProvider.connected) {
        web3Provider = wcProvider;
        web3 = new Web3(wcProvider);
        const accounts = wcProvider.accounts || [];
        if (accounts.length > 0) {
          activeConnectionSource = "walletconnect";
          await _finishWalletSetup(accounts[0]);
          return;
        }
      }
    } else if (lastWallet) {
      // Try to reconnect injected wallet by rdns
      requestWallets();
      // Give wallets a moment to announce
      await new Promise((r) => setTimeout(r, 300));
      const wallet = getWalletByRdns(lastWallet);
      if (wallet && wallet.provider) {
        // Try silent eth_accounts (no popup)
        try {
          const accounts = await wallet.provider.request({
            method: "eth_accounts",
          });
          if (accounts && accounts.length > 0) {
            web3Provider = wallet.provider;
            web3 = new Web3(wallet.provider);
            activeConnectionSource = "injected";
            activeWalletRdns = wallet.rdns;
            await _finishWalletSetup(accounts[0]);
            return;
          }
        } catch {
          // Silent fail — wallet not authorized
        }
      }
    }

    // Fallback: try any available injected provider (MetaMask-style)
    if (window.ethereum) {
      const accounts = await window.ethereum.request({
        method: "eth_accounts",
      });
      if (accounts && accounts.length > 0) {
        web3Provider = window.ethereum;
        web3 = new Web3(window.ethereum);
        activeConnectionSource = "injected";
        activeWalletRdns = null; // unknown which wallet
        await _finishWalletSetup(accounts[0]);
        return;
      }
    }

    // No previous connection — stay disconnected
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

  // Prompt network switch if not on a supported chain
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
    const preferred =
      localStorage.getItem("arbesk-preferred-network") || "hardhat";
    const switched = await _promptNetworkSwitch(preferred);
    if (switched) {
      // Re-read chainId after switch
      chainId = Number(await web3.eth.getChainId());
      window.chainId = chainId;
    } else {
      console.warn("User did not switch to a supported network");
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

  // Setup listeners (only once per provider)
  _attachProviderListeners();
}

/**
 * Attach accountsChanged / chainChanged listeners to the active provider.
 * Handles both injected wallets and WalletConnect.
 */
function _attachProviderListeners() {
  if (!web3Provider) return;
  if (web3Provider._arbeskListenersAttached) return;
  web3Provider._arbeskListenersAttached = true;

  if (activeConnectionSource === "walletconnect") {
    // WalletConnect uses its own event emitter
    onWalletConnectEvent("accountsChanged", (accounts) => {
      if (!accounts || accounts.length === 0) {
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

    onWalletConnectEvent("chainChanged", () => {
      window.location.reload();
    });

    onWalletConnectEvent("disconnect", () => {
      disconnectWallet();
    });
  } else {
    // Injected wallet (EIP-1193)
    web3Provider.on("accountsChanged", (accounts) => {
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

    web3Provider.on("chainChanged", () => {
      window.location.reload();
    });
  }
}

/**
 * Connect wallet. Shows the wallet picker modal.
 */
async function connectWallet() {
  try {
    const result = await showWalletModal();
    if (!result) {
      console.log("User cancelled wallet selection");
      return;
    }

    const { provider, source, walletName, walletRdns } = result;

    if (source === "walletconnect") {
      // WalletConnect provider is already connected by this point
      web3Provider = provider;
      web3 = new Web3(provider);
      activeConnectionSource = "walletconnect";
      activeWalletRdns = null;
      localStorage.setItem(LAST_WALLET_KEY, "walletconnect");

      const accounts = provider.accounts || [];
      if (!accounts || accounts.length === 0) {
        console.error("No accounts found from WalletConnect");
        return;
      }
      await _finishWalletSetup(accounts[0]);
    } else {
      // Injected wallet — request accounts to trigger popup
      web3Provider = provider;
      web3 = new Web3(provider);
      activeConnectionSource = "injected";
      activeWalletRdns = walletRdns || null;

      const accounts = await web3.eth.requestAccounts();
      if (!accounts || accounts.length === 0) {
        console.error("No accounts found");
        return;
      }
      // Store last used wallet for auto-connect (use rdns for accurate identification)
      const reconnectId = walletRdns || walletName;
      if (reconnectId) {
        localStorage.setItem(LAST_WALLET_KEY, reconnectId);
      }
      await _finishWalletSetup(accounts[0]);
    }
  } catch (error) {
    console.error("Wallet connection failed:", error);
    if (error.message?.includes("User cancelled")) {
      console.log("User rejected connection");
    } else {
      showToast({
        type: "error",
        title: "Connection Failed",
        message: error.message || "Could not connect wallet.",
      });
    }
  }
}

/**
 * Disconnect wallet.
 */
async function disconnectWallet() {
  // Detach listeners
  if (web3Provider) {
    if (activeConnectionSource === "walletconnect") {
      offWalletConnectEvent("accountsChanged", () => {});
      offWalletConnectEvent("chainChanged", () => {});
      offWalletConnectEvent("disconnect", () => {});
      await disconnectWalletConnect();
    } else if (web3Provider.removeListener) {
      web3Provider.removeListener("accountsChanged", () => {});
      web3Provider.removeListener("chainChanged", () => {});
    }
    web3Provider._arbeskListenersAttached = false;
  }

  activeConnectionSource = null;
  activeWalletRdns = null;
  web3Provider = null;
  web3 = null;
  contract = null;
  contractAddress = null;
  window.walletAddress = null;
  localStorage.removeItem(LAST_WALLET_KEY);
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

// ─── Payment (USDC only) ───

/** Tier names for USDC quality levels */
const TIER_NAMES = ["Basic", "Standard", "Premium", "Pro"];
const TIER_COSTS_USDC = { 0: "0.75", 1: "1.25", 2: "1.75", 3: "2.50" };

/**
 * Pay for a generation using USDC at the selected quality tier.
 * Requires the user to first approve() the contract for the tier cost.
 * @param {string} nodeId — hex or string node identifier
 * @param {string} prompt — generation prompt
 * @param {number} tier — 0=Basic, 1=Standard, 2=Premium, 3=Pro
 * @returns {string|null} txHash on success, null on failure
 */
async function payForGenerationWithUSDC(nodeId, prompt, tier) {
  return payWithUSDC(nodeId, prompt, tier);
}

// ─── Simple USDC Payment ───

async function payWithUSDC(nodeId, prompt, tier) {
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress) {
    showToast({
      type: "error",
      title: "Wallet Not Connected",
      message: "Please connect your wallet first.",
    });
    return null;
  }
  const c = _getContract();
  if (!c || !contractAddress) {
    showToast({
      type: "error",
      title: "Contract Not Configured",
      message: "Cannot process payment. Contract not deployed.",
      duration: 0,
    });
    return null;
  }
  try {
    const tierCostWei = await c.methods.tierCosts(tier).call();
    if (tierCostWei === "0" || Number(tierCostWei) === 0) {
      showToast({
        type: "warning",
        title: "Tier Not Configured",
        message: "Tier cost not set for " + TIER_NAMES[tier] + ".",
        duration: 0,
      });
      return null;
    }
    const tierCostUSDC = Number(tierCostWei) / 1e6;
    console.log(
      "[USDC] tier=" + TIER_NAMES[tier] + " cost=" + tierCostUSDC + " USDC"
    );

    const chainId = Number(await w3.eth.getChainId());
    const usdcAddr =
      getNetworkUsdcToken(chainId) || (await c.methods.usdcToken().call());
    if (
      !usdcAddr ||
      usdcAddr === "0x0000000000000000000000000000000000000000"
    ) {
      showToast({
        type: "warning",
        title: "USDC Disabled",
        message: "USDC payments not enabled on this contract.",
        duration: 0,
      });
      return null;
    }

    // Step 1: Approve USDC spend
    console.log("[USDC] requesting approval for", tierCostUSDC, "USDC...");
    const usdcAbi = [
      {
        constant: false,
        inputs: [
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        type: "function",
      },
      {
        constant: true,
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        type: "function",
      },
      {
        constant: true,
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        type: "function",
      },
    ];
    const usdcContract = new w3.eth.Contract(usdcAbi, usdcAddr);

    // Check USDC balance before attempting payment
    const balance = await usdcContract.methods
      .balanceOf(window.walletAddress)
      .call();
    if (BigInt(balance) < BigInt(tierCostWei)) {
      const balanceUSDC = Number(balance) / 1e6;
      showToast({
        type: "warning",
        title: "Insufficient USDC Balance",
        message: `You need ${tierCostUSDC} USDC but only have ${balanceUSDC} USDC. Get testnet USDC from a faucet.`,
        duration: 0,
      });
      return null;
    }
    console.log(
      "[USDC] balance:",
      (Number(balance) / 1e6).toFixed(2),
      "USDC (need",
      tierCostUSDC,
      "USDC)"
    );

    // Reset allowance to 0 first if there's a stale non-zero allowance.
    // Some ERC20 tokens require this to prevent front-running; USDC doesn't
    // but it's a safe practice that costs minimal gas.
    const currentAllowance = await usdcContract.methods
      .allowance(window.walletAddress, contractAddress)
      .call();
    if (BigInt(currentAllowance) > BigInt(0)) {
      console.log(
        "[USDC] resetting existing allowance:",
        (Number(currentAllowance) / 1e6).toFixed(6),
        "USDC → 0"
      );
      const resetTx = usdcContract.methods.approve(contractAddress, "0");
      let resetGas;
      try {
        resetGas = await resetTx.estimateGas({ from: window.walletAddress });
      } catch {
        resetGas = 80000;
      }
      await resetTx.send({
        from: window.walletAddress,
        gas: Math.floor(Number(resetGas) * 1.2),
      });
      console.log("[USDC] allowance reset to 0");
    }

    const approveTx = usdcContract.methods.approve(
      contractAddress,
      tierCostWei
    );

    let approveGas;
    try {
      approveGas = await approveTx.estimateGas({ from: window.walletAddress });
    } catch {
      approveGas = 100000;
    }

    await approveTx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(approveGas) * 1.2),
    });
    console.log("[USDC] approval confirmed");

    // Verify the allowance was actually set (critical for OP Stack L2s where
    // sequencer state may lag behind). Retry up to 5 times with a 500ms delay.
    for (let attempt = 0; attempt < 5; attempt++) {
      const allowed = await usdcContract.methods
        .allowance(window.walletAddress, contractAddress)
        .call();
      if (BigInt(allowed) >= BigInt(tierCostWei)) {
        console.log("[USDC] allowance verified:", allowed.toString());
        break;
      }
      if (attempt < 4) {
        console.log(
          `[USDC] allowance not yet visible (attempt ${
            attempt + 1
          }/5), waiting 500ms...`
        );
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.warn(
          "[USDC] allowance still not visible after 5 attempts. Proceeding anyway — the payment tx may revert if the RPC is stale."
        );
      }
    }

    // Step 2: Pay for generation
    console.log("[USDC] calling payForGenerationWithUSDC...");
    const nodeIdBytes32 = w3.utils.padRight(w3.utils.utf8ToHex(nodeId), 64);
    const payTx = c.methods.payForGenerationWithUSDC(
      nodeIdBytes32,
      prompt,
      tier
    );

    // L2 chains (Base, Optimism, Arbitrum) need higher gas defaults because
    // external calls (safeTransferFrom) consume more gas on OP stack.
    // Also, estimateGas may fail on public RPCs due to stale sequencer state.
    let payGas;
    try {
      payGas = await payTx.estimateGas({ from: window.walletAddress });
      console.log("[USDC] estimated pay gas:", payGas);
    } catch (estErr) {
      // On L2 chains, estimateGas often fails when the approval tx hasn't
      // been indexed by the RPC's simulation state. Use a generous default.
      const isL2 = [84532, 8453, 10, 42161, 421614].includes(chainId);
      payGas = isL2 ? 500000 : 300000;
      console.log(
        `[USDC] pay estimateGas failed (${
          estErr.message || "unknown"
        }), using default ${payGas}`
      );
    }

    const receipt = await payTx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(payGas) * 1.2),
    });
    console.log("[USDC] payment confirmed! txHash =", receipt.transactionHash);

    document.dispatchEvent(
      new CustomEvent("wallet:generationPaid", {
        detail: {
          txHash: receipt.transactionHash,
          nodeId,
          prompt,
          tier,
          tierCostUSDC,
          blockNumber: receipt.blockNumber,
          contractAddress,
        },
      })
    );
    return receipt.transactionHash;
  } catch (error) {
    console.error("payWithUSDC failed:", error);
    const msg = error.message || "";
    if (
      msg.includes("User denied") ||
      msg.includes("rejected") ||
      error.code === 4001
    ) {
      // silent
    } else if (
      msg.includes("insufficient") ||
      msg.includes("exceeds") ||
      msg.includes("exceed")
    ) {
      showToast({
        type: "warning",
        title: "Insufficient USDC",
        message:
          "Insufficient USDC balance or allowance. Top up your testnet USDC and try again.",
        duration: 0,
      });
    } else if (
      msg.includes("reverted") ||
      msg.includes("revert") ||
      msg.includes("VM Exception")
    ) {
      // Transaction mined but reverted — usually balance/allowance related.
      // Check on-chain state for the specific reason.
      showToast({
        type: "error",
        title: "Transaction Reverted",
        message:
          "The transaction was mined but reverted. This usually means insufficient USDC balance or allowance. Check your testnet USDC balance.",
        duration: 0,
      });
    } else {
      showToast({
        type: "error",
        title: "Payment Failed",
        message: msg,
        actions: [
          { label: "Retry", onClick: () => payWithUSDC(nodeId, prompt, tier) },
        ],
      });
    }
    return null;
  }
}

// ─── Shared Helpers ───

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
    const { decodeRevertReason } = await import("./error-decoder.js");
    const contractAbi = (await getContractArtifact("ArbeskAsset"))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);
    showToast({
      type: "error",
      title: "Publish Failed",
      message: decodedMsg,
    });
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

// ── Role-Based Collaboration (Phase 5.1) ──

/**
 * CollaboratorRole enum values matching the Solidity contract.
 */
const CollaboratorRole = Object.freeze({
  None: 0,
  Viewer: 1,
  Editor: 2,
});

/**
 * Add a collaborator with a specific role. Owner only.
 * @param {number|string} tokenId
 * @param {string} collaboratorAddress
 * @param {number} role — CollaboratorRole.Viewer (1) or CollaboratorRole.Editor (2)
 * @returns {string|null} txHash on success
 */
async function addCollaboratorWithRole(tokenId, collaboratorAddress, role) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.addEditor(tokenId, collaboratorAddress, role);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("addCollaboratorWithRole failed:", error);
    return null;
  }
}

/**
 * Change a collaborator's role. Owner only.
 * @param {number|string} tokenId
 * @param {string} collaboratorAddress
 * @param {number} role — CollaboratorRole.Viewer (1) or CollaboratorRole.Editor (2);
 *                         CollaboratorRole.None (0) removes the collaborator.
 * @returns {string|null} txHash on success
 */
async function setCollaboratorRole(tokenId, collaboratorAddress, role) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.setCollaboratorRole(
      tokenId,
      collaboratorAddress,
      role
    );
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("setCollaboratorRole failed:", error);
    return null;
  }
}

/**
 * Get a collaborator's role for a token. Read-only call.
 * @param {number|string} tokenId
 * @param {string} collaboratorAddress
 * @returns {number|null} CollaboratorRole enum value, or null on error
 */
async function getCollaboratorRole(tokenId, collaboratorAddress) {
  const c = _getContract();
  if (!c) {
    console.error("Contract not ready");
    return null;
  }

  try {
    const role = await c.methods
      .getCollaboratorRole(tokenId, collaboratorAddress)
      .call();
    return Number(role);
  } catch (error) {
    console.error("getCollaboratorRole failed:", error);
    return null;
  }
}

/**
 * List collaborators filtered by role. Read-only call.
 * @param {number|string} tokenId
 * @param {number} role — CollaboratorRole.Viewer (1) or CollaboratorRole.Editor (2)
 * @returns {string[]|null} Array of collaborator addresses, or null on error
 */
async function listCollaboratorsByRole(tokenId, role) {
  const c = _getContract();
  if (!c) {
    console.error("Contract not ready");
    return null;
  }

  try {
    const addrs = await c.methods.listCollaboratorsByRole(tokenId, role).call();
    return addrs;
  } catch (error) {
    console.error("listCollaboratorsByRole failed:", error);
    return null;
  }
}

// ── Burn ──

/**
 * Burn (destroy) a token. Owner or Editor with burn permission.
 * Before burning, resolves the token's manifest CID so we can unpin
 * all IPFS content after the on-chain burn succeeds.
 * @param {number|string} tokenId
 * @returns {string|null} txHash on success
 */
async function burn(tokenId) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  // Resolve manifest CID before burning (after burn, tokenURI may revert)
  let manifestCid = null;
  try {
    manifestCid = await c.methods.tokenURI(tokenId).call();
    console.log(
      `[BURN] token ${tokenId} manifest CID → ${manifestCid || "none"}`
    );
  } catch (e) {
    console.warn(
      `[BURN] could not resolve manifest CID for token ${tokenId}:`,
      e.message
    );
    // Continue with burn even if resolution fails — unpin is best-effort
  }

  try {
    const tx = c.methods.burn(tokenId);
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });

    document.dispatchEvent(
      new CustomEvent("asset:burned", {
        detail: { tokenId, txHash: receipt.transactionHash },
      })
    );

    // Unpin all IPFS content for this manifest chain (best-effort, non-blocking)
    if (manifestCid) {
      console.log(`[BURN] unpinning IPFS content for ${manifestCid}…`);
      const { unpinAssetCids } = await import("../services/api.js");
      unpinAssetCids(manifestCid, window.walletAddress)
        .then((result) => {
          console.log(
            `[BURN] unpinned ${result.count} CIDs for token ${tokenId}`
          );
          if (result.errors?.length) {
            console.warn(`[BURN] unpin errors:`, result.errors);
          }
        })
        .catch((err) => {
          console.warn(`[BURN] unpin failed (non-fatal):`, err.message);
        });
    }

    return receipt.transactionHash;
  } catch (error) {
    console.error("burn failed:", error);
    const { decodeRevertReason } = await import("./error-decoder.js");
    const contractAbi = (await getContractArtifact("ArbeskAsset"))?.abi || null;
    const decodedMsg = await decodeRevertReason(error, contractAbi);
    showToast({
      type: "error",
      title: "Burn Failed",
      message: decodedMsg,
    });
    return null;
  }
}

/**
 * Grant or revoke burn permission for a collaborator. Owner only.
 * @param {number|string} tokenId
 * @param {string} collaboratorAddress
 * @param {boolean} canBurnFlag
 * @returns {string|null} txHash on success
 */
async function setBurnPermission(tokenId, collaboratorAddress, canBurnFlag) {
  const c = _getContract();
  const w3 = _getWeb3();
  if (!w3 || !window.walletAddress || !c) {
    console.error("Wallet or contract not ready");
    return null;
  }

  try {
    const tx = c.methods.setBurnPermission(
      tokenId,
      collaboratorAddress,
      canBurnFlag
    );
    const gas = await tx.estimateGas({ from: window.walletAddress });
    const receipt = await tx.send({
      from: window.walletAddress,
      gas: Math.floor(Number(gas) * 1.2),
    });
    return receipt.transactionHash;
  } catch (error) {
    console.error("setBurnPermission failed:", error);
    return null;
  }
}

/**
 * Check if an address can burn a token. Read-only call.
 * @param {number|string} tokenId
 * @param {string} address
 * @returns {boolean|null} True if can burn, false otherwise, null on error
 */
async function canBurn(tokenId, address) {
  const c = _getContract();
  if (!c) {
    console.error("Contract not ready");
    return null;
  }

  try {
    return await c.methods.canBurn(tokenId, address).call();
  } catch (error) {
    console.error("canBurn failed:", error);
    return null;
  }
}

// Expose to window for inline onclick handlers if needed
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;

// ── Exports ──
export {
  initWallet,
  connectWallet,
  disconnectWallet,
  autoConnectWallet,
  switchNetwork,
  payForGenerationWithUSDC,
  publishAsset,
  updateAssetURI,
  addEditor,
  removeEditor,
  CollaboratorRole,
  addCollaboratorWithRole,
  setCollaboratorRole,
  getCollaboratorRole,
  listCollaboratorsByRole,
  burn,
  setBurnPermission,
  canBurn,
  web3,
  web3 as walletWeb3,
  contract,
};

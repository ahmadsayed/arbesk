/**
 * Arbesk Wallet Network Switching
 *
 * Extracted from wallet.js — handles network detection, switching,
 * and wallet_addEthereumChain fallback for chains not yet known to the wallet.
 */

import { showToast } from "../ui/toasts.js";
import { web3Provider, NETWORKS } from "./wallet-core.js";

/**
 * Detect the "chain is not added to wallet" error across wallet vendors.
 * MetaMask returns 4902; Rabby returns -32603 with "Unrecognized chain ID".
 * @param {Object} error
 * @returns {boolean}
 */
function _isChainUnknownError(error) {
  if (!error) return false;
  if (error.code === 4902) return true;
  if (error.code === -32603) return true;
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("unrecognized chain") || msg.includes("unrecognized chainid")
  );
}

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
    if (_isChainUnknownError(switchError)) {
      // Chain not in wallet — try wallet_addEthereumChain first.
      // MetaMask signals this with code 4902; Rabby uses -32603 / "Unrecognized chain ID".
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
    if (_isChainUnknownError(switchError)) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [net],
      });
    } else {
      throw switchError;
    }
  }
}

export { switchNetwork };

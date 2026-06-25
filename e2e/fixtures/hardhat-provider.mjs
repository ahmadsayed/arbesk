import { HARDHAT_ACCOUNTS, HARDHAT_RPC } from "./multi-wallet.mjs";
import { TEST_WALLET } from "./test-wallet.mjs";

const CHAIN_ID_HEX = `0x${TEST_WALLET.chainId.toString(16)}`;

/**
 * Inject a Hardhat-backed EIP-1193/EIP-6963 provider into the page.
 *
 * By default this uses the legacy TEST_WALLET (Hardhat account #0) so existing
 * specs keep working unchanged. Pass `{ accountIndex: N }` to use a different
 * Hardhat dev account for multi-wallet scenarios.
 */
export async function injectHardhatProvider(
  page,
  { accountIndex = 0 } = {},
) {
  const account = HARDHAT_ACCOUNTS[accountIndex];
  if (!account) {
    throw new Error(`Unknown Hardhat account index ${accountIndex}`);
  }

  await page.addInitScript(
    ({ address, rpc, chainIdHex }) => {
      let rpcId = 1;

      async function rpcCall(method, params = []) {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: rpcId++,
            method,
            params,
          }),
        });
        const data = await res.json();
        if (data.error) {
          throw new Error(data.error.message || JSON.stringify(data.error));
        }
        return data.result;
      }

      const provider = {
        isArbeskTestProvider: true,
        selectedAddress: address,
        chainId: chainIdHex,
        networkVersion: String(parseInt(chainIdHex, 16)),
        isConnected: () => true,

        request: async ({ method, params = [] }) => {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [address];
            case "eth_chainId":
              return provider.chainId;
            case "eth_sendTransaction":
            case "eth_sign":
              return rpcCall(method, params);
            case "personal_sign":
              // web3.js appends an empty password param, but Hardhat rejects it.
              return rpcCall(method, params.slice(0, 2));
            case "wallet_switchEthereumChain":
              return null;
            default:
              return rpcCall(method, params);
          }
        },

        on: () => {},
        removeListener: () => {},
      };

      window.ethereum = provider;

      const info = {
        rdns: "com.arbesk.hardhat-test",
        name: "Hardhat Test",
        icon: "",
      };

      function announce() {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: { info, provider },
          }),
        );
      }

      // Announce immediately for any already-listening consumers.
      announce();

      // Re-announce when the studio requests wallets (EIP-6963 flow).
      window.addEventListener("eip6963:requestProvider", announce);
    },
    {
      address: account.address,
      rpc: HARDHAT_RPC,
      chainIdHex: CHAIN_ID_HEX,
    },
  );
}

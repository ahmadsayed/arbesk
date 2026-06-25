/**
 * Hardhat dev wallet accounts for multi-wallet E2E scenarios.
 *
 * These match the deterministic accounts Hardhat funds at genesis.
 * Index 0 is the legacy TEST_WALLET used by the rest of the suite.
 */

export const HARDHAT_RPC = "http://127.0.0.1:8545";

export const HARDHAT_ACCOUNTS = [
  {
    index: 0,
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    index: 1,
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey:
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    index: 2,
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey:
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
];

export function getHardhatAccount(index) {
  const account = HARDHAT_ACCOUNTS[index];
  if (!account) {
    throw new Error(`Unknown Hardhat account index ${index}`);
  }
  return account;
}

let rpcId = 1;

async function rpcCall(method, params = []) {
  const res = await fetch(HARDHAT_RPC, {
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

/**
 * Send ETH from one Hardhat dev account to another address.
 * Hardhat accounts already start with 10,000 ETH, so this is mainly a
 * resilience helper for long-running test environments.
 */
export async function sendEth(fromIndex, toAddress, ethAmount = "1") {
  const from = getHardhatAccount(fromIndex);
  const valueHex = `0x${BigInt(
    Number(ethAmount) * 1e18,
  ).toString(16)}`;

  const txHash = await rpcCall("eth_sendTransaction", [
    {
      from: from.address,
      to: toAddress,
      value: valueHex,
    },
  ]);

  // Wait for the transaction to be mined.
  let receipt = null;
  for (let i = 0; i < 20; i++) {
    receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
    if (receipt) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!receipt) {
    throw new Error(`Funding transaction ${txHash} was not mined`);
  }
  return txHash;
}

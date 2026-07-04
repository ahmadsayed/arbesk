/**
 * Backend web3 providers must use HTTP keep-alive.
 *
 * sepolia.base.org (Cloudflare) throttles repeated fresh TLS handshakes:
 * without a keep-alive agent, web3's node-fetch transport opened a new
 * connection per request and intermittently died with
 * "request to https://sepolia.base.org/ failed, reason: ETIMEDOUT"
 * (5 of 8 requests failed on 2026-07-04; 0 of 8 with keep-alive).
 */
import { CHAIN_IDS } from "../constants/chains.js";

function getKeepAliveAgent(web3) {
  const provider = /** @type {any} */ (web3.currentProvider);
  return provider?.httpProviderOptions?.providerOptions?.agent;
}

test("Base Sepolia web3 provider uses a keep-alive agent", async () => {
  const { getWeb3 } = await import("../src/config.js");
  const agent = getKeepAliveAgent(getWeb3(CHAIN_IDS.BASE_TESTNET));
  expect(agent).toBeDefined();
  expect(agent.options.keepAlive).toBe(true);
});

test("default web3 instance uses a keep-alive agent", async () => {
  const { web3 } = await import("../src/config.js");
  const agent = getKeepAliveAgent(web3);
  expect(agent).toBeDefined();
  expect(agent.options.keepAlive).toBe(true);
});

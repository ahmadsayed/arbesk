/**
 * wallet.js export regression tests
 *
 * Prevents the class of bug where a function is defined and exposed on
 * `window` but accidentally omitted from the ES module `export { ... }` block.
 *
 * wallet.js is now a re-export barrel.  Implementation lives in:
 *   wallet-core.js, wallet-network.js, wallet-payments.js, wallet-publishing.js
 *
 * This test imports the real barrel and asserts the whole import surface is
 * callable, plus source-level guards against legacy `window.*` exports.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as wallet from "../../frontend/src/js/blockchain/wallet.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKCHAIN = resolve(__dirname, "../../frontend/src/js/blockchain");

const WALLET = readFileSync(resolve(BLOCKCHAIN, "wallet.ts"), "utf-8");

/** Function exports every consumer imports from the barrel. */
const REQUIRED_FUNCTIONS = [
  "connectWallet",
  "disconnectWallet",
  "publishAsset",
  "updateAssetURI",
  "updateEditors",
  "switchNetwork",
  "initWallet",
  "getReadClient",
  "getActiveContract",
  "getSigner",
];

describe("wallet.js export surface", () => {
  test("barrel re-exports every required function", () => {
    const offenders = REQUIRED_FUNCTIONS.filter(
      (name) => typeof wallet[name] !== "function",
    );
    expect(offenders).toEqual([]);
  });

  test("contract binding is exported", () => {
    expect("contract" in wallet).toBe(true);
  });

  test("web3 is no longer exported", () => {
    expect(wallet.web3).toBeUndefined();
    expect(wallet.walletWeb3).toBeUndefined();
  });

  test("wallet.js has no window.* function exports", () => {
    expect(WALLET).not.toMatch(/window\.\w+\s*=\s*\w+;/);
  });
});

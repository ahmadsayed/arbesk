/**
 * wallet.js export regression tests
 *
 * Prevents the class of bug where a function is defined and exposed on
 * `window` but accidentally omitted from the ES module `export { ... }` block.
 *
 * wallet.js is now a re-export barrel.  Implementation lives in:
 *   wallet-core.js, wallet-network.js, wallet-payments.js, wallet-publishing.js
 *
 * This test checks the barrel re-exports AND verifies the implementations
 * exist in the correct sub-module sources.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKCHAIN = resolve(__dirname, "../../frontend/src/js/blockchain");

const read = (file) => readFileSync(resolve(BLOCKCHAIN, file), "utf-8");

const WALLET = read("wallet.js");
const CORE = read("wallet-core.js");
const NETWORK = read("wallet-network.js");
const PAYMENTS = read("wallet-payments.js");
const PUBLISHING = read("wallet-publishing.js");

/**
 * Extract the names from `export { ... }` or `export { ... } from "..."` blocks.
 */
function extractExportNames(src) {
  const names = [];
  // Match named exports:  export { foo, bar }
  const named = src.match(/export\s*\{([^}]+)\}/gs);
  if (named) {
    for (const m of named) {
      m.replace(/[{}]/g, "")
        .split(",")
        .forEach((s) => {
          const name = s.trim().split(/\s+/)[0]; // "foo as bar" → "foo"
          if (name && name !== "from") names.push(name);
        });
    }
  }
  // Match re-exports:  export { foo } from "./..."
  const re = /export\s*\{([^}]+)\}\s*from\s*"[^"]+"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => {
        const parts = s.split(/\s+as\s+/);
        names.push(parts[parts.length - 1]); // exported name
      });
  }
  return [...new Set(names)];
}

/**
 * Check if a function named `name` is defined in the source.
 */
function isFunctionDefined(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  return re.test(src);
}

describe("wallet.js export block", () => {
  test("file has an export block", () => {
    const names = extractExportNames(WALLET);
    expect(names.length).toBeGreaterThan(0);
  });

  const REQUIRED_EXPORTS = [
    "connectWallet",
    "disconnectWallet",
    "payForGenerationWithUSDC",
    "publishAsset",
    "updateAssetURI",
    "updateEditors",
    "switchNetwork",
    "initWallet",
    "autoConnectWallet",
  ];

  test.each(REQUIRED_EXPORTS)("%s is re-exported by barrel", (name) => {
    const exported = extractExportNames(WALLET);
    expect(exported).toContain(name);
  });

  // Implementation lives in sub-modules — some as function declarations,
  // some as async function declarations
  test.each(REQUIRED_EXPORTS)("%s is defined in a sub-module", (name) => {
    const allSources = [CORE, NETWORK, PAYMENTS, PUBLISHING].join("\n");
    expect(isFunctionDefined(allSources, name)).toBe(true);
  });

  test("web3 is exported", () => {
    const exported = extractExportNames(WALLET);
    expect(exported).toContain("web3");
  });

  test("contract is exported", () => {
    const exported = extractExportNames(WALLET);
    expect(exported).toContain("contract");
  });

  test("wallet.js has no window.* function exports", () => {
    expect(WALLET).not.toMatch(/window\.\w+\s*=\s*\w+;/);
  });

  describe("consumer import compatibility", () => {
    const exported = extractExportNames(WALLET);

    test("create-panel.js: payForGenerationWithUSDC", () => {
      expect(exported).toContain("payForGenerationWithUSDC");
    });

    test("asset-save.js: publishAsset, updateAssetURI", () => {
      expect(exported).toContain("publishAsset");
      expect(exported).toContain("updateAssetURI");
    });

    test("asset-history.js: contract", () => {
      expect(exported).toContain("contract");
    });

    test("asset-library.js: contract", () => {
      expect(exported).toContain("contract");
    });
  });
});

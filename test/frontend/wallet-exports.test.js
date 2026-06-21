/**
 * wallet.js export regression tests
 *
 * Prevents the class of bug where a function is defined and exposed on
 * `window` but accidentally omitted from the ES module `export { ... }` block.
 *
 * This test parses wallet.js source statically rather than importing it,
 * because wallet.js depends on browser globals (Web3, Web3Modal) and
 * currently lacks top-level ESM imports, causing Jest to fail parsing.
 * The static approach catches export-block omissions just as effectively.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WALLET_PATH = resolve(
  __dirname,
  "../../frontend/src/js/blockchain/wallet.js",
);

const source = readFileSync(WALLET_PATH, "utf-8");

/**
 * Extract the names from the `export { ... }` block.
 */
function extractExportNames(src) {
  const match = src.match(/export\s*\{([^}]+)\}/s);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract function names from the "Expose to window" block.
 * Returns only function identities: `window.connectWallet = connectWallet;`
 */
function extractWindowFunctionExposures(src) {
  // Find the "Expose to window" comment block through to the next blank line
  const idx = src.indexOf("// Expose to window");
  if (idx === -1) return [];
  const slice = src.slice(idx, idx + 600);

  const re = /window\.(\w+)\s*=\s*(\w+);/g;
  const names = [];
  let m;
  while ((m = re.exec(slice)) !== null) {
    if (m[1] === m[2]) names.push(m[1]);
  }
  return names;
}

/**
 * Check if a function named `name` is defined in the source.
 */
function isFunctionDefined(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  return re.test(src);
}

describe("wallet.js export block", () => {
  // ─── File structure ───

  test("file has an export block", () => {
    const names = extractExportNames(source);
    expect(names.length).toBeGreaterThan(0);
  });

  // ─── Regression: payForGenerationWithUSDC must be exported ───

  test("payForGenerationWithUSDC is in the export block", () => {
    const names = extractExportNames(source);
    expect(names).toContain("payForGenerationWithUSDC");
  });

  // ─── All exported functions must actually be defined ───

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

  test.each(REQUIRED_EXPORTS)("%s is exported", (name) => {
    const exported = extractExportNames(source);
    expect(exported).toContain(name);
  });

  test.each(REQUIRED_EXPORTS)(
    "%s is defined as a function in the source",
    (name) => {
      expect(isFunctionDefined(source, name)).toBe(true);
    },
  );

  // ─── web3 / contract object exports ───

  test("web3 is exported", () => {
    const exported = extractExportNames(source);
    expect(exported).toContain("web3");
  });

  test("contract is exported", () => {
    const exported = extractExportNames(source);
    expect(exported).toContain("contract");
  });

  // ─── No window function exports (removed in state-layer refactor) ───

  test("wallet.js has no window.* function exports", () => {
    const windowFuncs = extractWindowFunctionExposures(source);
    expect(windowFuncs).toHaveLength(0);
  });

  // ─── Consumer import contracts ───

  describe("consumer import compatibility", () => {
    const exported = extractExportNames(source);

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

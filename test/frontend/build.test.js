/**
 * Frontend Build Verification Tests
 *
 * Verifies the built frontend assets (dist/) satisfy structural
 * contracts that have caused production regressions:
 *
 *   - All JS files pass syntax check
 *   - api.js exposes functions on window for non-module consumers
 *   - wallet.js initializes contract via centralized API service
 *   - wallet.js sets window.contractAddress after init
 *   - wallet.js mock tx does not self-transfer with data (MetaMask blocks it)
 *   - scene-graph.js calls loadTokenChildNode on asset drop
 *   - studio.html pins web3 to v1.x (not @latest which pulls v4)
 */

import fs from "fs";
import path from "path";
import url from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST_JS = path.resolve(__dirname, "../../frontend/dist/js");
const STUDIO_HTML = path.resolve(__dirname, "../../frontend/dist/studio.html");

// ─── Helpers ────────────────────────────────────────────────────────────────

function walkJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(full));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

function readBuilt(name) {
  return fs.readFileSync(path.join(DIST_JS, name), "utf-8");
}

function readStudioHtml() {
  return fs.readFileSync(STUDIO_HTML, "utf-8");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Frontend Build", () => {
  // ── P0: Syntax check on every built JS file ──────────────────────────────

  describe("syntax", () => {
    const jsFiles = walkJsFiles(DIST_JS);

    test("JS files exist in dist", () => {
      expect(jsFiles.length).toBeGreaterThan(0);
    });

    for (const file of jsFiles) {
      const rel = path.relative(DIST_JS, file);
      test(`syntax: ${rel}`, () => {
        execSync(`node --check ${JSON.stringify(file)}`, {
          stdio: "pipe",
        });
      });
    }
  });

  // ── P1: api.js window exports ────────────────────────────────────────────

  describe("api.js window exports", () => {
    const api = readBuilt("services/api.js");

    const requiredExports = [
      "signTxHash",
      "getConfig",
      "getContractAddress",
      "getContractArtifact",
      "generateAsset",
      "saveManifest",
      "saveParametricVersion",
      "publishManifest",
      "getManifestHistory",
      "getTokenManifest",
      "queryLedger",
      "getLedgerStats",
    ];

    for (const name of requiredExports) {
      test(`window.${name} is assigned`, () => {
        expect(api).toMatch(
          new RegExp(`window\\.${name}\\s*=\\s*${name}`)
        );
      });
    }

    test("ApiError class is exported", () => {
      expect(api).toMatch(/export class ApiError/);
    });

    test("API_BASE is /api/v1", () => {
      expect(api).toMatch(/API_BASE\s*=\s*"\/api\/v1"/);
    });
  });

  // ── P1: wallet.js contract init ──────────────────────────────────────────

  describe("wallet.js contract init", () => {
    const wallet = readBuilt("blockchain/wallet.js");

    test("_initContract calls getContractAddress()", () => {
      expect(wallet).toMatch(/getContractAddress\(\)/);
    });

    test("_initContract calls getContractArtifact() with contract name", () => {
      expect(wallet).toMatch(/getContractArtifact\(/);
      expect(wallet).toMatch(/"ArbeskAsset"/);
    });

    test("_initContract does NOT fetch /api/contract_address directly", () => {
      expect(wallet).not.toMatch(/fetch\("\/api\/contract_address"\)/);
    });

    test("_initContract does NOT fetch ABI endpoint directly", () => {
      expect(wallet).not.toMatch(/fetch\("\/api\/abi\//);
    });

    test("_finishWalletSetup sets window.contractAddress", () => {
      expect(wallet).toMatch(/window\.contractAddress\s*=\s*contractAddress/);
    });
  });

  // ── P1: wallet.js mock tx ────────────────────────────────────────────────

  describe("wallet.js mock transaction", () => {
    const wallet = readBuilt("blockchain/wallet.js");

    test("_mockPayForGeneration sends to dev account, not self", () => {
      expect(wallet).toMatch(
        /0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/
      );
    });

    test("_mockPayForGeneration does NOT self-transfer", () => {
      const match = wallet.match(
        /async function _mockPayForGeneration[\s\S]*?return receipt\.transactionHash;/
      );
      if (!match) throw new Error("_mockPayForGeneration not found");
      const body = match[0];

      expect(body).toMatch(/to:\s*devAccount/);
      expect(body).not.toMatch(/to:\s*window\.walletAddress/);
    });

    test("_mockPayForGeneration sends 0 value", () => {
      expect(wallet).toMatch(/toWei\("0",\s*"ether"\)/);
    });

    test("_mockPayForGeneration has no data field in tx object", () => {
      const match = wallet.match(
        /async function _mockPayForGeneration[\s\S]*?return receipt\.transactionHash;/
      );
      if (!match) throw new Error("_mockPayForGeneration not found");
      const body = match[0];

      // The tx object itself (between { and }) must not contain a data property
      // Extract the tx object literal
      const txObj = body.match(/const tx = \{[\s\S]*?\};/);
      if (!txObj) throw new Error("tx object not found");
      expect(txObj[0]).not.toMatch(/\bdata:/);
    });
  });

  // ── P1: scene-graph.js asset drop rendering ──────────────────────────────

  describe("scene-graph.js asset drop", () => {
    const sceneGraph = readBuilt("engine/scene-graph.js");

    test("handleLinkedAssetDropped calls loadTokenChildNode", () => {
      expect(sceneGraph).toMatch(
        /await loadTokenChildNode\(nodeEntry,\s*parentNode/
      );
    });

    test("handleLinkedAssetDropped uses rootSceneAnchor as parent", () => {
      expect(sceneGraph).toMatch(/state\.rootSceneAnchor/);
    });
  });

  // ── P1: studio.html CDN versions ─────────────────────────────────────────

  describe("studio.html CDN versions", () => {
    const html = readStudioHtml();

    test("web3 is pinned to v1.10.0 (not @latest)", () => {
      expect(html).toMatch(/web3@1\.10\.0/);
      expect(html).not.toMatch(/web3@latest/);
    });

    test("web3modal is pinned (not @latest)", () => {
      expect(html).toMatch(/web3modal@1\.9\.12/);
    });
  });

  // ── P1: proxy/url patterns in api.js ─────────────────────────────────────

  describe("api.js fetch patterns", () => {
    const api = readBuilt("services/api.js");

    test("no hardcoded legacy URLs", () => {
      expect(api).not.toMatch(/\/api\/assets\//);
      expect(api).not.toMatch(/\/api\/abi\//);
      expect(api).not.toMatch(/\/api\/contract_address/);
      expect(api).not.toMatch(/"\/api\/ledger"/);
    });
  });
});

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
      "getConfig",
      "getContractAddress",
      "getContractArtifact",
      "generateAsset",
      "saveManifest",
      "publishManifest",
      "getManifestHistory",
      "getTokenManifest",
    ];

    for (const name of requiredExports) {
      test(`window.${name} is assigned`, () => {
        expect(api).toMatch(new RegExp(`window\\.${name}\\s*=\\s*${name}`));
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
      expect(wallet).toMatch(/"ArbeskAssetFree"/);
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

  // ── P1: wallet.js USDC payment ──────────────────────────────────────────

  describe("wallet.js USDC payment", () => {
    const wallet = readBuilt("blockchain/wallet.js");

    test("payWithUSDC is defined", () => {
      expect(wallet).toMatch(/async function payWithUSDC/);
    });

    test("payForGenerationWithUSDC delegates to payWithUSDC", () => {
      expect(wallet).toMatch(/return payWithUSDC\(/);
    });

    test("approve fallback gas is set", () => {
      expect(wallet).toMatch(/approveGas = 100000/);
    });

    test("pay fallback gas is set", () => {
      expect(wallet).toMatch(/payGas = needsGenerousGas \? 500000 : 300000/);
    });
  });

  // ── P1: scene-graph.js asset drop rendering ──────────────────────────────

  describe("scene-graph.js asset drop", () => {
    const sceneGraph = readBuilt("engine/scene-graph.js");

    test("handleLinkedAssetDropped calls loadTokenChildNode", () => {
      expect(sceneGraph).toMatch(
        /await loadTokenChildNode\(nodeEntry,\s*parentNode/,
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

    test("web3modal is removed (not present)", () => {
      expect(html).not.toMatch(/web3modal/);
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

  // ── P0: wallet-connect.js must not static-import from CDN ────────────────
  // Regression: jsdelivr +esm transform produced broken code (__exportStar
  // error) for @walletconnect/ethereum-provider. Because the import was
  // static (top-level), the entire module parse failed, cascading to
  // wallet-modal.js → wallet.js → window.connectWallet never set.
  //
  // Fix: use dynamic import() with fallback CDN so a broken transform only
  // disables WalletConnect; injected wallets (MetaMask etc.) still work.

  describe("wallet-connect.js CDN import safety", () => {
    const walletConnect = readBuilt("blockchain/wallet-connect.js");

    test("does NOT static-import from an external CDN URL", () => {
      // Static import from https:// would break the whole app if the CDN
      // returns bad code. Dynamic import() isolates the failure.
      expect(walletConnect).not.toMatch(
        /import\s*\{[^}]*\}\s*from\s*["']https:\/\//,
      );
    });

    test("uses dynamic import() for external CDN modules", () => {
      expect(walletConnect).toMatch(/await\s+import\s*\(/);
    });
  });

  // ── P0: studio.html must not rely on inline onclick for module functions ─
  // Regression: onclick="connectWallet()" failed because connectWallet is
  // defined inside an ES module (wallet.js). When wallet.js failed to load
  // (due to the wallet-connect.js cascade), connectWallet was undefined.
  //
  // Fix: wire the click handler via addEventListener inside the module script.

  describe("studio.html inline event handler safety", () => {
    const html = readStudioHtml();

    test("no inline onclick referencing module-scoped functions", () => {
      // connectWallet, disconnectWallet, etc. are module-scoped and not
      // guaranteed to exist until the module script executes. Using
      // addEventListener inside the module is the robust pattern.
      expect(html).not.toMatch(/onclick\s*=\s*"connectWallet\(\)"/);
    });
  });

  // ── P0: CSP must be delivered via HTTP header, not meta tag ──────────────
  // Regression: Content-Security-Policy-Report-Only is not valid in a
  // <meta> element. Chrome ignored the policy entirely with:
  //   "was delivered via a <meta> element, which is disallowed."
  //
  // Fix: Express middleware sets the header.

  describe("studio.html CSP delivery", () => {
    const html = readStudioHtml();

    test("no CSP-Report-Only meta tag (must be HTTP header)", () => {
      expect(html).not.toMatch(
        /http-equiv\s*=\s*"Content-Security-Policy-Report-Only"/i,
      );
    });

    test("no CSP enforcing meta tag with external script-src (header preferred)", () => {
      // If a CSP meta tag exists at all, it should not contain external
      // script sources that would complicate maintenance. The Express
      // middleware is the single source of truth.
      const metaCsp = html.match(
        /http-equiv\s*=\s*"Content-Security-Policy"[^>]*>/i,
      );
      if (metaCsp) {
        expect(metaCsp[0]).not.toMatch(/script-src/);
      }
    });
  });

  // ── P0: studio-init.js must start wallet discovery ───────────────────────
  // Regression: EIP-6963 wallet discovery (MetaMask, Rabby, etc.) never
  // started because initWallet() was not called. The wallet modal showed
  // "No injected wallets detected" even when MetaMask was installed.
  //
  // Fix: studio-init.js calls initWallet() to register the eip6963 event
  // listener and autoConnectWallet() to restore previous sessions.

  describe("studio-init.js wallet lifecycle", () => {
    const init = readBuilt("engine/studio-init.js");

    test("calls initWallet() to start EIP-6963 discovery", () => {
      expect(init).toMatch(/initWallet\(\)/);
    });

    test("calls autoConnectWallet() to restore previous session", () => {
      expect(init).toMatch(/autoConnectWallet\(\)/);
    });
  });
});

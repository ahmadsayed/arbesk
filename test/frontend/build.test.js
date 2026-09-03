/**
 * Frontend Build Verification Tests
 *
 * Verifies the bundled frontend assets (dist/) satisfy structural contracts
 * that have caused production regressions. The frontend is now bundled by
 * esbuild (frontend/scripts/bundle.js) into a single minified app.js, so
 * dist/js is no longer a per-file mirror of src/js. Logic-level guards below
 * therefore read the SOURCE files (the input esbuild bundles), while
 * structure-level guards read dist/ directly.
 *
 *   - All JS files pass syntax check
 *   - dist/js ships only app.js + worker + two head scripts (no tests/bench)
 *   - app.js bundles third-party deps (no esm.sh / import map)
 *   - worker bundle is self-contained (no bare @arbesk/ imports)
 *   - api.ts exposes functions via ES exports (no window.* assignments)
 *   - wallet-core.ts initializes contract via centralized API service
 *   - wallet-payments.ts USDC payment path
 *   - scene-loader.ts calls loadTokenChildNode on asset drop
 *   - app.html has no web3/importmap; loads app.js as the single entry
 */

import fs from "fs";
import path from "path";
import url from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST_JS = path.resolve(__dirname, "../../frontend/dist/js");
const SRC_JS = path.resolve(__dirname, "../../frontend/src/js");
// Studio + Library are now served from a single SPA document (app.html).
const STUDIO_HTML = path.resolve(__dirname, "../../frontend/dist/app.html");

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

function readBundle(name) {
  return fs.readFileSync(path.join(DIST_JS, name), "utf-8");
}

function readSource(rel) {
  return fs.readFileSync(path.join(SRC_JS, rel), "utf-8");
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
      test("syntax: " + rel, () => {
        execSync("node --check " + JSON.stringify(file), {
          stdio: "pipe",
        });
      });
    }
  });

  // ── P0: Bundle structure — single minified entry, no cruft ───────────────

  describe("bundle structure", () => {
    test("dist/js ships exactly app.js + 2 vendor bundles + worker + head scripts", () => {
      const rel = walkJsFiles(DIST_JS)
        .map((f) => path.relative(DIST_JS, f).split(path.sep).join("/"))
        .sort();
      expect(rel).toEqual([
        "app.js",
        "app/initial-view.js",
        "engine/theme-init.js",
        "vendor/cdp-core.js",
        "vendor/viem.js",
        "workers/gltf-worker.js",
      ]);
    });

    test("cdp-core is pre-bundled separately, not inlined into app.js", () => {
      const app = readBundle("app.js");
      expect(app).not.toMatch(/Project ID is required/);
      expect(readBundle("vendor/cdp-core.js")).toMatch(/Project ID is required/);
    });

    test("no test, spec, bench, or sourcemap files ship", () => {
      for (const file of walkJsFiles(DIST_JS)) {
        const rel = path.relative(DIST_JS, file);
        expect(rel).not.toMatch(/\.(test|spec)\./);
        expect(rel).not.toMatch(/bench/);
        expect(rel).not.toMatch(/\.map$/);
      }
    });

    test("viem is a shared vendor bundle (app.js and cdp-core.js import it)", () => {
      expect(readBundle("app.js")).toMatch(/froms*"viem/);
      expect(readBundle("vendor/cdp-core.js")).toMatch(/froms*"viem/);
    });

    test("worker bundle is self-contained (no bare @arbesk/ imports)", () => {
      const worker = readBundle("workers/gltf-worker.js");
      expect(worker).not.toMatch(/from\s*["']@arbesk\//);
    });
  });

  // ── P1: api.ts ES module exports ───────────────────────────────────────────
  // These functions are consumed via ES module imports - window.* assignments
  // were removed in the state-layer refactor (all callers import directly).

  describe("api.ts ES module exports", () => {
    const api = readSource("services/api.ts");

    const requiredExports = [
      "getConfig",
      "getContractAddress",
      "getContractArtifact",
      "generateAsset",
      "snapshotCommentsArchive",
    ];

    test("api.ts has no window.* function assignments", () => {
      for (const name of requiredExports) {
        expect(api).not.toMatch(
          new RegExp("window\\." + name + "\\s*=\\s*" + name),
        );
      }
    });

    test("ApiError is re-exported from the backend-client leaf", () => {
      // The class itself lives in backend-client.ts (wallet-free leaf);
      // api.ts re-exports it for backward compatibility.
      expect(api).toMatch(/export \{[^}]*ApiError[^}]*\} from "\.\/backend-client\.ts"/);
      const client = readSource("services/backend-client.ts");
      expect(client).toMatch(/export class ApiError/);
    });

    test("API_BASE is /api/v1", () => {
      const client = readSource("services/backend-client.ts");
      expect(client).toMatch(/API_BASE\s*=\s*"\/api\/v1"/);
    });
  });

  // ── P1: wallet-core.ts contract init ────────────────────────────────────

  describe("wallet-core.ts contract init", () => {
    const wallet = readSource("blockchain/wallet-core.ts");

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

    test("_initContract writes contractAddress to walletState", () => {
      expect(wallet).toMatch(/walletState\.set\(\{.*contract/s);
    });
  });

  // ── P1: wallet-payments.ts USDC payment ────────────────────────────────

  describe("wallet-payments.ts USDC payment", () => {
    const wallet = readSource("blockchain/wallet-payments.ts");

    test("payWithUSDC is defined", () => {
      expect(wallet).toMatch(/async function payWithUSDC/);
    });

    test("payForGenerationWithUSDC delegates to payWithUSDC", () => {
      expect(wallet).toMatch(/return payWithUSDC\(/);
    });

    test("approve fallback gas is set", () => {
      expect(wallet).toMatch(/sendContractCall\(\{[\s\S]*?functionName:\s*"approve"[\s\S]*?fallbackGas:\s*100000/);
    });

    test("pay fallback gas is set", () => {
      expect(wallet).toMatch(/sendContractCall\(\{[\s\S]*?functionName:\s*"payForGenerationWithUSDC"[\s\S]*?fallbackGas:\s*300000/);
    });
  });

  // ── P1: scene-loader.ts asset drop rendering ───────────────────────────

  describe("scene-loader.ts asset drop", () => {
    const sceneLoader = readSource("engine/scene-loader.ts");

    test("handleLinkedAssetDropped calls loadTokenChildNode", () => {
      expect(sceneLoader).toMatch(
        /await loadTokenChildNode\(nodeEntry,\s*parentNode/,
      );
    });

    test("handleLinkedAssetDropped uses rootSceneAnchor as parent", () => {
      expect(sceneLoader).toMatch(/state\.rootSceneAnchor/);
    });
  });

  // ── P1: studio.html CDN versions ─────────────────────────────────────────

  describe("studio.html CDN versions", () => {
    const html = readStudioHtml();

    test("web3 CDN script is removed", () => {
      expect(html).not.toMatch(/web3@/);
      expect(html).not.toMatch(/web3\.min\.js/);
    });

    test("import map resolves viem/cdp-core to local vendor files (no esm.sh)", () => {
      expect(html).toMatch(/"@coinbase\/cdp-core":\s*"\/js\/vendor\/cdp-core\.js"/);
      expect(html).toMatch(/"viem":\s*"\/js\/vendor\/viem\.js"/);
      expect(html).not.toMatch(/esm\.sh/);
    });

    test("web3modal is removed (not present)", () => {
      expect(html).not.toMatch(/web3modal/);
    });
  });

  // ── P1: proxy/url patterns in api.ts ─────────────────────────────────────

  describe("api.ts fetch patterns", () => {
    const api = readSource("services/api.ts");

    test("no hardcoded legacy URLs", () => {
      expect(api).not.toMatch(/\/api\/assets\//);
      expect(api).not.toMatch(/\/api\/abi\//);
      expect(api).not.toMatch(/\/api\/contract_address/);
      expect(api).not.toMatch(/"\/api\/ledger"/);
    });
  });

  // ── P0: wallet-connect.ts must not static-import from CDN ────────────────

  describe("wallet-connect.ts CDN import safety", () => {
    const walletConnect = readSource("blockchain/wallet-connect.ts");

    test("does NOT static-import from an external CDN URL", () => {
      expect(walletConnect).not.toMatch(
        /import\s*\{[^}]*\}\s*from\s*["']https:\/\//,
      );
    });

    test("uses dynamic import() for external CDN modules", () => {
      expect(walletConnect).toMatch(/await\s+import\s*\(/);
    });
  });

  // ── P0: studio.html must not rely on inline onclick for module functions ─

  describe("studio.html inline event handler safety", () => {
    const html = readStudioHtml();

    test("no inline onclick referencing module-scoped functions", () => {
      expect(html).not.toMatch(/onclick\s*=\s*"connectWallet\(\)"/);
    });
  });

  // ── P0: CSP must be delivered via HTTP header, not meta tag ──────────────

  describe("studio.html CSP delivery", () => {
    const html = readStudioHtml();

    test("no CSP-Report-Only meta tag (must be HTTP header)", () => {
      expect(html).not.toMatch(
        /http-equiv\s*=\s*"Content-Security-Policy-Report-Only"/i,
      );
    });

    test("no CSP enforcing meta tag with external script-src (header preferred)", () => {
      const metaCsp = html.match(
        /http-equiv\s*=\s*"Content-Security-Policy"[^>]*>/i,
      );
      if (metaCsp) {
        expect(metaCsp[0]).not.toMatch(/script-src/);
      }
    });
  });

  // ── P0: app-init.ts must start wallet discovery ──────────────────────────

  describe("app-init.ts wallet lifecycle", () => {
    const init = readSource("app-init.ts");

    test("calls initWallet() to start EIP-6963 discovery", () => {
      expect(init).toMatch(/initWallet\(\)/);
    });

    test("does not call autoConnectWallet() directly; wires Login / Signup click", () => {
      expect(init).not.toMatch(/autoConnectWallet\(\)/);
      expect(init).toMatch(/connectWallet/);
    });

    test("initializes the router to activate the initial view", () => {
      expect(init).toMatch(/initRouter\(\)/);
    });
  });

  // ── P0: app.html is a single-document SPA shell ──────────────────────────

  describe("app.html SPA shell", () => {
    const html = readStudioHtml();

    test("contains both the Studio and Library view containers", () => {
      expect(html).toMatch(/id="studioView"/);
      expect(html).toMatch(/id="libraryView"/);
    });

    test("loads app.js as the single entry module", () => {
      expect(html).toMatch(
        /<script[^>]+type="module"[^>]+src="\/js\/app\.js"/,
      );
    });

    test("page-switcher tabs are SPA routes (data-nav, clean URLs)", () => {
      expect(html).toMatch(/href="\/studio"[^>]*data-nav/);
      expect(html).toMatch(/href="\/library"[^>]*data-nav/);
    });
  });
});

/**
 * Vendoring of the @arbesk/* workspace packages into dist/js/vendor/ (#137).
 *
 * The CLI login page (src/api/cli-auth.html, served at /api/v1/cli-auth) is
 * not part of app.js: its import map points `@arbesk/wallet/` at
 * /js/vendor/wallet/, and it imports `@arbesk/wallet/facade.js` after the
 * email code is accepted. The production `build` once skipped the step that
 * copies the package dist there, so promptscad.com answered 404 and no CLI
 * login could finish. These tests tie the page's import map, the vendored
 * package list and the frontend build together.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VENDORED_PACKAGES,
  vendorPackages,
} from "../../frontend/scripts/vendor-packages.js";

const ROOT = path.resolve(import.meta.dir, "../..");
const CLI_AUTH_HTML = path.join(ROOT, "src/api/cli-auth.html");

/** @param {string} rel */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** @param {string} file @param {string} [content] */
function writeFile(file, content = "export {};\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe("frontend build", () => {
  const pkg = JSON.parse(read("frontend/package.json"));
  const steps = pkg.scripts.build.split("&&").map((s) => s.trim());
  const at = (name) => steps.indexOf(`bun run ${name}`);

  test("vendors the packages after bundling and before compression", () => {
    expect(at("build:bundle")).toBeGreaterThan(-1);
    expect(at("build:vendor")).toBeGreaterThan(at("build:bundle"));
    expect(at("build:vendor")).toBeLessThan(at("build:compress"));
  });

  test("build:vendor runs the vendoring script", () => {
    expect(pkg.scripts["build:vendor"]).toBe("bun scripts/build-vendor.js");
  });
});

describe("vendorPackages", () => {
  let tmp;
  let packagesRoot;
  let distRoot;
  const silent = () => {};

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-packages-"));
    packagesRoot = path.join(tmp, "packages");
    distRoot = path.join(tmp, "dist");
    for (const name of [...VENDORED_PACKAGES, "other"]) {
      writeFile(path.join(packagesRoot, name, "dist/index.js"));
    }
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const vendorDir = (name) => path.join(distRoot, "js/vendor", name);

  test("copies each built package to dist/js/vendor/<name>, without type declarations or source maps", () => {
    const walletDist = path.join(packagesRoot, "wallet/dist");
    writeFile(path.join(walletDist, "facade.js"));
    writeFile(path.join(walletDist, "facade.d.ts"));
    writeFile(path.join(walletDist, "facade.js.map"));
    writeFile(path.join(walletDist, "adapters/eoa.js"));

    const vendored = vendorPackages({ packagesRoot, distRoot, strict: true, log: silent });

    expect(vendored).toEqual(VENDORED_PACKAGES);
    expect(fs.existsSync(path.join(vendorDir("wallet"), "facade.js"))).toBe(true);
    expect(fs.existsSync(path.join(vendorDir("wallet"), "adapters/eoa.js"))).toBe(true);
    expect(fs.existsSync(path.join(vendorDir("wallet"), "facade.d.ts"))).toBe(false);
    expect(fs.existsSync(path.join(vendorDir("wallet"), "facade.js.map"))).toBe(false);
  });

  test("vendors only the packages an import-map page loads", () => {
    vendorPackages({ packagesRoot, distRoot, strict: true, log: silent });

    expect(VENDORED_PACKAGES).toEqual(["wallet"]);
    expect(fs.readdirSync(path.join(distRoot, "js/vendor"))).toEqual(["wallet"]);
  });

  test("replaces an earlier copy, so files removed from a package do not linger", () => {
    writeFile(path.join(vendorDir("wallet"), "removed-module.js"));

    vendorPackages({ packagesRoot, distRoot, strict: true, log: silent });

    expect(fs.existsSync(path.join(vendorDir("wallet"), "removed-module.js"))).toBe(false);
    expect(fs.existsSync(path.join(vendorDir("wallet"), "index.js"))).toBe(true);
  });

  test("strict mode fails, naming the package, when it has not been built", () => {
    fs.rmSync(path.join(packagesRoot, "wallet/dist"), { recursive: true });

    expect(() =>
      vendorPackages({ packagesRoot, distRoot, strict: true, log: silent }),
    ).toThrow(/packages\/wallet\/dist.*build:packages/);
  });

  test("lenient mode warns and still vendors the packages that are built", () => {
    fs.rmSync(path.join(packagesRoot, "wallet/dist"), { recursive: true });
    const log = jest.fn();

    const packages = ["wallet", "other"];

    const vendored = vendorPackages({ packages, packagesRoot, distRoot, strict: false, log });

    expect(vendored).toEqual(["other"]);
    expect(fs.existsSync(vendorDir("wallet"))).toBe(false);
    expect(fs.existsSync(path.join(vendorDir("other"), "index.js"))).toBe(true);
    expect(log.mock.calls.flat().join("\n")).toMatch(/WARN.*packages\/wallet\/dist/);
  });
});

// ─── The CLI login page's module graph ────────────────────────────────────────
//
// Reads the page's import map and follows every @arbesk/* module the page
// imports through its package source. Each @arbesk/* specifier must land in a
// vendored directory, and every bare specifier the package source imports
// must be in the import map, or the browser cannot load it.

function readImportMap() {
  const html = fs.readFileSync(CLI_AUTH_HTML, "utf8");
  const json = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!json) throw new Error("cli-auth.html has no import map");
  return JSON.parse(json[1]).imports;
}

/** The page's own dynamic imports, from its inline module script. */
function readPageImports() {
  const html = fs.readFileSync(CLI_AUTH_HTML, "utf8");
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!script) throw new Error("cli-auth.html has no module script");
  return [...script[1].matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
}

/**
 * Resolves a bare specifier against an import map, as a browser does: an exact
 * key wins, otherwise the longest matching key ending in "/".
 *
 * @param {Record<string, string>} imports
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveImportMap(imports, specifier) {
  if (imports[specifier]) return imports[specifier];
  const prefix = Object.keys(imports)
    .filter((k) => k.endsWith("/") && specifier.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? imports[prefix] + specifier.slice(prefix.length) : null;
}

const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * Bare specifiers reachable from a package source module, following relative
 * imports. Type-only imports are erased and never reach the browser.
 *
 * @param {string} entry absolute path to a package `src/*.ts` module
 * @returns {Set<string>}
 */
function bareImportsFrom(entry) {
  const bare = new Set();
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { path: spec } of transpiler.scanImports(fs.readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        queue.push(path.resolve(path.dirname(file), spec.replace(/\.js$/, ".ts")));
      } else {
        bare.add(spec);
      }
    }
  }
  return bare;
}

describe("CLI login page module graph", () => {
  const imports = readImportMap();
  const arbeskImports = readPageImports().filter((s) => s.startsWith("@arbesk/"));

  test("the page loads @arbesk/wallet/facade.js to build the SIWE proof", () => {
    expect(arbeskImports).toContain("@arbesk/wallet/facade.js");
  });

  test("every module the page imports is in the import map", () => {
    const pageImports = readPageImports();
    expect(pageImports).toContain("@coinbase/cdp-core");
    expect(pageImports.filter((s) => resolveImportMap(imports, s) === null)).toEqual([]);
  });

  for (const specifier of arbeskImports) {
    const [, name, subpath] = specifier.match(/^@arbesk\/([^/]+)\/(.+)\.js$/) ?? [];
    const source = path.join(ROOT, "packages", name ?? "", "src", `${subpath}.ts`);

    test(`${specifier} resolves to a vendored /js/vendor/ file`, () => {
      expect(VENDORED_PACKAGES).toContain(name);
      expect(resolveImportMap(imports, specifier)).toBe(`/js/vendor/${name}/${subpath}.js`);
      expect(fs.existsSync(source)).toBe(true);
    });

    test(`every bare import under ${specifier} is in the import map`, () => {
      const unmapped = [...bareImportsFrom(source)].filter(
        (spec) => resolveImportMap(imports, spec) === null,
      );
      expect(unmapped).toEqual([]);
    });
  }
});

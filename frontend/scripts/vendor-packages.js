'use strict';
/**
 * Copies the built @arbesk/* workspace packages into dist/js/vendor/<name>/
 * for pages that load them through an import map rather than from app.js.
 *
 * The CLI login page (src/api/cli-auth.html, served at /api/v1/cli-auth) is
 * one of those: its import map points `@arbesk/wallet/` at /js/vendor/wallet/
 * and it imports `@arbesk/wallet/facade.js` once the email code is accepted.
 * The production `build` runs this through build-vendor.js (strict, so a
 * missing package fails the build); the per-file `build:scripts` copy
 * (render-scripts.js) runs it leniently.
 */
const fs = require('fs');
const path = require('path');

/**
 * Workspace packages served under dist/js/vendor/, by directory name. Only
 * what an import-map page loads: @arbesk/asset-core is bundled into app.js
 * and the workers, and no page loads it from /js/vendor/.
 */
const VENDORED_PACKAGES = ['wallet'];

const DEFAULT_PACKAGES_ROOT = path.resolve(__dirname, '../../packages');
const DEFAULT_DIST_ROOT = path.resolve(__dirname, '../dist');

/** Browsers load only the .js modules; skip type declarations and source maps. */
function isRuntimeFile(src) {
  return !/\.d\.ts$|\.map$/.test(src);
}

/**
 * Vendors each built package into `<distRoot>/js/vendor/<name>/`, replacing
 * any earlier copy.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.packages] package directory names to vendor
 * @param {string} [opts.packagesRoot] directory holding the workspace packages
 * @param {string} [opts.distRoot] the frontend dist directory
 * @param {boolean} [opts.strict] throw, instead of warning, when a package has
 *   not been built
 * @param {(msg: string) => void} [opts.log]
 * @returns {string[]} the names of the packages that were vendored
 */
function vendorPackages({
  packages = VENDORED_PACKAGES,
  packagesRoot = DEFAULT_PACKAGES_ROOT,
  distRoot = DEFAULT_DIST_ROOT,
  strict = false,
  log = console.log,
} = {}) {
  const vendored = [];
  for (const name of packages) {
    const from = path.join(packagesRoot, name, 'dist');
    const to = path.join(distRoot, 'js', 'vendor', name);
    if (!fs.existsSync(path.join(from, 'index.js'))) {
      const msg = `packages/${name}/dist is missing; run \`bun run build:packages\` first`;
      if (strict) throw new Error(msg);
      log(`### WARN: ${msg}`);
      continue;
    }
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, filter: isRuntimeFile });
    vendored.push(name);
    log(`### INFO: Vendored @arbesk/${name} into dist/js/vendor/${name}`);
  }
  return vendored;
}

module.exports = { VENDORED_PACKAGES, vendorPackages };

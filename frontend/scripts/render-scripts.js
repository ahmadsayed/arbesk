'use strict';
const fs = require('fs');
const packageJSON = require('../package.json');
const path = require('path');

module.exports = function renderScripts() {
    const sourcePath = path.resolve(__dirname, '../src/js');
    const destPath = path.resolve(__dirname, '../dist');

    if (!fs.existsSync(sourcePath)) {
        console.log('### INFO: No src/js found, skipping scripts build');
        return;
    }

    fs.cpSync(sourcePath, path.join(destPath, 'js'), { recursive: true });

    // Vendor the built @arbesk/asset-core workspace package so the browser
    // import map (head.pug) can resolve the bare specifier. The package is
    // compiled by the root `prebuild:frontend` hook; skip quietly when absent.
    const assetCoreDist = path.resolve(__dirname, '../../packages/asset-core/dist');
    const assetCoreDest = path.resolve(destPath, 'js/vendor/asset-core');
    if (fs.existsSync(assetCoreDist)) {
        fs.cpSync(assetCoreDist, assetCoreDest, { recursive: true });
        console.log('### INFO: Vendored @arbesk/asset-core into dist/js/vendor/asset-core');
    } else {
        console.log('### WARN: packages/asset-core/dist missing — run `npm run build:packages` first');
    }

  // Vendor the built @arbesk/wallet workspace package (same pattern as asset-core).
  const walletDist = path.resolve(__dirname, '../../packages/wallet/dist');
  const walletDest = path.resolve(destPath, 'js/vendor/wallet');
  if (fs.existsSync(walletDist)) {
    fs.cpSync(walletDist, walletDest, { recursive: true });
    console.log('### INFO: Vendored @arbesk/wallet into dist/js/vendor/wallet');
  } else {
    console.log('### WARN: packages/wallet/dist missing — run `npm run build:packages` first');
  }

    // Copy shared root-level constants so browser imports like
    // `../../../../constants/chains.js` resolve at runtime.
    const sourcePathConstants = path.resolve(__dirname, '../../constants');
    const destPathConstants = path.resolve(__dirname, '../dist/constants');
    if (fs.existsSync(sourcePathConstants)) {
        fs.cpSync(sourcePathConstants, destPathConstants, { recursive: true });
    }

    const sourcePathScriptsJS = path.resolve(__dirname, '../src/js/scripts.js');
    const destPathScriptsJS = path.resolve(__dirname, '../dist/js/scripts.js');

    if (fs.existsSync(sourcePathScriptsJS)) {
        const copyright = `/*!
* ${packageJSON.name} v${packageJSON.version}
* Copyright ${new Date().getFullYear()} Arbesk
* Licensed under ${packageJSON.license || 'MIT'}
*/
`;
        const scriptsJS = fs.readFileSync(sourcePathScriptsJS);
        fs.writeFileSync(destPathScriptsJS, copyright + scriptsJS);
    }
};

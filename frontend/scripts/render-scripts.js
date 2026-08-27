'use strict';
const fs = require('fs');
const packageJSON = require('../package.json');
const upath = require('upath');
const sh = require('shelljs');

module.exports = function renderScripts() {
    const sourcePath = upath.resolve(upath.dirname(__filename), '../src/js');
    const destPath = upath.resolve(upath.dirname(__filename), '../dist/.');

    if (!sh.test('-e', sourcePath)) {
        console.log('### INFO: No src/js found, skipping scripts build');
        return;
    }

    sh.cp('-R', sourcePath, destPath);

    // Vendor the built @arbesk/asset-core workspace package so the browser
    // import map (head.pug) can resolve the bare specifier. The package is
    // compiled by the root `prebuild:frontend` hook; skip quietly when absent.
    const assetCoreDist = upath.resolve(upath.dirname(__filename), '../../packages/asset-core/dist');
    const assetCoreDest = upath.resolve(destPath, 'js/vendor/asset-core');
    if (sh.test('-e', assetCoreDist)) {
        sh.mkdir('-p', assetCoreDest);
        sh.cp('-R', `${assetCoreDist}/*`, assetCoreDest);
        console.log('### INFO: Vendored @arbesk/asset-core into dist/js/vendor/asset-core');
    } else {
        console.log('### WARN: packages/asset-core/dist missing — run `npm run build:packages` first');
    }

  // Vendor the built @arbesk/wallet workspace package (same pattern as asset-core).
  const walletDist = upath.resolve(upath.dirname(__filename), '../../packages/wallet/dist');
  const walletDest = upath.resolve(destPath, 'js/vendor/wallet');
  if (sh.test('-e', walletDist)) {
    sh.mkdir('-p', walletDest);
    sh.cp('-R', `${walletDist}/*`, walletDest);
    console.log('### INFO: Vendored @arbesk/wallet into dist/js/vendor/wallet');
  } else {
    console.log('### WARN: packages/wallet/dist missing — run `npm run build:packages` first');
  }

    // Copy shared root-level constants so browser imports like
    // `../../../../constants/chains.js` resolve at runtime.
    const sourcePathConstants = upath.resolve(upath.dirname(__filename), '../../constants');
    const destPathConstants = upath.resolve(upath.dirname(__filename), '../dist/constants');
    if (sh.test('-e', sourcePathConstants)) {
        sh.mkdir('-p', destPathConstants);
        sh.cp('-R', `${sourcePathConstants}/*`, destPathConstants);
    }

    const sourcePathScriptsJS = upath.resolve(upath.dirname(__filename), '../src/js/scripts.js');
    const destPathScriptsJS = upath.resolve(upath.dirname(__filename), '../dist/js/scripts.js');

    if (sh.test('-e', sourcePathScriptsJS)) {
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

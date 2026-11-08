'use strict';
const fs = require('fs');
const packageJSON = require('../package.json');
const path = require('path');
const { vendorPackages } = require('./vendor-packages');

module.exports = function renderScripts() {
    const sourcePath = path.resolve(__dirname, '../src/js');
    const destPath = path.resolve(__dirname, '../dist');

    if (!fs.existsSync(sourcePath)) {
        console.log('### INFO: No src/js found, skipping scripts build');
        return;
    }

    fs.cpSync(sourcePath, path.join(destPath, 'js'), { recursive: true });

    // Vendor the built @arbesk/* packages that import-map pages load (the CLI
    // login page); warn rather than fail when a package has not been built.
    vendorPackages({ distRoot: destPath });

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

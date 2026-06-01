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

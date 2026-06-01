'use strict';
const upath = require('upath');
const sh = require('shelljs');

module.exports = function renderAssets() {
    const sourcePath = upath.resolve(upath.dirname(__filename), '../public');
    const destPath = upath.resolve(upath.dirname(__filename), '../dist/.');

    if (!sh.test('-e', sourcePath)) {
        console.log('### INFO: No public/ found, skipping assets build');
        return;
    }

    const files = sh.ls(sourcePath);
    if (files.length === 0) {
        console.log('### INFO: public/ is empty, skipping assets copy');
        return;
    }
    sh.cp('-R', `${sourcePath}/*`, destPath);
};

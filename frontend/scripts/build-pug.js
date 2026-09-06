'use strict';
const fs = require('fs');
const path = require('path');
const renderPug = require('./render-pug');

const srcPath = path.resolve(__dirname, '../src');

if (!fs.existsSync(srcPath)) {
    console.log('### INFO: No src/ found, skipping pug build');
    process.exit(0);
}

fs.readdirSync(srcPath, { recursive: true }).forEach(_processFile);

function _processFile(filePath) {
    if (
        filePath.match(/\.pug$/)
        && !filePath.match(/include/)
        && !filePath.match(/mixin/)
        && !filePath.match(/[/\\]pug[/\\]layouts[/\\]/)
    ) {
        renderPug(path.join(srcPath, filePath));
    }
}

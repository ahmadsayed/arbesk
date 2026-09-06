'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function renderAssets() {
    const sourcePath = path.resolve(__dirname, '../public');
    const destPath = path.resolve(__dirname, '../dist');

    if (!fs.existsSync(sourcePath)) {
        console.log('### INFO: No public/ found, skipping assets build');
        return;
    }

    const files = fs.readdirSync(sourcePath);
    if (files.length === 0) {
        console.log('### INFO: public/ is empty, skipping assets copy');
        return;
    }
    fs.cpSync(sourcePath, destPath, { recursive: true });
};

'use strict';
const fs = require('fs');
const path = require('path');
const pug = require('pug');
const prettier = require('prettier');

module.exports = function renderPug(filePath) {
    const destPath = filePath.replace(/src\/pug\//, 'dist/').replace(/\.pug$/, '.html');
    const srcPath = path.resolve(__dirname, '../src');

    console.log(`### INFO: Rendering ${filePath} to ${destPath}`);
    const html = pug.renderFile(filePath, {
        doctype: 'html',
        filename: filePath,
        basedir: srcPath,
        // Production builds (start-prod.sh sets ARBESK_PRODUCTION_BUILD=1) strip
        // the dev-only browser console bridge from head.pug entirely.
        devConsole: process.env.ARBESK_PRODUCTION_BUILD !== '1'
    });

    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const prettified = prettier.format(html, {
        printWidth: 1000,
        tabWidth: 4,
        singleQuote: true,
        proseWrap: 'preserve',
        endOfLine: 'lf',
        parser: 'html',
        htmlWhitespaceSensitivity: 'ignore'
    });

    fs.writeFileSync(destPath, prettified);
};

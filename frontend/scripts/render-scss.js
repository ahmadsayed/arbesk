'use strict';
const autoprefixer = require('autoprefixer');
const fs = require('fs');
const packageJSON = require('../package.json');
const upath = require('upath');
const postcss = require('postcss');
const sass = require('sass');
const sh = require('shelljs');

const stylesPath = '../src/scss/styles.scss';
const destPath = upath.resolve(upath.dirname(__filename), '../dist/css/styles.css');

module.exports = function renderSCSS() {
    const srcFile = upath.resolve(upath.dirname(__filename), stylesPath);
    if (!sh.test('-e', srcFile)) {
        console.log('### INFO: No styles.scss found, skipping SCSS build');
        return;
    }

    const results = sass.renderSync({
        data: entryPoint,
        includePaths: [
            upath.resolve(upath.dirname(__filename), '../node_modules')
        ],
    });

    const destPathDirname = upath.dirname(destPath);
    if (!sh.test('-e', destPathDirname)) {
        sh.mkdir('-p', destPathDirname);
    }

    postcss([autoprefixer]).process(results.css, { from: 'styles.css', to: 'styles.css' }).then(result => {
        result.warnings().forEach(warn => {
            console.warn(warn.toString());
        });
        fs.writeFileSync(destPath, result.css.toString());
    });
};

const title = packageJSON.title || packageJSON.name || 'Arbesk';
const homepage = packageJSON.homepage || '#';
const author = packageJSON.author || 'Arbesk Team';
const license = packageJSON.license || 'MIT';

const entryPoint = `/*!
* Start Bootstrap - ${title} v${packageJSON.version} (${homepage})
* Copyright 2013-${new Date().getFullYear()} ${author}
* Licensed under ${license} (https://github.com/StartBootstrap/${packageJSON.name}/blob/master/LICENSE)
*/
@import "${stylesPath}"
`;

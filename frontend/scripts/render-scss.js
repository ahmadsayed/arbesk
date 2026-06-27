"use strict";
const autoprefixer = require("autoprefixer");
const fs = require("fs");

const upath = require("upath");
const postcss = require("postcss");
const sass = require("sass");
const sh = require("shelljs");

const srcScssDir = upath.resolve(upath.dirname(__filename), "../src/scss");
const stylesFile = upath.join(srcScssDir, "styles.scss");
const destPath = upath.resolve(
  upath.dirname(__filename),
  "../dist/css/styles.css"
);

module.exports = function renderSCSS() {
  if (!sh.test("-e", stylesFile)) {
    console.log("### INFO: No styles.scss found, skipping SCSS build");
    return;
  }

  const results = sass.renderSync({
    file: stylesFile,
    includePaths: [srcScssDir],
  });

  const destPathDirname = upath.dirname(destPath);
  if (!sh.test("-e", destPathDirname)) {
    sh.mkdir("-p", destPathDirname);
  }

  postcss([autoprefixer])
    .process(results.css, { from: "styles.css", to: "styles.css" })
    .then((result) => {
      result.warnings().forEach((warn) => {
        console.warn(warn.toString());
      });
      fs.writeFileSync(destPath, result.css.toString());
    });
};

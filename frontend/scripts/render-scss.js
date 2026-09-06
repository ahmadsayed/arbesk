"use strict";
const autoprefixer = require("autoprefixer");
const fs = require("fs");

const path = require("path");
const postcss = require("postcss");
const sass = require("sass");

const srcScssDir = path.resolve(__dirname, "../src/scss");
const stylesFile = path.join(srcScssDir, "styles.scss");
const destPath = path.resolve(__dirname, "../dist/css/styles.css");

module.exports = function renderSCSS() {
  if (!fs.existsSync(stylesFile)) {
    console.log("### INFO: No styles.scss found, skipping SCSS build");
    return;
  }

  const results = sass.renderSync({
    file: stylesFile,
    includePaths: [srcScssDir],
  });

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  postcss([autoprefixer])
    .process(results.css, { from: "styles.css", to: "styles.css" })
    .then((result) => {
      result.warnings().forEach((warn) => {
        console.warn(warn.toString());
      });
      fs.writeFileSync(destPath, result.css.toString());
    });
};

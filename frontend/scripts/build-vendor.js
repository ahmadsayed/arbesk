'use strict';
// Production step of `build`: vendor the @arbesk/* packages that pages outside
// app.js load through an import map (the CLI login page, #137). Strict, so a
// package that was not built fails the build instead of shipping a 404.
const { vendorPackages } = require('./vendor-packages');

try {
  vendorPackages({ strict: true });
} catch (err) {
  console.error(`### ERROR: ${/** @type {Error} */ (err).message}`);
  process.exit(1);
}

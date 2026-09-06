'use strict';
/**
 * Brotli pre-compression of built frontend assets. Emits a `.br` sibling for
 * every compressible file in dist/ over 1 KB. The backend serves these
 * directly (see src/index.ts) — zero per-request compression CPU, and brotli
 * beats the gzip the Express compression middleware would otherwise produce
 * on the fly. Runs under both Bun and Node (node:zlib).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const distRoot = path.resolve(__dirname, '../dist');
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json']);
const MIN_SIZE = 1024;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

let count = 0;
let saved = 0;
for (const file of walk(distRoot)) {
  if (!COMPRESSIBLE.has(path.extname(file))) continue;
  const input = fs.readFileSync(file);
  if (input.length < MIN_SIZE) continue;
  const compressed = zlib.brotliCompressSync(input, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  fs.writeFileSync(file + '.br', compressed);
  count++;
  saved += input.length - compressed.length;
}

console.log(
  `[COMPRESS] brotli: ${count} files, saved ${(saved / 1024 / 1024).toFixed(2)} MB uncompressed→compressed`
);

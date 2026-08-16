'use strict';
/**
 * Transpile-only TypeScript emit for the browser bundle.
 *
 * Import specifiers always match the on-disk file (`.ts` for converted
 * modules, `.js` for plain JS) — the same convention as the backend — so
 * Node type-stripping can execute shared sources directly. swc transpiles
 * each file independently (no program semantics), and this step then
 * rewrites relative `.ts` specifiers to `.js` in the emitted output so the
 * browser resolves the emitted files.
 */
const upath = require('upath');
const sh = require('shelljs');
const fs = require('fs');
const swc = require('@swc/core');

module.exports = async function renderTs() {
    const srcRoot = upath.resolve(upath.dirname(__filename), '../src/js');
    const destRoot = upath.resolve(upath.dirname(__filename), '../dist/js');

    const tsFiles = sh.find(srcRoot).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    if (tsFiles.length === 0) {
        console.log('### INFO: No .ts files in src/js, skipping TS emit');
        return;
    }

    for (const file of tsFiles) {
        const rel = upath.relative(srcRoot, file);
        const outFile = upath.join(destRoot, rel).replace(/\.ts$/, '.js');
        const result = await swc.transformFile(file, {
            jsc: {
                parser: { syntax: 'typescript' },
                target: 'es2022',
            },
            module: { type: 'es6' },
        });
        // Emitted files load in the browser: relative .ts specifiers must
        // point at the emitted .js files instead. Covers static `from`
        // imports, dynamic import(), and bare side-effect imports.
        const code = result.code.replace(
            /(from\s+['"]|import\s*\(\s*['"]|import\s+['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g,
            '$1$2.js$3'
        );
        sh.mkdir('-p', upath.dirname(outFile));
        fs.writeFileSync(outFile, code);
    }
    console.log(`### INFO: Emitted ${tsFiles.length} TS file(s) to dist/js`);

    // The verbatim copy step (render-scripts) copies .ts sources into dist;
    // drop them so only emitted .js is served.
    sh.find(destRoot)
        .filter((f) => f.endsWith('.ts'))
        .forEach((f) => sh.rm('-f', f));
};

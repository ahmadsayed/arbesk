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
const path = require('path');
const fs = require('fs');
const swc = require('@swc/core');

module.exports = async function renderTs() {
    const srcRoot = path.resolve(__dirname, '../src/js');
    const destRoot = path.resolve(__dirname, '../dist/js');

    const tsFiles = fs.readdirSync(srcRoot, { recursive: true })
        .map((f) => path.join(srcRoot, f))
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    if (tsFiles.length === 0) {
        console.log('### INFO: No .ts files in src/js, skipping TS emit');
        return;
    }

    for (const file of tsFiles) {
        const rel = path.relative(srcRoot, file);
        const outFile = path.join(destRoot, rel).replace(/\.ts$/, '.js');
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
        let code = result.code.replace(
            /(from\s+['"]|import\s*\(\s*['"]|import\s+['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g,
            '$1$2.js$3'
        );
        // Module workers do not inherit the page import map, so the glTF
        // worker's bare @arbesk/asset-core specifiers must resolve to the
        // vendored copy by relative path (mirrors ../vendor/gltf-transform-core).
        if (rel === 'workers/gltf-worker.ts') {
            code = code.replace(
                /(from\s+['"]|import\s*\(\s*['"])@arbesk\/asset-core\/([^'"]+)(['"])/g,
                '$1../vendor/asset-core/$2$3'
            );
        }
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, code);
    }
    console.log(`### INFO: Emitted ${tsFiles.length} TS file(s) to dist/js`);

    // The verbatim copy step (render-scripts) copies .ts sources into dist;
    // drop them so only emitted .js is served.
    fs.readdirSync(destRoot, { recursive: true })
        .map((f) => path.join(destRoot, f))
        .filter((f) => f.endsWith('.ts'))
        .forEach((f) => fs.rmSync(f, { force: true }));
};

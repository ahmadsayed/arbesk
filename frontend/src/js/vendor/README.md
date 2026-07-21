# Vendored browser bundles

These files are committed copies of third-party ESM bundles. They are vendored
(rather than loaded from a CDN at runtime) because the glTF Web Worker
(`frontend/src/js/workers/gltf-worker.js`) cannot use the page's import map —
Web Workers don't inherit it — so it needs a path that resolves the same way
on its own. Vendoring removes the runtime dependency on `esm.sh` for both the
worker and the main thread, and guarantees they load byte-identical code.

## gltf-transform-core-4.1.2.js

Source: `https://esm.sh/@gltf-transform/core@4.1.2/es2022/core.bundle.mjs`

Its only import (`Buffer` from `/node/buffer.mjs`) is vendored alongside it as
`node-buffer-polyfill.js`, with the import path rewritten to be relative.

### Refreshing to a new version

```bash
curl -sL "https://esm.sh/@gltf-transform/core@<version>/es2022/core.bundle.mjs" \
  -o frontend/src/js/vendor/gltf-transform-core-<version>.js
curl -sL "https://esm.sh/node/buffer.mjs" \
  -o frontend/src/js/vendor/node-buffer-polyfill.js
```

Then in the new `gltf-transform-core-<version>.js`, rewrite the first `import`
line to point at `./node-buffer-polyfill.js`, update the filename references in
`frontend/src/js/workers/gltf-worker.js` and the import map in
`frontend/src/pug/app.pug`, and bump `@gltf-transform/core` in
`frontend/package.json` to match.

## workerpool-10.0.2.js / workerpool-10.0.2.mjs

Source: `frontend/node_modules/workerpool/dist/workerpool.js` (copied from the
installed `workerpool` package, version pinned in `frontend/package.json`).

`workerpool-10.0.2.js` is the UMD browser bundle. `workerpool-10.0.2.mjs` is a
small ESM shim that loads the UMD and re-exports its API, because module Web
Workers cannot use import maps and need a relative ESM path.

### Refreshing to a new version

```bash
cd frontend
npm install workerpool@<version>
cp node_modules/workerpool/dist/workerpool.js src/js/vendor/workerpool-<version>.js
```

Then update the import in `frontend/src/js/workers/gltf-worker.js` and
`frontend/src/js/workers/gltf-worker-pool.js` if the filename changes, and bump
`workerpool` in `frontend/package.json` to match.

## ../events/mitt.mjs

Source: hand-inlined copy of `mitt` v3 (`https://github.com/developit/mitt`),
the ~200-byte event emitter. It lives at `frontend/src/js/events/mitt.mjs`
(next to `bus.js`, its only consumer) rather than in this directory because it
is used by the main-thread event bus, not by a Web Worker.

Vendored so the runtime does not depend on the npm `mitt` package; the package
is intentionally NOT a dependency of `frontend/package.json`. If it ever needs
refreshing, copy the `mitt(src).mjs` ESM source from the upstream repo and keep
the default-export shape (`on` / `off` / `emit` / wildcard `"*"`).

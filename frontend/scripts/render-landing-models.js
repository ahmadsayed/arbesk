'use strict';

/*
 * One-off landing-page asset renderer.
 *
 * Loads the low-poly mock glb assets in a headless Babylon scene, frames each,
 * applies amber rim lighting on a transparent background, and exports a WebP
 * straight from the canvas. Output lands in frontend/public/landing/ so the
 * normal build copies it into dist/.
 *
 * This is NOT part of `npm run build` — it is slow and needs Chromium. Run it
 * by hand only when the source meshes change:
 *
 *   node frontend/scripts/render-landing-models.js
 *
 * The heavy (13-24MB) source meshes are flattened to ~30KB images here, so
 * their file size never reaches the browser on the landing page.
 */

const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const MODELS_DIR = path.join(ROOT, 'mock-gltf-assets', 'low-poly');
const OUT_DIR = path.join(ROOT, 'frontend', 'public', 'landing');

// name -> source glb. `name` is the output WebP basename.
// Howdy is the hero/timeline mascot; all three appear in the "Built for teams"
// pedestal scene (Alice/Bob/You each editing a different asset).
const TARGETS = [
  { name: 'asset-howdy', file: 'howdyhighPoly_stamp.glb' },
  { name: 'asset-reema', file: 'reemalowPoly_stamp.glb' },
  { name: 'asset-suka', file: 'sukaLowPoly_stamp.glb' },
];

const SIZE = 900; // square render; CSS scales it down so it stays crisp on HiDPI

const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}#c{width:${SIZE}px;height:${SIZE}px;display:block}</style>
<script src="https://cdn.babylonjs.com/v9.12.0/babylon.js" crossorigin="anonymous"></script>
<script src="https://cdn.babylonjs.com/v9.12.0/loaders/babylonjs.loaders.min.js" crossorigin="anonymous"></script>
</head><body><canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
<script>
window.renderModel = async function (url) {
  const canvas = document.getElementById('c');
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, alpha: true, antialias: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // transparent

  const result = await BABYLON.SceneLoader.ImportMeshAsync('', url, '', scene);

  // Frame the whole import in an ArcRotateCamera at a pleasant 3/4 angle.
  let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  result.meshes.forEach(function (m) {
    if (!m.getTotalVertices || m.getTotalVertices() === 0) return;
    const b = m.getBoundingInfo().boundingBox;
    min = BABYLON.Vector3.Minimize(min, b.minimumWorld);
    max = BABYLON.Vector3.Maximize(max, b.maximumWorld);
  });
  const center = min.add(max).scale(0.5);
  const radius = max.subtract(min).length() / 2 || 1;

  const camera = new BABYLON.ArcRotateCamera('cam', Math.PI / 4, Math.PI / 2.6, radius * 2.95, center, scene);
  camera.fov = 0.5;

  // Key + amber rim + soft fill.
  const key = new BABYLON.HemisphericLight('key', new BABYLON.Vector3(0.3, 1, 0.2), scene);
  key.intensity = 0.95;
  const rim = new BABYLON.DirectionalLight('rim', new BABYLON.Vector3(-0.6, -0.2, 1), scene);
  rim.intensity = 1.4;
  rim.diffuse = new BABYLON.Color3(0.63, 0.47, 0.28); // amber #a07848
  const fill = new BABYLON.DirectionalLight('fill', new BABYLON.Vector3(0.5, -0.5, -0.5), scene);
  fill.intensity = 0.4;

  // Render several frames so the GPU settles before capture.
  for (let i = 0; i < 8; i++) { scene.render(); await new Promise(function (r){ requestAnimationFrame(r); }); }

  const data = canvas.toDataURL('image/webp', 0.92);
  engine.dispose();
  return data;
};
</script></body></html>`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Tiny static server so Chromium can fetch the glb + harness over http
  // (file:// cross-origin loads are blocked for Babylon's XHR).
  const server = http.createServer(function (req, res) {
    if (req.url === '/harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(HARNESS_HTML);
    }
    const file = path.join(MODELS_DIR, decodeURIComponent(req.url.replace(/^\//, '')));
    if (!file.startsWith(MODELS_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  page.on('console', function (m) { if (m.type() === 'error') console.error('  [page]', m.text()); });
  await page.goto(`${base}/harness.html`, { waitUntil: 'load' });

  for (const t of TARGETS) {
    process.stdout.write(`Rendering ${t.file} ... `);
    const dataUrl = await page.evaluate(function (url) { return window.renderModel(url); }, `${base}/${t.file}`);
    const b64 = dataUrl.replace(/^data:image\/webp;base64,/, '');
    const outPath = path.join(OUT_DIR, `${t.name}.webp`);
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`-> ${path.relative(ROOT, outPath)} (${kb} KB)`);
  }

  await browser.close();
  server.close();
}

main().catch(function (e) { console.error(e); process.exit(1); });

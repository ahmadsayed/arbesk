# GLB Parser Benchmark Results

Benchmark for issue #24: replace custom GLB parser with `@gltf-transform/core`; keep the custom serializer.

## Baseline — custom hand-written parser/serializer

Asset: `mock-gltf-assets/howdy.glb` (2,566,560 bytes), Draco-compressed, 13 nodes, 1 buffer, 2 images.

Run: 2026-06-17T15:32:16.194Z

- isGLB: 0.000 ms/op (avg over 1000 iterations, total 0.2 ms)
- parseGLB: 0.977 ms/op (avg over 100 iterations, total 97.7 ms)
- serializeGLB: 1.014 ms/op (avg over 100 iterations, total 101.4 ms)
- decomposeGLB (mock writer): 1.283 ms/op (avg over 20 iterations, total 25.7 ms)
- round-trip parse/serialize: 1.926 ms/op (avg over 100 iterations, total 192.6 ms)
- output byte length: 2566560 bytes

## After — `@gltf-transform/core` parser + custom serializer

### Small non-Draco asset: `mock-gltf-assets/triangle.glb`

648 bytes, 1 node, 1 buffer, 0 images.

Run: 2026-06-18T00:23:01.956Z

- triangle.glb — isGLB: 0.001 ms/op (avg over 1000 iterations, total 0.9 ms)
- triangle.glb — parseGLB: 0.013 ms/op (avg over 100 iterations, total 1.3 ms)
- triangle.glb — serializeGLB (custom): 0.009 ms/op (avg over 100 iterations, total 0.9 ms)
- triangle.glb — decomposeGLB (mock writer): 0.035 ms/op (avg over 20 iterations, total 0.7 ms)
- triangle.glb — round-trip parse/serialize: 0.016 ms/op (avg over 100 iterations, total 1.6 ms)
- triangle.glb — output byte length: 648 bytes

### Draco-compressed asset: `mock-gltf-assets/howdy.glb`

2,566,560 bytes, Draco-compressed, 13 nodes, 1 buffer, 2 images.

Run: 2026-06-18T00:23:01.956Z

- howdy.glb — isGLB: 0.001 ms/op (avg over 1000 iterations, total 0.9 ms)
- howdy.glb — parseGLB: 0.612 ms/op (avg over 100 iterations, total 61.2 ms)
- howdy.glb — serializeGLB (custom): 0.323 ms/op (avg over 100 iterations, total 32.3 ms)
- howdy.glb — decomposeGLB (mock writer): 1.000 ms/op (avg over 20 iterations, total 20.0 ms)
- howdy.glb — round-trip parse/serialize: 1.148 ms/op (avg over 100 iterations, total 114.8 ms)
- howdy.glb — output byte length: 2566560 bytes

### Large Draco asset: `mock-gltf-assets/suka.glb`

Converted from `suka.gltf` (50 MB embedded glTF) to GLB with `gltf-pipeline`. Result: 39,160,360 bytes, Draco-compressed.

Because the asset requires Draco, the serializer stays on the custom path. The parser uses `@gltf-transform/core`'s `binaryToJSON`.

Run: 2026-06-18T00:25:00.000Z (5 iterations each)

| Metric | Baseline (custom parser + custom serializer) | After (library parser + custom serializer) |
|---|---|---|
| `parseGLB` | ~21.40 ms/op | ~19.32 ms/op |
| `serializeGLB` | ~20.19 ms/op | ~18.74 ms/op |
| Round-trip | ~38.23 ms/op | ~37.09 ms/op |
| Output byte length | 39,160,360 bytes | 39,160,360 bytes |

## Notes

- `parseGLB` is backed by `@gltf-transform/core`'s `binaryToJSON`, which removes custom binary container parsing and handles edge cases (unknown chunks, validation, padding) more robustly.
- `serializeGLB` uses the fast custom serializer only. It does not decode/re-encode mesh data, so content-addressed CIDs stay stable.
- `source-color-editor.js` no longer re-serializes to GLB; it decomposes GLB sources into composite glTF, edits the JSON, and stores the composite glTF JSON.
- `serializeGLB` is kept as a utility for future GLB export/download.
- The custom serializer was corrected to write padded chunk lengths, matching the GLB spec and the library's container interpretation.
- `decomposeGLB` and `source-color-editor.js` callers were updated to `await` the now-async `parseGLB` and `serializeGLB`.

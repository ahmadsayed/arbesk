import { runBench } from "../../frontend/src/js/asset-core/bench/run.ts";

test("bench returns timing rows for the smallest fixture", async () => {
  const rows = await runBench({
    fixtures: ["mock-gltf-assets/triangle.glb"],
    iterations: 1,
  });
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.op).toMatch(/compose|decompose|base64|hash/);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  }
});

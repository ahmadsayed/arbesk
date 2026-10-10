import { describe, expect, it } from "bun:test";
import { bodiesOf, bridgeSource } from "../../scripts/lib/cadbench-bridge.mjs";
import { box } from "./helpers/bench-meshes.js";

/** Two boxes in one mesh, as a gear train's separate bodies arrive. */
function twoBoxes() {
  const a = box([2, 2, 2], [0, 0, 0]);
  const b = box([1, 1, 1], [10, 0, 0]);
  return {
    positions: Float32Array.from([...a.positions, ...b.positions]),
    indices: Uint32Array.from([...a.indices, ...[...b.indices].map((i) => i + 8)]),
  };
}

describe("bodiesOf", () => {
  it("splits a mesh into its connected bodies, each re-indexed from zero", () => {
    const bodies = bodiesOf(twoBoxes());
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b.positions.length / 3)).toEqual([8, 8]);
    expect(bodies.map((b) => b.indices.length / 3)).toEqual([12, 12]);
    expect(Math.max(...bodies[1].indices)).toBe(7);
    expect(bodies[1].positions[0]).toBe(10);
  });

  it("joins triangles that share a position even when their vertices are duplicated", () => {
    const soup = box([2, 2, 2]);
    const positions = [];
    for (const i of soup.indices) positions.push(soup.positions[i * 3], soup.positions[i * 3 + 1], soup.positions[i * 3 + 2]);
    const bodies = bodiesOf({ positions: Float32Array.from(positions), indices: Uint32Array.from(positions.map((_, i) => i).filter((i) => i < positions.length / 3)) });
    expect(bodies).toHaveLength(1);
  });
});

describe("bridgeSource", () => {
  const src = bridgeSource(twoBoxes(), { taskId: "cube_20mm_z_minus" });

  it("imports nothing CAD-bench's sandbox forbids", () => {
    const imports = [...src.matchAll(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm)].map((m) => (m[1] ?? m[2]).split(".")[0]);
    expect(imports.every((m) => ["build123d", "math", "numpy"].includes(m))).toBe(true);
  });

  it("embeds each body's vertices and triangles as plain number lists", () => {
    expect(src.match(/^BODIES = \[/m)).not.toBeNull();
    expect(src).toContain("[10.0, 0.0, 0.0");
    expect(src).not.toMatch(/base64|struct|OCP/);
  });

  it("leaves a top-level part and says where the geometry came from", () => {
    expect(src).toMatch(/^part = /m);
    expect(src).toContain("arbesk cad-gen");
    expect(src).toContain("cube_20mm_z_minus");
  });
});

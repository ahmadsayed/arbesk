import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CADBENCH_COMMIT, benchmarkScore, loadTasks, taskPrompt } from "../../scripts/lib/cadbench.mjs";

const INSTRUCTION = [
  "Create a spur gear.", "", "Requirements:", "- 16 teeth.", "- Axis is global Z.", "",
  "Submission contract", "",
  "Create `/workspace/final.py`. The file must run with Python 3.11 and Build123D 0.10.0, and it must leave the completed model in a top-level variable named `part`. The verifier evaluates that object directly.",
].join("\n");

describe("taskPrompt", () => {
  it("keeps the requirements and drops the Build123D submission contract", () => {
    const p = taskPrompt(INSTRUCTION);
    expect(p).toContain("- 16 teeth.");
    expect(p).not.toContain("Submission contract");
    expect(p).not.toContain("Build123D");
    expect(p.endsWith("Axis is global Z.")).toBe(true);
  });
});

describe("loadTasks", () => {
  it("reads every task's tier, weight, order and prompt, in benchmark order", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cadbench-"));
    for (const [id, difficulty, weight, order] of [["gear", "hard", 3, 12], ["cube", "easy", 1, 1]]) {
      const dir = path.join(root, "dataset", id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "instruction.md"), INSTRUCTION);
      fs.writeFileSync(path.join(dir, "task.toml"),
        `[metadata]\nbenchmark = "CAD-bench"\ndifficulty = "${difficulty}"\ndifficulty_weight = ${weight}.0\norder = ${order}\n`);
    }
    const tasks = loadTasks(root);
    expect(tasks.map((t) => t.id)).toEqual(["cube", "gear"]);
    expect(tasks[1]).toMatchObject({ difficulty: "hard", weight: 3, order: 12 });
    expect(tasks[1].prompt).not.toContain("Submission contract");
  });
});

describe("benchmarkScore", () => {
  it("weights tier means 1/2/3/4 and counts a missing reward as zero, like dataset/metric.py", () => {
    const rows = [
      { difficulty: "easy", score: 1 }, { difficulty: "easy", score: 1 },
      { difficulty: "medium", score: 0.5 }, { difficulty: "hard", score: 0.2 }, { difficulty: "hard", score: null },
      { difficulty: "insane", score: 1.4 },
    ];
    // tiers: easy 1, medium 0.5, hard 0.1, insane 1 (clamped) -> (1 + 1 + 0.3 + 4) / 10
    expect(benchmarkScore(rows)).toEqual({
      benchmark: (1 * 1 + 0.5 * 2 + 0.1 * 3 + 1 * 4) / 10,
      tiers: { easy: 1, medium: 0.5, hard: 0.1, insane: 1 },
    });
  });

  it("pins the CAD-bench commit", () => {
    expect(CADBENCH_COMMIT).toBe("f1084c3d345f859ba48a4bd9d5c95bccca7dcb46");
  });
});

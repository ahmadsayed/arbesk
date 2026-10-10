import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VERIFIER_IMAGE, gradeSubmission } from "../../scripts/lib/cadbench-grade.mjs";
import { regradeTask, runTask } from "../../scripts/lib/cadbench-task.mjs";
import { RenderTimeout } from "../../scripts/lib/kernel-worker.mjs";
import { box } from "./helpers/bench-meshes.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cbrun-"));

describe("gradeSubmission", () => {
  it("runs the pinned verifier offline on final.py and reads its rewards", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "final.py"), "part = None");
    const calls = [];
    const spawnImpl = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const logs = args[args.indexOf("-v", args.indexOf("-v") + 1) + 1].split(":")[0];
      fs.writeFileSync(path.join(logs, "reward.json"), JSON.stringify({ reward: 0.9, overall_score: 0.9, task_score: 0.9, build_success: 1 }));
      fs.writeFileSync(path.join(logs, "grading.json"), JSON.stringify({ raw: { teeth: 16 } }));
      return { status: 0, stderr: "" };
    };
    const r = await gradeSubmission({ taskId: "spur", dir, spawnImpl });
    expect(r).toMatchObject({ overall_score: 0.9, build_success: 1 });
    const argv = calls[0].join(" ");
    expect(argv).toContain("--network none");
    expect(argv).toContain("CAD_BENCH_TASK_ID=spur");
    expect(argv).toContain(VERIFIER_IMAGE);
  });

  it("reports a grader that wrote no rewards as a grade error, not a score", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "final.py"), "part = None");
    const r = await gradeSubmission({ taskId: "spur", dir, spawnImpl: async () => ({ status: 1, stderr: "boom" }) });
    expect(r.gradeError).toContain("boom");
    expect(r.overall_score).toBeUndefined();
  });
});

const TASK = { id: "cube_20mm_z_minus", difficulty: "easy", weight: 1, order: 1, prompt: "Create a 20 mm cube." };
const GOOD = { triangles: 12, vertices: 8, volumeMm3: 8000, bboxMm: { min: [0, 0, 0], max: [20, 20, 20] }, bodies: { count: 1, boxes: [] } };
const generator = (fail) => ({
  async generate() {
    if (fail) throw fail;
    return { design: { code: "return box(20,20,20)", parameters: {}, summary: "cube" },
      diagnostics: { selection: { jevTokens: { prompt: 0, completion: 0 } }, attempts: [], tokens: { prompt: 10, completion: 5 } } };
  },
});
const kernel = (outcome) => ({ run: async () => { if (outcome instanceof Error) throw outcome; return { mesh: box([20, 20, 20]), stats: outcome }; } });
const grade = async () => ({ reward: 1, overall_score: 1, task_score: 1, build_success: 1 });

describe("runTask", () => {
  it("bridges a built part, grades it and keeps the artifacts", async () => {
    const dir = tmp();
    const r = await runTask({ generator: generator(), kernel: kernel(GOOD), task: TASK, dir, grade });
    expect(r).toMatchObject({ id: TASK.id, difficulty: "easy", built: true, score: 1, buildSuccess: 1 });
    expect(fs.readFileSync(path.join(dir, TASK.id, "final.py"), "utf8")).toContain("part = ");
    expect(fs.existsSync(path.join(dir, TASK.id, "part.stl"))).toBe(true);
  });

  it("scores zero without grading when cad-gen delivers no part", async () => {
    let graded = false;
    const g = async () => { graded = true; return {}; };
    const timeout = await runTask({ generator: generator(), kernel: kernel(new RenderTimeout("build", 90000)), task: TASK, dir: tmp(), grade: g });
    expect(timeout).toMatchObject({ built: false, reason: "render_timeout", score: 0 });
    const provider = await runTask({ generator: generator(new Error("503")), kernel: kernel(GOOD), task: TASK, dir: tmp(), grade: g });
    expect(provider).toMatchObject({ built: false, reason: "provider_error", score: 0 });
    expect(graded).toBe(false);
  });

  it("keeps the score null when the grader itself failed", async () => {
    const r = await runTask({ generator: generator(), kernel: kernel(GOOD), task: TASK, dir: tmp(), grade: async () => ({ gradeError: "docker died" }) });
    expect(r).toMatchObject({ built: true, score: null, gradeError: "docker died" });
  });
});

describe("regradeTask", () => {
  it("re-bridges the saved part and grades it again, without generating", async () => {
    const dir = tmp();
    const first = await runTask({ generator: generator(), kernel: kernel(GOOD), task: TASK, dir, grade: async () => ({ overall_score: 0, build_success: 1, task_score: 1 }) });
    fs.writeFileSync(path.join(dir, TASK.id, "final.py"), "stale");
    const r = await regradeTask({ record: first, dir, grade });
    expect(r).toMatchObject({ id: TASK.id, built: true, score: 1, regraded: true });
    expect(fs.readFileSync(path.join(dir, TASK.id, "final.py"), "utf8")).toContain("part = ");
  });

  it("leaves a task that was never built untouched", async () => {
    const record = { id: "x", built: false, score: 0, reason: "gate:connected" };
    expect(await regradeTask({ record, dir: tmp(), grade })).toBe(record);
  });
});

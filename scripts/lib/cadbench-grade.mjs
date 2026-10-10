/**
 * Runs CAD-bench's verifier container on one final.py.
 * @remarks The verifier is CAD-bench's own image, run the way Harbor runs it:
 *   networking off, the submission read-only at /workspace/final.py, results
 *   in /logs/verifier. It is the pinned overlay (cadbench-verifier.Dockerfile)
 *   because the upstream image cannot import build123d any more. A grader that
 *   writes no rewards is a grade error - a harness failure, never a score.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The verifier image every grade runs in: upstream plus the ocp_gordon pin. */
export const VERIFIER_IMAGE = "arbesk/cad-bench-verifier:pinned";

/**
 * Spawns a command and collects its exit status and stderr.
 * @param {string} cmd @param {string[]} args
 * @returns {Promise<{ status: number | null, stderr: string }>}
 */
export function spawnCollect(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ status: null, stderr: e.message }));
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

/**
 * Grades dir/final.py for one task; the verifier's logs land in dir/logs.
 * @param {{ taskId: string, dir: string,
 *   spawnImpl?: (cmd: string, args: string[]) => Promise<{ status: number | null, stderr: string }> }} ctx
 * @returns {Promise<any>} reward.json's channels plus `grading` (the raw record),
 *   or { gradeError }.
 */
export async function gradeSubmission(ctx) {
  const logs = path.join(ctx.dir, "logs");
  fs.rmSync(logs, { recursive: true, force: true });
  fs.mkdirSync(logs, { recursive: true });
  const uid = typeof process.getuid === "function" ? process.getuid() + ":" + process.getgid?.() : "0:0";
  const args = [
    "run", "--rm", "--network", "none", "--user", uid, "-e", "HOME=/tmp",
    "-e", "CAD_BENCH_TASK_ID=" + ctx.taskId,
    "-v", path.resolve(ctx.dir, "final.py") + ":/workspace/final.py:ro",
    "-v", path.resolve(logs) + ":/logs/verifier",
    VERIFIER_IMAGE, "bash", "/tests/test.sh",
  ];
  const r = await (ctx.spawnImpl ?? spawnCollect)("docker", args);
  const rewardFile = path.join(logs, "reward.json");
  if (!fs.existsSync(rewardFile)) {
    return { gradeError: "verifier wrote no reward.json (exit " + r.status + "): " + r.stderr.slice(-400) };
  }
  const reward = JSON.parse(fs.readFileSync(rewardFile, "utf8"));
  const gradingFile = path.join(logs, "grading.json");
  const grading = fs.existsSync(gradingFile) ? JSON.parse(fs.readFileSync(gradingFile, "utf8")).raw ?? null : null;
  return { ...reward, grading };
}

/**
 * The task scripts (AGENTS.md, "Life of a task"): scripts/new-task.sh,
 * end-task.sh, session-start.sh and pr-screenshots.sh, run against a throwaway
 * repository with a bare "origin". `gh` and `docker` are fakes on PATH, so
 * nothing reaches GitHub or a container runtime.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPTS = path.resolve(import.meta.dirname, "..", "scripts");
const TASK_SCRIPTS = ["new-task.sh", "end-task.sh", "session-start.sh", "pr-screenshots.sh", "github.sh"];
const SLOW = 30_000;

/** Answers the REST calls of scripts/github.sh; FAKE_MERGED_PR is the merged PR, if any. */
const FAKE_GH = `#!/bin/sh
case "$*" in
  *"pulls?state=closed"*) [ -n "$FAKE_MERGED_PR" ] && echo "$FAKE_MERGED_PR" ;;
  *"pulls?state=open"*|*"issues?"*) ;;
  *) echo "owner/repo" ;;
esac
exit 0
`;

let sandbox;
let repo;
let env;

/** Runs a command; returns its exit status and output. */
function sh(cwd, cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
  return { status: result.status, out: result.stdout + result.stderr, stdout: result.stdout };
}

/** Runs git and fails the test when git fails. */
function git(cwd, ...args) {
  const result = sh(cwd, "git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.out}`);
  return result.stdout.trim();
}

function commitFile(cwd, file, content, message) {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
}

/** What GitHub does on a merge: a second clone merges the branch into main and pushes. */
function mergeOnOrigin(branch, { squash = false } = {}) {
  const other = path.join(sandbox, `other-${Date.now()}`);
  git(sandbox, "clone", "-q", path.join(sandbox, "origin.git"), other);
  if (squash) {
    git(other, "merge", "-q", "--squash", `origin/${branch}`);
    git(other, "commit", "-q", "-m", `squash ${branch}`);
  } else {
    git(other, "merge", "-q", "--no-ff", "-m", `merge ${branch}`, `origin/${branch}`);
  }
  git(other, "push", "-q", "origin", "main");
}

const worktree = (name) => path.join(repo, ".worktrees", name);
const script = (name, args, extraEnv, cwd = repo) =>
  sh(cwd, "bash", [path.join(repo, "scripts", name), ...args], extraEnv);
const newTask = (kind, name) => script("new-task.sh", [kind, name, "--light"]);

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "task-scripts-"));
  const bin = path.join(sandbox, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh\necho "$PWD|$*" >> "${path.join(sandbox, "docker.log")}"\nexit 0\n`, { mode: 0o755 });
  env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  git(sandbox, "init", "-q", "--bare", "-b", "main", "origin.git");
  repo = path.join(sandbox, "repo");
  git(sandbox, "clone", "-q", path.join(sandbox, "origin.git"), repo);
  git(repo, "checkout", "-q", "-b", "main");
  fs.mkdirSync(path.join(repo, "scripts"));
  for (const name of TASK_SCRIPTS) fs.copyFileSync(path.join(SCRIPTS, name), path.join(repo, "scripts", name));
  fs.writeFileSync(path.join(repo, ".gitignore"), ".worktrees/\nnode_modules\n.env\n");
  fs.writeFileSync(path.join(repo, "app.txt"), "v1\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "-u", "origin", "main");
});

afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test("new-task refuses an unknown kind or an unsafe name", () => {
  expect(script("new-task.sh", ["bugfix", "x"]).status).toBe(2);
  expect(script("new-task.sh", ["fix", "Has Space"]).status).toBe(2);
  expect(script("new-task.sh", ["fix"]).status).toBe(2);
  expect(fs.existsSync(path.join(repo, ".worktrees"))).toBe(false);
});

test("new-task branches from origin/main and leaves the main checkout's own work behind", () => {
  // origin/main moves ahead; the main checkout is behind and has an uncommitted edit.
  const other = path.join(sandbox, "ahead");
  git(sandbox, "clone", "-q", path.join(sandbox, "origin.git"), other);
  commitFile(other, "app.txt", "v2\n", "v2");
  git(other, "push", "-q", "origin", "main");
  fs.writeFileSync(path.join(repo, "app.txt"), "my unsaved work\n");

  const result = newTask("fix", "open-file");
  expect(result.out).toContain("fix/open-file");
  expect(result.status).toBe(0);
  const dir = worktree("open-file");
  expect(git(dir, "branch", "--show-current")).toBe("fix/open-file");
  expect(git(dir, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"));
  expect(fs.readFileSync(path.join(dir, "app.txt"), "utf8")).toBe("v2\n");
  expect(fs.readFileSync(path.join(repo, "app.txt"), "utf8")).toBe("my unsaved work\n");
}, SLOW);

test("new-task copies the env files and switches the worktree to Kubo", () => {
  fs.writeFileSync(path.join(repo, ".env"), "IPFS_BACKEND=pinata\nSECRET=1\n");
  fs.mkdirSync(path.join(repo, "node_modules"));
  expect(newTask("feat", "strip").status).toBe(0);
  const dir = worktree("strip");
  expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toBe("IPFS_BACKEND=kubo\nSECRET=1\n");
  expect(fs.readFileSync(path.join(repo, ".env"), "utf8")).toContain("IPFS_BACKEND=pinata");
  expect(fs.lstatSync(path.join(dir, "node_modules")).isSymbolicLink()).toBe(true);
  expect(git(dir, "status", "--porcelain")).toBe("");
}, SLOW);

test("new-task links workspace packages' node_modules, whatever directory it is run from", () => {
  fs.mkdirSync(path.join(repo, "packages", "core"), { recursive: true });
  commitFile(repo, "packages/core/index.js", "export {};\n", "package");
  git(repo, "push", "-q", "origin", "main");
  fs.mkdirSync(path.join(repo, "packages", "core", "node_modules"));

  const result = script("new-task.sh", ["feat", "pkg", "--light"], {}, path.join(repo, "scripts"));
  expect(result.status).toBe(0);
  const linked = path.join(worktree("pkg"), "packages", "core", "node_modules");
  expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
  expect(fs.realpathSync(linked)).toBe(fs.realpathSync(path.join(repo, "packages", "core", "node_modules")));
}, SLOW);

test("new-task builds the frontend and compiles the contracts inside the new worktree", () => {
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ scripts: { "build:frontend": "touch built.marker" } }));
  fs.writeFileSync(path.join(repo, "scripts", "start-dev.sh"), "#!/bin/sh\necho proj-x\n", { mode: 0o755 });
  fs.appendFileSync(path.join(repo, ".gitignore"), "built.marker\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "build setup");
  git(repo, "push", "-q", "origin", "main");

  const result = script("new-task.sh", ["feat", "full"]);
  expect(result.out).toContain("Compose:       proj-x");
  expect(result.status).toBe(0);
  const dir = worktree("full");
  expect(fs.existsSync(path.join(dir, "built.marker"))).toBe(true);
  expect(fs.existsSync(path.join(repo, "built.marker"))).toBe(false);
  expect(fs.readFileSync(path.join(sandbox, "docker.log"), "utf8").trim()).toBe(
    `${dir}|compose -p proj-x run --rm hardhat npx hardhat compile`
  );
}, SLOW);

test("new-task refuses a name that is already taken", () => {
  expect(newTask("fix", "dup").status).toBe(0);
  expect(newTask("fix", "dup").status).toBe(1);
}, SLOW);

test("end-task refuses while the worktree has uncommitted changes", () => {
  newTask("fix", "wip");
  fs.writeFileSync(path.join(worktree("wip"), "app.txt"), "half done\n");
  const result = script("end-task.sh", ["wip"]);
  expect(result.status).toBe(1);
  expect(result.out).toContain("uncommitted changes");
  expect(fs.existsSync(worktree("wip"))).toBe(true);
}, SLOW);

test("end-task refuses commits that are neither on origin/main nor in a merged PR", () => {
  newTask("fix", "unmerged");
  commitFile(worktree("unmerged"), "app.txt", "fix\n", "fix");
  const result = script("end-task.sh", ["unmerged"]);
  expect(result.status).toBe(1);
  expect(result.out).toContain("not on origin/main");
  expect(git(repo, "branch", "--list", "fix/unmerged")).toContain("fix/unmerged");
  expect(fs.existsSync(worktree("unmerged"))).toBe(true);
}, SLOW);

test("end-task refuses to run from inside the worktree it would delete", () => {
  newTask("fix", "inside");
  const result = script("end-task.sh", ["inside"], {}, worktree("inside"));
  expect(result.status).toBe(1);
  expect(fs.existsSync(worktree("inside"))).toBe(true);
}, SLOW);

test("end-task removes a merged task everywhere and fast-forwards a clean main", () => {
  newTask("fix", "done");
  const dir = worktree("done");
  commitFile(dir, "app.txt", "fixed\n", "fix");
  git(dir, "push", "-q", "-u", "origin", "fix/done");
  mergeOnOrigin("fix/done");

  const result = script("end-task.sh", ["done"]);
  expect(result.out).toContain("Removed");
  expect(result.status).toBe(0);
  expect(fs.existsSync(dir)).toBe(false);
  expect(git(repo, "branch", "--list", "fix/done")).toBe("");
  expect(git(repo, "ls-remote", "--heads", "origin", "fix/done")).toBe("");
  expect(fs.readFileSync(path.join(repo, "app.txt"), "utf8")).toBe("fixed\n");
}, SLOW);

test("end-task leaves a main checkout with the human's changes alone", () => {
  newTask("fix", "busy");
  const dir = worktree("busy");
  commitFile(dir, "new.txt", "x\n", "add");
  git(dir, "push", "-q", "-u", "origin", "fix/busy");
  mergeOnOrigin("fix/busy");
  fs.writeFileSync(path.join(repo, "app.txt"), "my unsaved work\n");

  const result = script("end-task.sh", ["busy"]);
  expect(result.status).toBe(0);
  expect(result.out).toContain("Left the main checkout alone");
  expect(fs.readFileSync(path.join(repo, "app.txt"), "utf8")).toBe("my unsaved work\n");
  expect(fs.existsSync(path.join(repo, "new.txt"))).toBe(false);
}, SLOW);

test("end-task accepts a squash merge only when GitHub reports the merged PR", () => {
  newTask("feat", "squashed");
  const dir = worktree("squashed");
  commitFile(dir, "a.txt", "a\n", "one");
  commitFile(dir, "b.txt", "b\n", "two");
  git(dir, "push", "-q", "-u", "origin", "feat/squashed");
  mergeOnOrigin("feat/squashed", { squash: true });

  expect(script("end-task.sh", ["squashed"]).status).toBe(1);
  const result = script("end-task.sh", ["squashed"], { FAKE_MERGED_PR: "42" });
  expect(result.out).toContain("PR #42");
  expect(result.status).toBe(0);
  expect(fs.existsSync(dir)).toBe(false);
}, SLOW);

test("session-start says which worktrees are merged and which still hold work", () => {
  newTask("fix", "landed");
  commitFile(worktree("landed"), "l.txt", "l\n", "landed");
  git(worktree("landed"), "push", "-q", "-u", "origin", "fix/landed");
  mergeOnOrigin("fix/landed");
  newTask("feat", "open");
  commitFile(worktree("open"), "o.txt", "o\n", "open");

  const result = script("session-start.sh", []);
  expect(result.status).toBe(0);
  expect(result.out).toContain("main: 0 ahead, 2 behind origin/main");
  expect(result.out).toMatch(/\.worktrees\/landed \(fix\/landed\): merged: finalize with scripts\/end-task\.sh landed/);
  expect(result.out).toMatch(/\.worktrees\/open \(feat\/open\): 1 commit\(s\) not on origin\/main, 0 uncommitted/);
}, SLOW);

test("pr-screenshots stores images on the captures branch and prints the Markdown", () => {
  newTask("feat", "shots");
  const dir = worktree("shots");
  fs.writeFileSync(path.join(sandbox, "before.png"), "png-1");
  fs.writeFileSync(path.join(sandbox, "after shot.png"), "png-2");

  const first = script("pr-screenshots.sh", [path.join(sandbox, "before.png")], {}, dir);
  expect(first.status).toBe(0);
  expect(first.stdout.trim()).toBe("![before](https://github.com/owner/repo/raw/captures/feat-shots/before.png)");
  const second = script("pr-screenshots.sh", [path.join(sandbox, "after shot.png")], {}, dir);
  expect(second.stdout.trim()).toBe("![after-shot](https://github.com/owner/repo/raw/captures/feat-shots/after-shot.png)");

  git(repo, "fetch", "-q", "origin", "captures");
  expect(git(repo, "ls-tree", "-r", "--name-only", "FETCH_HEAD").split("\n").sort()).toEqual([
    "feat-shots/after-shot.png",
    "feat-shots/before.png",
  ]);
  expect(git(dir, "status", "--porcelain")).toBe("");
}, SLOW);

test("pr-screenshots refuses on main and refuses files that are not images", () => {
  fs.writeFileSync(path.join(sandbox, "a.png"), "x");
  expect(script("pr-screenshots.sh", [path.join(sandbox, "a.png")]).status).toBe(1);
  newTask("feat", "notimage");
  expect(script("pr-screenshots.sh", [path.join(repo, "app.txt")], {}, worktree("notimage")).status).toBe(1);
}, SLOW);

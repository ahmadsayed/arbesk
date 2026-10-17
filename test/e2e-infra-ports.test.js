/**
 * E2E stack ports (e2e/lib/infra.mjs portsForWorker): the main checkout keeps
 * the stock service ports, while a linked worktree gets its own block for
 * every service so its stacks never collide with the main checkout's (or a
 * running dev server's) containers. infra.mjs derives everything from
 * process.cwd(), so each case imports it in a subprocess rooted in a fake
 * checkout: `.git` as a directory (main) or a file (linked worktree).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const INFRA = url.pathToFileURL(
  path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../e2e/lib/infra.mjs"),
).href;
const tmpRoots = [];

function checkout(kind, name = "co") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `arbesk-ports-${name}-`));
  tmpRoots.push(root);
  if (kind === "main") fs.mkdirSync(path.join(root, ".git"));
  else fs.writeFileSync(path.join(root, ".git"), "gitdir: /elsewhere\n");
  return root;
}

function ports(root, workers = [0, 1, 2, 3]) {
  const script = `import(${JSON.stringify(INFRA)}).then((m) => console.log(JSON.stringify(${JSON.stringify(workers)}.map(m.portsForWorker))))`;
  return JSON.parse(execFileSync("bun", ["-e", script], { cwd: root, encoding: "utf8" }));
}

/** Every host port a worker's stack publishes or listens on. */
const hostPorts = (p) => [p.backendPort, p.hardhatPort, p.ipfsApiPort, p.ipfsGatewayPort, p.nostrPort];

afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe("portsForWorker", () => {
  test("the main checkout keeps the stock ports, offset per worker", () => {
    const [w0, w2] = ports(checkout("main"), [0, 2]);
    expect(hostPorts(w0)).toEqual([9090, 8545, 5001, 8080, 7777]);
    expect(hostPorts(w2)).toEqual([9092, 8547, 5003, 8082, 7779]);
    expect(w0.hardhatRpc).toBe("http://127.0.0.1:8545");
    expect(w0.nostrUrl).toBe("ws://127.0.0.1:7777");
  });

  test("a linked worktree shares no host port with the main checkout", () => {
    const main = ports(checkout("main")).flatMap(hostPorts);
    const worktree = ports(checkout("worktree")).flatMap(hostPorts);
    expect(worktree.filter((p) => main.includes(p))).toEqual([]);
    // ...and none of its own ports repeat across services or workers.
    expect(new Set(worktree).size).toBe(worktree.length);
  });

  test("worktree ports are stable for the same path and URLs match the ports", () => {
    const root = checkout("worktree", "stable");
    const [a] = ports(root, [1]);
    const [b] = ports(root, [1]);
    expect(a).toEqual(b);
    expect(a.hardhatRpc).toBe(`http://127.0.0.1:${a.hardhatPort}`);
    expect(a.ipfsApiUrl).toBe(`http://127.0.0.1:${a.ipfsApiPort}`);
    expect(a.ipfsGatewayUrl).toBe(`http://127.0.0.1:${a.ipfsGatewayPort}`);
    expect(a.nostrUrl).toBe(`ws://127.0.0.1:${a.nostrPort}`);
  });
});

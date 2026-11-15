// @ts-nocheck — TODO: type properly (implicit any in helpers); scripts/ pattern
// One-command deploy to the promptscad.com k3s cluster:
//   bun run deploy:k3s
//
// Every run picks up the LATEST local configuration and code — no staleness
// checks, everything is regenerated and copied fresh:
//   1. bun scripts/make-env-k3s.mjs  → .env.k3s from current .env files
//   2. recreate the arbesk-env secret on the cluster from .env.k3s
//   3. buildx arm64 build + push ahmadsayed/arbesk:<MMDDHHMM>
//   4. apply all deploy/k8s manifests (order: storage, backup, nostr, service,
//      ingress, deployment, gc) with the new tag stamped into the copies of
//      deployment.yaml and gc.yaml that are sent — no tracked file changes —
//      and wait for the rollout
//   5. purge the Cloudflare cache (needs CLOUDFLARE_API_TOKEN and
//      CLOUDFLARE_ZONE_ID in the environment or the root .env; without them
//      the step is skipped with a warning)
//   6. smoke-check the CLI login page
//   7. confirm Cloudflare serves this build of /js/app.js and /css/styles.css
//
// Run it from the main checkout once it matches origin/main (AGENTS.md,
// "Life of a task"). Override the SSH target with K3S_SSH=user@host (default
// adam@192.168.68.60).

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  purgeCloudflareCache,
  readCloudflareCredentials,
  staleAssets,
} from "./lib/cloudflare-cache.mjs";
import { stampImage } from "./lib/k8s-image.mjs";

const root = path.resolve(import.meta.dirname, "..");
const SSH = process.env.K3S_SSH || "adam@192.168.68.60";
const IMAGE = "ahmadsayed/arbesk";
const TAG = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12); // MMDDHHMM
const MANIFEST_ORDER = ["storage", "backup", "nostr", "service", "ingress", "deployment", "gc"];
/** Manifests that run the app image; the copy that is applied gets the new tag. */
const IMAGE_MANIFESTS = ["deployment", "gc"];
/** Unversioned files every page loads; checked against the edge after a deploy. */
const EDGE_PATHS = ["/js/app.js", "/css/styles.css"];

const log = (msg) => console.log(`[DEPLOY] ${msg}`);
const run = (cmd, args, opts = {}) => {
  log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
};
const kubectl = (remote) =>
  execSync(`ssh ${SSH} "sudo -n k3s kubectl ${remote}"`, { cwd: root, stdio: "inherit" });

// Read and stamp every manifest before anything is built or sent, so a
// manifest problem stops the deploy at once. The app manifests carry a
// placeholder tag; the stamped copies are never written back.
const MANIFESTS = MANIFEST_ORDER.map((name) => {
  const yaml = fs.readFileSync(path.join(root, `deploy/k8s/${name}.yaml`), "utf8");
  return { name, yaml: IMAGE_MANIFESTS.includes(name) ? stampImage(yaml, IMAGE, TAG) : yaml };
});

// 1. Regenerate .env.k3s from the current local .env / blockchain/.env
run("bun", ["scripts/make-env-k3s.mjs"]);

// 2. Recreate the secret BEFORE the rollout, so new pods mount fresh env.
log("recreating secret arbesk-env");
execSync(
  `ssh ${SSH} "sudo -n k3s kubectl delete secret arbesk-env --ignore-not-found && ` +
    `sudo -n k3s kubectl create secret generic arbesk-env --from-file=.env=/dev/stdin" < .env.k3s`,
  { cwd: root, stdio: "inherit", shell: "/bin/bash" }
);

// 3. Build + push the arm64 image. File timestamps are clamped to a fixed
// epoch so a layer whose content did not change (mock fixtures, ABIs, the
// server binary when only the frontend changed) keeps its digest and the Pi
// skips re-pulling it. Fresh checkout/build mtimes otherwise change every
// layer's digest on every deploy.
// Podman (or the podman-docker shim) builds natively: the builder stage runs
// on $BUILDPLATFORM and the arm64 stage has no RUN, so no qemu is needed.
const usePodman = /podman/i.test(execSync("docker --version 2>&1 || podman --version", { encoding: "utf8" }));
if (usePodman) {
  run("podman", [
    "build",
    "--platform", "linux/arm64",
    "-f", "docker/app.Dockerfile",
    "--source-date-epoch", "0", "--rewrite-timestamp",
    "-t", `docker.io/${IMAGE}:${TAG}`,
    ".",
  ]);
  run("podman", ["push", `docker.io/${IMAGE}:${TAG}`]);
} else {
  run("docker", [
    "buildx", "build", "--builder", "multiplatform-builder",
    "--platform", "linux/arm64",
    "-f", "docker/app.Dockerfile",
    "--build-arg", "SOURCE_DATE_EPOCH=0",
    "--output", `type=registry,name=${IMAGE}:${TAG},rewrite-timestamp=true`,
    ".",
  ]);
}

// 4. Apply manifests (each goes to kubectl on stdin), then wait for the rollout
for (const { name, yaml } of MANIFESTS) {
  if (IMAGE_MANIFESTS.includes(name)) log(`${name}.yaml → ${IMAGE}:${TAG}`);
  execSync(`ssh ${SSH} "sudo -n k3s kubectl apply -f -"`, {
    cwd: root,
    input: yaml,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
kubectl("rollout status deploy/arbesk --timeout=180s");
kubectl("rollout status deploy/nostr --timeout=60s");

// 5. Purge the Cloudflare cache. Static files have unversioned URLs and the
// edge keeps each for 4 hours, so without this the site serves the previous
// build (or new CSS next to old JS) long after the rollout. The credentials
// stay local: make-env-k3s.mjs copies an allowlist, so they never reach the
// cluster secret.
const origin = readPublicOrigin();
const cloudflare = readCloudflareCredentials(process.env, readRootEnv());
if (cloudflare) {
  await purgeCloudflareCache(cloudflare);
  log("Cloudflare cache purged");
} else {
  log("WARNING: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set — Cloudflare cache NOT purged");
}

// 6. Smoke-check what the app bundle does not cover: the CLI login page and
// the @arbesk/wallet module it loads from /js/vendor/ (#137). The query
// string keeps Cloudflare from answering with a cached 404.
const SMOKE_PATHS = ["/api/v1/cli-auth", "/js/vendor/wallet/facade.js"];
for (const p of SMOKE_PATHS) await expectOk(`${origin}${p}?deploy=${TAG}`);

// 7. Confirm visitors get this build. After a purge a stale file is a failure;
// without one it is expected, so it is only reported.
const stale = await staleAfterPurge(cloudflare ? 5 : 1);
if (stale.length && cloudflare) {
  throw new Error(`rollout succeeded, but Cloudflare still serves a previous build of ${stale.join(", ")}`);
}
if (stale.length) {
  log(`WARNING: Cloudflare still serves a previous build of ${stale.join(", ")} (for up to 4 hours)`);
} else {
  log(`edge OK — Cloudflare serves this build of ${EDGE_PATHS.join(", ")}`);
}

log(`done — ${origin} running ${IMAGE}:${TAG}`);

/** Root .env text, or "" when there is none. */
function readRootEnv() {
  const file = path.join(root, ".env");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** Stale EDGE_PATHS, re-checked a few times while the purge spreads. */
async function staleAfterPurge(attempts) {
  let stale = [];
  for (let i = 1; i <= attempts; i++) {
    stale = await staleAssets(origin, EDGE_PATHS, TAG);
    if (stale.length === 0 || i === attempts) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return stale;
}

/** PUBLIC_ORIGIN from the .env.k3s written in step 1. */
function readPublicOrigin() {
  const env = fs.readFileSync(path.join(root, ".env.k3s"), "utf8");
  const value = env.match(/^PUBLIC_ORIGIN=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  return (value || "https://promptscad.com").replace(/\/$/, "");
}

/** GETs `url` until it answers 200; throws after a few attempts. */
async function expectOk(url, attempts = 5) {
  let last = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      await res.arrayBuffer();
      if (res.ok) {
        log(`smoke OK ${res.status} ${url}`);
        return;
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`smoke check failed: GET ${url} → ${last}`);
}

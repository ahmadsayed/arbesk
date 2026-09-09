// @ts-nocheck — TODO: type properly (implicit any in helpers); scripts/ pattern
// One-command deploy to the promptscad.com k3s cluster:
//   bun run deploy:k3s
//
// Every run picks up the LATEST local configuration and code — no staleness
// checks, everything is regenerated and copied fresh:
//   1. node scripts/make-env-k3s.mjs  → .env.k3s from current .env files
//   2. recreate the arbesk-env secret on the cluster from .env.k3s
//   3. buildx arm64 build + push ahmadsayed/arbesk:<MMDDHHMM>
//   4. stamp the new tag into deploy/k8s/deployment.yaml
//   5. apply all deploy/k8s manifests (order: storage, nostr, service,
//      ingress, deployment) and wait for the rollout
//
// Override the SSH target with K3S_SSH=user@host (default adam@192.168.68.60).

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SSH = process.env.K3S_SSH || "adam@192.168.68.60";
const IMAGE = "ahmadsayed/arbesk";
const TAG = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12); // MMDDHHMM
const MANIFEST_ORDER = ["storage", "nostr", "service", "ingress", "deployment"];

const log = (msg) => console.log(`[DEPLOY] ${msg}`);
const run = (cmd, args, opts = {}) => {
  log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
};
const kubectl = (remote) =>
  execSync(`ssh ${SSH} "sudo -n k3s kubectl ${remote}"`, { cwd: root, stdio: "inherit" });

// 1. Regenerate .env.k3s from the current local .env / blockchain/.env
run("node", ["scripts/make-env-k3s.mjs"]);

// 2. Recreate the secret BEFORE the rollout, so new pods mount fresh env.
log("recreating secret arbesk-env");
execSync(
  `ssh ${SSH} "sudo -n k3s kubectl delete secret arbesk-env --ignore-not-found && ` +
    `sudo -n k3s kubectl create secret generic arbesk-env --from-file=.env=/dev/stdin" < .env.k3s`,
  { cwd: root, stdio: "inherit", shell: "/bin/bash" }
);

// 3. Build + push the arm64 image
run("docker", [
  "buildx", "build", "--builder", "multiplatform-builder",
  "--platform", "linux/arm64",
  "-f", "docker/app.Dockerfile",
  "-t", `${IMAGE}:${TAG}`, "--push", ".",
]);

// 4. Stamp the tag into the deployment manifest
const deployFile = path.join(root, "deploy/k8s/deployment.yaml");
const yaml = fs.readFileSync(deployFile, "utf8");
const stamped = yaml.replace(/image: ahmadsayed\/arbesk:\S+/, `image: ${IMAGE}:${TAG}`);
if (stamped === yaml) throw new Error("image tag not found in deploy/k8s/deployment.yaml");
fs.writeFileSync(deployFile, stamped);
log(`deployment.yaml → ${IMAGE}:${TAG}`);

// 5. Apply manifests, then wait for the rollout
for (const f of MANIFEST_ORDER) {
  execSync(`ssh ${SSH} "sudo -n k3s kubectl apply -f -" < deploy/k8s/${f}.yaml`, {
    cwd: root, stdio: "inherit", shell: "/bin/bash",
  });
}
kubectl("rollout status deploy/arbesk --timeout=180s");
kubectl("rollout status deploy/nostr --timeout=60s");

log(`done — https://promptscad.com running ${IMAGE}:${TAG}`);

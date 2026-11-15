/**
 * Image-tag stamping used by scripts/deploy-k3s.mjs. The manifests in
 * deploy/k8s/ carry a placeholder tag; the deploy stamps a copy in memory, so
 * a deploy changes no tracked file.
 */

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { IMAGE_PLACEHOLDER_TAG, stampImage } from "../scripts/lib/k8s-image.mjs";

const IMAGE = "ahmadsayed/arbesk";
const K8S = path.resolve(import.meta.dirname, "..", "deploy", "k8s");

test("stamps the tag over the placeholder", () => {
  const yaml = `    - name: arbesk\n      image: ${IMAGE}:REPLACE_TAG\n      imagePullPolicy: IfNotPresent\n`;
  expect(stampImage(yaml, IMAGE, "11151333")).toBe(
    `    - name: arbesk\n      image: ${IMAGE}:11151333\n      imagePullPolicy: IfNotPresent\n`
  );
});

test("stamps every use of the image and leaves other images alone", () => {
  const yaml = `image: ${IMAGE}:01010101\nimage: busybox:1.37\nimage: ${IMAGE}:REPLACE_TAG\n`;
  expect(stampImage(yaml, IMAGE, "t2")).toBe(`image: ${IMAGE}:t2\nimage: busybox:1.37\nimage: ${IMAGE}:t2\n`);
});

test("does not touch an image whose name only starts the same", () => {
  const yaml = `image: ${IMAGE}-relay:1\nimage: ${IMAGE}:REPLACE_TAG\n`;
  expect(stampImage(yaml, IMAGE, "t3")).toBe(`image: ${IMAGE}-relay:1\nimage: ${IMAGE}:t3\n`);
});

test("fails when the manifest does not use the image", () => {
  expect(() => stampImage("image: busybox:1.37\n", IMAGE, "t4")).toThrow(/ahmadsayed\/arbesk/);
});

test("the tracked app manifests carry the placeholder, not a deployed tag", () => {
  for (const name of ["deployment", "gc"]) {
    const yaml = fs.readFileSync(path.join(K8S, `${name}.yaml`), "utf8");
    expect(yaml).toContain(`image: ${IMAGE}:${IMAGE_PLACEHOLDER_TAG}`);
    expect(stampImage(yaml, IMAGE, "12312359")).toContain(`image: ${IMAGE}:12312359`);
  }
});

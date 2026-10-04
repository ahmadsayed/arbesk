/**
 * Style guards for the Arbesk design language (roadmap 2026-10-04):
 * flat surfaces, sentence-case headings, one mono stack via --font-mono.
 */
import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIR = path.resolve(__dirname, "../../frontend/src/scss/components");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".scss"));

/** @param {RegExp} re */
function offenders(re) {
  return files.flatMap((f) =>
    fs.readFileSync(path.join(DIR, f), "utf-8").split("\n")
      .map((l, i) => ({ l: l.replace(/\/\/.*$/, ""), n: i + 1 }))
      .filter(({ l }) => re.test(l))
      .map(({ l, n }) => `${f}:${n}: ${l.trim()}`),
  );
}

describe("style guards", () => {
  test("no gradient chrome tokens", () => {
    expect(offenders(/var\(--gradient-/)).toEqual([]);
  });
  test("no uppercase headings", () => {
    expect(offenders(/text-transform:\s*uppercase/)).toEqual([]);
  });
  test("no hand-written monospace stacks (use var(--font-mono))", () => {
    expect(offenders(/font-family:[^;]*(SFMono|ui-monospace|Menlo|Consolas)/)).toEqual([]);
  });
});

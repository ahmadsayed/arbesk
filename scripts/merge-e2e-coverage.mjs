// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = libCoverage;
import { writeCoverageReports } from "./write-coverage-reports.mjs";

const TMP_DIR = path.resolve("coverage/tmp/e2e");
const OUT_DIR = path.resolve("coverage/e2e");

function readCoverageFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

function mergeTmpCoverage() {
  const map = createCoverageMap();
  const files = readCoverageFiles(TMP_DIR);
  if (files.length === 0) {
    console.log("[MERGE] no E2E coverage fragments found in", TMP_DIR);
    return map;
  }
  for (const file of files) {
    const data = JSON.parse(
      fs.readFileSync(path.join(TMP_DIR, file), "utf8"),
    );
    map.merge(data);
  }
  console.log(`[MERGE] merged ${files.length} E2E fragment(s)`);
  return map;
}

const coverageMap = mergeTmpCoverage();
writeCoverageReports(coverageMap, OUT_DIR);

// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = libCoverage;
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

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

function writeReports(map) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "coverage-final.json"),
    JSON.stringify(map.toJSON(), null, 2),
  );
  const context = libReport.createContext({
    dir: OUT_DIR,
    coverageMap: map,
  });
  reports.create("html").execute(context);
  reports.create("text").execute(context);
  reports.create("text-summary").execute(context);
}

const coverageMap = mergeTmpCoverage();
writeReports(coverageMap);

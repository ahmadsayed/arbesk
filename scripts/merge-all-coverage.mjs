// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = libCoverage;
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const OUT_DIR = path.resolve("coverage/merged");

function loadFinal(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

const map = createCoverageMap();
map.merge(loadFinal(path.resolve("coverage/js/coverage-final.json")));
map.merge(loadFinal(path.resolve("coverage/e2e/coverage-final.json")));

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

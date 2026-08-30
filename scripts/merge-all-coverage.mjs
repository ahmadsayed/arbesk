// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = libCoverage;
import { writeCoverageReports } from "./write-coverage-reports.mjs";

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

writeCoverageReports(map, OUT_DIR);

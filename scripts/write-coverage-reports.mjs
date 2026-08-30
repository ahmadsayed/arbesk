// @ts-nocheck
// Shared coverage report writer for the merge scripts (unit + e2e).
import fs from "node:fs";
import path from "node:path";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

export function writeCoverageReports(map, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "coverage-final.json"),
    JSON.stringify(map.toJSON(), null, 2),
  );
  const context = libReport.createContext({
    dir: outDir,
    coverageMap: map,
  });
  reports.create("html").execute(context);
  reports.create("text").execute(context);
  reports.create("text-summary").execute(context);
}

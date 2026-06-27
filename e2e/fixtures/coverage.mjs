// @ts-nocheck
import { test as base, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import v8ToIstanbul from "v8-to-istanbul";
import libCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = libCoverage;
import { sourcePathFromUrl } from "../lib/coverage.mjs";

const E2E_COVERAGE = process.env.E2E_COVERAGE === "1";
const COVERAGE_TMP_DIR = path.resolve("coverage/tmp/e2e");

function sanitizeFileName(name) {
  return name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
}

async function convertEntriesToCoverageMap(entries) {
  const map = createCoverageMap();
  for (const entry of entries) {
    const sourcePath = sourcePathFromUrl(entry.url);
    if (!sourcePath || !fs.existsSync(sourcePath)) continue;
    try {
      const converter = v8ToIstanbul(sourcePath);
      await converter.load();
      converter.applyCoverage(entry.functions);
      map.merge(converter.toIstanbul());
    } catch (err) {
      console.error(
        `[E2E COV] failed to convert ${entry.url}: ${err.message}`,
      );
    }
  }
  return map;
}

export const test = base.extend({
  _coverageTracker: [
    async ({ browser }, use, testInfo) => {
      const tracker = { entries: [], pages: new Set(), wrapPage: () => {} };

      function wrapPage(page) {
        if (!E2E_COVERAGE || page.__e2eCoverageWrapped) return;
        page.__e2eCoverageWrapped = true;
        tracker.pages.add(page);
        const originalClose = page.close.bind(page);
        page.close = async (...args) => {
          if (!page.__e2eCoverageStopped) {
            page.__e2eCoverageStopped = true;
            try {
              const entries = await page.coverage.stopJSCoverage();
              tracker.entries.push(...entries);
            } catch {
              // page may already be closed
            }
          }
          return originalClose(...args);
        };
      }
      tracker.wrapPage = wrapPage;

      const originalNewPage = browser.newPage.bind(browser);
      browser.newPage = async (...args) => {
        const page = await originalNewPage(...args);
        if (E2E_COVERAGE) {
          await page.coverage.startJSCoverage({ resetOnNavigation: false });
          wrapPage(page);
        }
        return page;
      };

      await use(tracker);

      browser.newPage = originalNewPage;

      if (!E2E_COVERAGE) return;

      for (const page of tracker.pages) {
        if (!page.__e2eCoverageStopped) {
          page.__e2eCoverageStopped = true;
          try {
            const entries = await page.coverage.stopJSCoverage();
            tracker.entries.push(...entries);
          } catch {
            // already closed
          }
        }
      }

      if (tracker.entries.length === 0) return;

      const coverageMap = await convertEntriesToCoverageMap(tracker.entries);
      const fileName =
        [
          sanitizeFileName(path.basename(testInfo.file)),
          sanitizeFileName(testInfo.title),
          testInfo.workerIndex,
        ].join("_") + ".json";
      fs.mkdirSync(COVERAGE_TMP_DIR, { recursive: true });
      const outPath = path.join(COVERAGE_TMP_DIR, fileName);
      fs.writeFileSync(
        outPath,
        JSON.stringify(coverageMap.toJSON(), null, 2),
      );
      console.log(
        `[E2E COV] wrote ${outPath} (${tracker.entries.length} scripts)`,
      );
    },
    { auto: true, scope: "test" },
  ],

  page: async ({ page, _coverageTracker }, use) => {
    if (E2E_COVERAGE) {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      _coverageTracker.wrapPage(page);
    }
    await use(page);
    if (E2E_COVERAGE && !page.__e2eCoverageStopped) {
      page.__e2eCoverageStopped = true;
      try {
        const entries = await page.coverage.stopJSCoverage();
        _coverageTracker.entries.push(...entries);
      } catch {
        // page may already be closed
      }
    }
  },
});

export { expect };

import { test as base, expect } from "@playwright/test";
import { portsForWorker } from "../lib/infra.mjs";

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use, testInfo) => {
    await use(portsForWorker(testInfo.parallelIndex).backendUrl);
  },
});

export { expect };

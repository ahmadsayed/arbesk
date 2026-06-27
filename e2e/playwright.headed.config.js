import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";

/**
 * Headed, slow-motion config for manual observation.
 *
 * Usage:
 *   npx playwright test --config=e2e/playwright.headed.config.js --project=chromium e2e/specs/13-editor-collaboration.spec.js
 */
export default defineConfig({
  ...baseConfig,
  timeout: 300_000,
  expect: {
    timeout: 60_000,
  },
  reporter: "line",
  use: {
    ...baseConfig.use,
    headless: false,
    launchOptions: {
      ...baseConfig.use.launchOptions,
      // Slow down every Playwright action by 1 second so you can watch each step.
      slowMo: 1_000,
    },
  },
});

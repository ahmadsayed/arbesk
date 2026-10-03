import { defineConfig, devices } from "@playwright/test";
import { E2E_GPU, E2E_WORKERS } from "./lib/infra.mjs";

// GPU rendering (see E2E_GPU in lib/infra.mjs) needs the full Chromium build
// (channel "chromium"): the default headless shell has no GPU path.
const USE_GPU = E2E_GPU;

export default defineConfig({
  testDir: "./specs",
  // The save-and-publish spec drives a full generate → save → mint → gallery →
  // burn flow with several on-chain transactions and a swiftshader thumbnail
  // render. Its slowest single wait (publish) is 30s, so the whole-test budget
  // must comfortably exceed that or Playwright aborts mid-flow.
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  // On-chain/IPFS timing is inherently variable; one retry locally and two on
  // CI absorbs transient hiccups without masking real regressions (a test that
  // only passes on retry still shows up flaky in the report).
  retries: process.env.CI ? 2 : 1,
  fullyParallel: false,
  workers: E2E_WORKERS,
  reporter: "list",
  use: {
    // baseURL is provided per-worker by e2e/fixtures/test.mjs so that each
    // Playwright worker navigates to its own backend stack.
    headless: true,
    screenshot: "only-on-failure",
    // Record only on the retry of a failed test: "retain-on-failure" records
    // every test and discards passing ones, burning CPU (video encoding) that
    // swiftshader WebGL already saturates. retries >= 1, so every failure
    // still gets a recording.
    video: "on-first-retry",
    trace: "on-first-retry",
    launchOptions: USE_GPU
      ? { args: ["--ignore-gpu-blocklist", "--enable-gpu"] }
      : { args: ["--use-angle=swiftshader"] },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(USE_GPU ? { channel: "chromium" } : {}) },
    },
  ],
  globalSetup: "./global-setup.mjs",
  globalTeardown: "./global-teardown.mjs",
});

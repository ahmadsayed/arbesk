// A kernel worker that never answers: stands in for a part whose build runs forever.
// (helpers/ is skipped by the test runner, so this is not collected as a test.)
import { parentPort } from "node:worker_threads";

parentPort?.on("message", () => {
  for (;;) { /* spin */ }
});

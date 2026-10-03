import { log, run, sleep, readState, clearState } from "./lib/infra.mjs";

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopBackend(worker) {
  const { backendPid, backendPort, workerIndex } = worker;
  if (!isAlive(backendPid)) return;

  log(
    `Stopping backend for worker ${workerIndex} (pid ${backendPid}, port ${backendPort})...`,
  );
  try {
    process.kill(backendPid, "SIGTERM");
  } catch {
    // already exited
  }
  await sleep(1000);
  if (isAlive(backendPid)) {
    try {
      process.kill(backendPid, "SIGKILL");
    } catch {
      // already exited
    }
  }
}

export default async function globalTeardown() {
  log("Tearing down...");

  const state = readState();
  const workers = Array.isArray(state.workers) ? state.workers : [];

  if (workers.length === 0 && state.backendPid) {
    // Legacy single-worker state from an older run.
    workers.push({
      workerIndex: 0,
      backendPid: state.backendPid,
      backendPort: state.backendPort,
      composeProject: state.composeProject,
      weStartedInfra: state.weStartedInfra,
    });
  }

  // Stop all backends in parallel.
  await Promise.all(workers.map((w) => stopBackend(w)));

  // Bring down every worker's Docker stack in parallel. `-t 1` skips Docker's
  // 10s SIGTERM grace period (some services ignore SIGTERM): the stacks are
  // disposable and the next setup wipes their volumes anyway.
  await Promise.all(
    workers.map(async (worker) => {
      if (!(worker.weStartedInfra && worker.composeProject)) {
        log(
          `Leaving pre-existing IPFS/Hardhat containers running for worker ${worker.workerIndex}`,
        );
        return;
      }
      log(
        `Stopping Docker stack for worker ${worker.workerIndex} (project ${worker.composeProject})...`,
      );
      try {
        await run(`docker compose -p "${worker.composeProject}" down -t 1`, {
          timeout: 60000,
        });
      } catch (err) {
        log(
          `WARN: could not tear down worker ${worker.workerIndex} stack: ${err.message}`,
        );
      }
    }),
  );

  clearState();
  log("Teardown complete");
}

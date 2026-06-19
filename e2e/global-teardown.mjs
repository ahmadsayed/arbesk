import { execSync } from "node:child_process";
import { ROOT, COMPOSE_PROJECT, log, sleep, readState, clearState } from "./lib/infra.mjs";

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export default async function globalTeardown() {
  log("Tearing down...");

  const { weStartedInfra, backendPid, backendPort } = readState();

  if (backendPid && isAlive(backendPid)) {
    log(`Stopping backend (pid ${backendPid}, port ${backendPort || "unknown"})...`);
    try {
      process.kill(backendPid, "SIGTERM");
    } catch {
      // already exited
    }
    // Give the backend a moment to shut down gracefully, then force-kill.
    await sleep(1000);
    if (isAlive(backendPid)) {
      try {
        process.kill(backendPid, "SIGKILL");
      } catch {
        // already exited
      }
    }
  }

  if (weStartedInfra) {
    execSync(`docker compose -p "${COMPOSE_PROJECT}" down`, {
      stdio: "inherit",
      cwd: ROOT,
      timeout: 60000,
    });
  } else {
    log("Leaving pre-existing IPFS/Hardhat containers running");
  }

  clearState();
}

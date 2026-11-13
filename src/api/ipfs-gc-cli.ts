/**
 * Command-line front end of the IPFS garbage collector.
 * @remarks Shared by scripts/run-ipfs-gc.mjs and the server binary's `gc`
 *   subcommand: the production image ships only that binary, and the k3s
 *   CronJob (deploy/k8s/gc.yaml) runs it there. Import this module only
 *   after the .env files are loaded - config.ts reads process.env on import.
 */

import { Command } from "commander";
import { formatBytes, runIpfsGC, type IpfsGCResult } from "./ipfs-gc.ts";
import { createStorageAdapter } from "./storage/index.ts";

const HOUR_MS = 3600000;

/** One line a person can read at the end of a job log. */
function summaryLine(r: IpfsGCResult): string {
  const left = r.orphans - r.unpinned;
  const unknown = r.sizeUnknown > 0 ? ` (${r.sizeUnknown} of unknown size not counted)` : "";
  return (
    `[GC-CLI] removed ${r.unpinned} files, ${formatBytes(r.unpinnedBytes)} freed | ` +
    `${left} unused files, ${formatBytes(r.orphanBytes - r.unpinnedBytes)}, still pinned${unknown}`
  );
}

/**
 * Parses `argv` (options only, no program name), runs the collector and
 * prints its result.
 * @remarks A live run unpins only CIDs that an earlier live run already saw
 *   orphaned at least --grace-hours ago, so the first live run just marks.
 * @returns the process exit code: 0 clean, 2 when the run reported errors
 *   (a live run then unpinned nothing), 1 when it could not run at all
 */
export async function runGcCli(argv: string[]): Promise<number> {
  const program = new Command()
    .name("gc")
    .description(
      "Scans live tokens on the configured EVM chain, walks their manifest chains, and unpins pinned CIDs that are no longer reachable.",
    )
    .option("--dry-run", "Report orphans without unpinning (default)", true)
    .option("--live", "Actually unpin orphaned CIDs", false)
    .option("--max-unpin <number>", "Limit the number of CIDs to unpin", parseFloat, Infinity)
    .option(
      "--grace-hours <hours>",
      "Only unpin CIDs orphaned for at least this long (default: env IPFS_GC_GRACE_HOURS, else 168)",
      parseFloat,
    )
    .option("--chain-id <id>", "Override chain ID (default: env CHAIN_ID)", process.env.CHAIN_ID);

  program.parse(argv, { from: "user" });
  const opts = program.opts();
  const dryRun = opts.live ? false : opts.dryRun;

  console.log(
    `[GC-CLI] starting | dryRun=${dryRun} maxUnpin=${opts.maxUnpin} chainId=${opts.chainId}`,
  );

  try {
    const result = await runIpfsGC(
      {
        dryRun,
        maxUnpin: opts.maxUnpin,
        chainId: opts.chainId,
        graceMs: opts.graceHours === undefined ? undefined : opts.graceHours * HOUR_MS,
      },
      // The GC never uploads: skip minting browser upload URLs.
      createStorageAdapter({ uploadPool: false }),
    );
    console.log("\n[GC-CLI] result:");
    console.log(JSON.stringify(result, null, 2));
    console.log(summaryLine(result));
    return result.errors.length > 0 ? 2 : 0;
  } catch (err) {
    console.error("[GC-CLI] fatal error:", (err as Error).message);
    return 1;
  }
}

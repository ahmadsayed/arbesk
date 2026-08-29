/**
 * Verbose debugging for the besk CLI + MCP server. Off by default; enabled by
 * `--verbose`/`-v` (cli.ts strips the flag) or `ARBESK_VERBOSE=1` — the env var
 * is the only switch under `besk mcp`, where there are no CLI args.
 *
 * Everything goes to stderr with an ISO timestamp: stdout is the CLI's
 * pipeable output and the MCP server's JSON-RPC channel.
 */
let verbose = /^(1|true|yes)$/i.test(process.env.ARBESK_VERBOSE ?? "");

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function isVerbose(): boolean {
  return verbose;
}

/** One timestamped stderr line, verbose mode only. */
export function debug(...args: unknown[]): void {
  if (!verbose) return;
  console.error("[" + new Date().toISOString() + "]", ...args);
}

/**
 * Wrap an async action with start / done(+duration) / fail log lines.
 * Straight passthrough when verbose is off.
 */
export async function trace<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!verbose) return fn();
  const t0 = Date.now();
  debug("start:", label);
  try {
    const result = await fn();
    debug("done:", label, "(" + (Date.now() - t0) + "ms)");
    return result;
  } catch (e) {
    debug("fail:", label, "(" + (Date.now() - t0) + "ms)", (e as Error).message);
    throw e;
  }
}

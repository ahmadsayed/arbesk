/**
 * Hono request logger — replicates the morgan custom format in src/index.ts:
 * `[OK]/[ERR]/[RDR] METHOD url → status (ms) | client=…`.
 */

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";

function clientAddress(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // In-process test servers (app.request) have no socket.
    return "test";
  }
}

/**
 * Hono middleware logging each request once its response is known.
 */
export function requestLog(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    const status = c.res.status;
    const tag = status >= 400 ? "[ERR]" : status >= 300 ? "[RDR]" : "[OK]";
    const { pathname, search } = new URL(c.req.url);
    console.log(
      `${tag} ${c.req.method} ${pathname}${search} → ${status} (${ms}ms) | client=${clientAddress(c)}`,
    );
  };
}

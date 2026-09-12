/**
 * Hono JSON error helper — port of `sendError` from src/api/errors.ts.
 * @remarks Emits the byte-identical envelope
 *   `{ error: { code, message, details? } }` via `c.json(body, status)`.
 *   The Express version in src/api/errors.ts stays in place for unmigrated
 *   routes.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Send a standardized error response.
 */
export function sendError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details: unknown = null,
) {
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  return c.json(body, status);
}

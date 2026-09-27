import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Standardized error response helper.
 * @remarks Emits `{ error: { code, message, details? } }`. `status` is a plain
 *   number because several callers forward an upstream or computed status.
 */
export function sendError(
  c: Context,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
) {
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  return c.json(body, status as ContentfulStatusCode);
}

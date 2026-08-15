import type { Response } from "express";

/**
 * Standardized error response helper.
 */
export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
) {
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

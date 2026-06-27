/**
 * Standardized error response helper.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {unknown} [details]
 */
export function sendError(res, status, code, message, details = null) {
  /** @type {{ error: { code: string; message: string; details?: unknown } }} */
  const body = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

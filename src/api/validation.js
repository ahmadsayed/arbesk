import { sendError } from "./errors.js";

/**
 * @typedef {{ path: (string | number)[]; message: string }} ValidationIssue
 */

/**
 * Format Zod issues into a concise log string.
 *
 * @param {ValidationIssue[]} issues
 * @returns {string}
 */
function formatIssues(issues) {
  return issues.map((i) => i.path.join(".") + ": " + i.message).join("; ");
}

/**
 * @param {import('zod').ZodError} error
 * @returns {ValidationIssue[]}
 */
function issuesFromZod(error) {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}

/**
 * Create Express middleware that validates `req.body` against a Zod schema.
 * On success, replaces `req.body` with the parsed value.
 * On failure, responds with 400 and a structured error.
 *
 * @param {import('zod').ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = issuesFromZod(result.error);
      console.log(`[VALIDATE] body rejected - ${formatIssues(issues)}`);
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid request body", {
        issues,
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Create Express middleware that validates `req.query` against a Zod schema.
 *
 * @param {import('zod').ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const issues = issuesFromZod(result.error);
      console.log(`[VALIDATE] query rejected - ${formatIssues(issues)}`);
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid query parameters", {
        issues,
      });
    }
    req.query = result.data;
    next();
  };
}

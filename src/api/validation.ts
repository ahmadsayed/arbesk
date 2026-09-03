import { sendError } from "./errors.ts";
import type { RequestHandler } from "express";
import type { ZodError, ZodSchema } from "zod";

interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Format Zod issues into a concise log string.
 */
function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => i.path.join(".") + ": " + i.message).join("; ");
}

function issuesFromZod(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}

/**
 * Creates Express middleware that validates `req.body` against a Zod schema.
 * @remarks On success replaces `req.body` with the parsed value; on failure
 *   responds with 400 and a structured error.
 */
export function validateBody(schema: ZodSchema): RequestHandler {
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
 */
export function validateQuery(schema: ZodSchema): RequestHandler {
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

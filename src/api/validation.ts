/**
 * Request validation — thin wrappers over @hono/zod-validator: failures
 * respond 400 `VALIDATION_ERROR` with `details.issues`. Handlers read the
 * parsed value with `c.req.valid("json")` / `c.req.valid("query")`.
 */

import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { ZodError, ZodSchema } from "zod";

/** One invalid field, as returned under `details.issues`. */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/** Formats issues into a concise, single-line log string. */
function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => i.path.join(".") + ": " + i.message).join("; ");
}

/** Projects a ZodError into the wire shape, one entry per issue. */
function issuesFromZod(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}

function rejectionHook(kind: "body" | "query", message: string) {
  return (
    result: { success: boolean; error?: ZodError },
    c: Context,
  ) => {
    if (!result.success && result.error) {
      const issues = issuesFromZod(result.error);
      console.log(`[VALIDATE] ${kind} rejected - ${formatIssues(issues)}`);
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message,
            details: { issues },
          },
        },
        400,
      );
    }
  };
}

/**
 * Validates the JSON body against a Zod schema.
 * @remarks On failure the response is 400 with a structured error.
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return zValidator("json", schema, rejectionHook("body", "Invalid request body"));
}

/**
 * Validates the query string against a Zod schema.
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return zValidator(
    "query",
    schema,
    rejectionHook("query", "Invalid query parameters"),
  );
}

/**
 * Hono request validation — thin wrappers over @hono/zod-validator matching
 * the Express validators in src/api/validation.ts: failures respond 400
 * `VALIDATION_ERROR` with `details.issues`.
 */

import { zValidator } from "@hono/zod-validator";
import { formatIssues, issuesFromZod } from "../shared/zod-issues.ts";
import type { Context } from "hono";
import type { ZodError, ZodSchema } from "zod";

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
 * Creates Hono middleware validating the JSON body against a Zod schema.
 * @remarks On success the parsed value replaces the body; on failure the
 *   response is 400 with a structured error.
 */
export function validateBody(schema: ZodSchema) {
  return zValidator("json", schema, rejectionHook("body", "Invalid request body"));
}

/**
 * Creates Hono middleware validating the query string against a Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return zValidator(
    "query",
    schema,
    rejectionHook("query", "Invalid query parameters"),
  );
}

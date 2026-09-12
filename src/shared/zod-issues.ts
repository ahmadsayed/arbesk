/**
 * Zod issue shaping, shared by the Express and Hono validators.
 *
 * @remarks Framework-agnostic by construction, and that is the point: the two
 *   validators differ in HOW they reject a request — one calls sendError on a
 *   Response, the other returns a JSONResponse — but not in WHY. Both must
 *   produce the same `details.issues` shape and the same log line, because a
 *   client parsing that shape cannot tell which stack answered it.
 *
 *   Extracted from two verbatim copies. During a migration where both stacks
 *   are live, a copied response shape is a contract that can drift silently:
 *   the Express path would keep emitting one structure while the Hono path
 *   emitted another, and nothing would report it.
 */
import type { ZodError } from "zod";

/** One invalid field, in the shape both APIs return under details.issues. */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Formats Zod issues into a concise log string.
 * @param issues Issues to render.
 * @returns A single-line, semicolon-separated summary.
 */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => i.path.join(".") + ": " + i.message).join("; ");
}

/**
 * Projects a ZodError into the wire shape.
 * @param error The failed parse.
 * @returns One entry per issue, with the path preserved.
 */
export function issuesFromZod(error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));
}

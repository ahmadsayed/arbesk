/**
 * Pure parser for SPA paths: maps a pathname to a view plus an optional
 * profile subject (the wallet whose public library is being browsed).
 * @remarks Kept free of DOM/engine imports so it stays cheap to unit-test.
 *   The caller passes `location.pathname`; query strings never reach here.
 */

import { base58ToAddress } from "../utils/base58.ts";

export interface AppRoute {
  view: "studio" | "library";
  /** Decoded profile subject address, or null when the path carries none. */
  subjectAddress: string | null;
  /** True when a subject segment is present but is not a valid base58 address. */
  invalidSubject: boolean;
}

/**
 * Parse an SPA pathname.
 * @remarks `/` and unknown paths resolve to Studio with no subject.
 *   `/library/<base58>` (and `/studio/<base58>`, parsed for future use) carry
 *   a profile subject; an undecodable segment sets `invalidSubject`.
 */
export function parseAppPath(pathname: string): AppRoute {
  const segments = pathname.split("/").filter(Boolean);
  const root = segments[0];
  if (root !== "studio" && root !== "library") {
    return { view: "studio", subjectAddress: null, invalidSubject: false };
  }

  const subjectSegment = segments[1];
  if (!subjectSegment) {
    return { view: root, subjectAddress: null, invalidSubject: false };
  }

  const subjectAddress = base58ToAddress(subjectSegment);
  if (!subjectAddress) {
    return { view: root, subjectAddress: null, invalidSubject: true };
  }
  return { view: root, subjectAddress, invalidSubject: false };
}

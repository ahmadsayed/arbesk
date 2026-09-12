/**
 * Version of the design-document + prelude contract a client must implement.
 * @remarks Bumping this is a breaking change: a client whose prelude does not
 *   match refuses to execute the code rather than running it against an API it
 *   does not implement.
 */
export const CONTRACT_VERSION = 1;

/** Date-stamped prelude revision shipped with this build. */
export const PRELUDE_VERSION = "2026-09-14";

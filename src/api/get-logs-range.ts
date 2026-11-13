/**
 * eth_getLogs block-range caps: how to recognise a rejection and how far to
 * narrow the next request.
 * @remarks Shared by the token indexer and the IPFS GC. Public RPCs enforce
 *   unpublished caps that tighten under load (sepolia.base.org went
 *   2000 → 1000 → 500 → 200 in 2026), so any fixed chunk size is a bet
 *   against a moving target.
 */

/**
 * Matches RPC rejections caused by an over-wide (or over-full) getLogs query.
 * The exact phrasing varies by provider and over time.
 */
const RANGE_REJECTION =
  /limited to a [\d,]+ (?:block )?range|block range (?:is )?too (?:large|wide)|exceeds (?:the )?max(?:imum)?[^\n]*range|returned more than [\d,]+ results/i;

/** True when `message` is an RPC refusing a getLogs query as too wide. */
export function isGetLogsRangeRejection(message: string): boolean {
  return RANGE_REJECTION.test(message);
}

/**
 * Extracts the provider's advertised eth_getLogs block-range cap from an RPC
 * error message ("eth_getLogs is limited to a 500 range" → 500; also handles
 * thousands separators like "1,000"). Returns null when no explicit cap is
 * named, in which case the caller should halve the chunk instead.
 */
export function parseGetLogsRangeCap(message: string): number | null {
  const m = message.match(/limited to a ([\d,]+) (?:block )?range/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

/**
 * The chunk size to retry with after `message` rejected a `current`-block
 * query: the advertised cap when the error names a smaller one, else half.
 * @remarks Never returns `current` again: the advertised cap can be off by
 *   one (inclusive vs exclusive counting), so a non-shrinking snap halves
 *   instead, which guarantees a retry loop converges. Floors at 1.
 */
export function narrowGetLogsChunk(current: number, message: string): number {
  const cap = parseGetLogsRangeCap(message);
  let next = cap !== null ? Math.min(current, cap) : Math.floor(current / 2);
  if (next >= current) next = Math.floor(current / 2);
  return Math.max(1, next);
}

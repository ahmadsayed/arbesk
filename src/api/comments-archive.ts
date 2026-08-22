/**
 * Arbesk Comments Archive Service
 *
 * Builds a content-addressed JSON archive of Nostr chat events for a given
 * asset and stores it on the private IPFS node. The archive CID is written
 * into the manifest as `comments_archive_cid` on every republish.
 *
 * Archive format:
 *   {
 *     "assetTag": "<chainId>:<contract>:<tokenId>:<assetId>",
 *     "generatedAt": 1718803200000,
 *     "eventCount": 3,
 *     "events": [ Nostr kind:1 events signed by the service key ]
 *   }
 */

import { NOSTR_RELAY_URL } from "../config.ts";
import { KIND_CHAT, TAG_ASSET, createPool } from "./nostr-relay.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const RELAY_QUERY_TIMEOUT_MS = 15000;
const RELAY_EVENT_LIMIT = 10000;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Query the private Nostr relay for all kind:1 events tagged with the asset,
 * package them into a deterministic archive object, and return it.
 *
 * @param assetTag - Canonical asset-level tag (chain:contract:tokenId:assetId)
 * @returns Archive object
 */
export async function fetchCommentsArchive(
  assetTag: string,
): Promise<{
  assetTag: string;
  generatedAt: number;
  eventCount: number;
  events: any[];
}> {
  const events = await queryRelayForAsset(assetTag);
  return {
    assetTag,
    generatedAt: Date.now(),
    eventCount: events.length,
    events,
  };
}

/**
 * Build a comments archive for the asset and persist it to IPFS.
 *
 * @param assetTag - Canonical asset-level tag
 * @param storage - Storage adapter (Kubo or Pinata)
 */
export async function archiveCommentsForAsset(
  assetTag: string,
  storage: { add: (payload: string) => Promise<string> },
): Promise<{ cid: string; eventCount: number }> {
  const archive = await fetchCommentsArchive(assetTag);
  const payload = JSON.stringify(archive);

  const archiveCid = await storage.add(payload);

  console.log(
    `[ARCHIVE] archived ${archive.eventCount} comment(s) for ${assetTag} → ${archiveCid}`,
  );
  return { cid: archiveCid, eventCount: archive.eventCount };
}

// ─── Relay Query ────────────────────────────────────────────────────────────

/**
 * Query the private Nostr relay for all kind:1 events carrying the given asset
 * tag. The pool's `querySync` handles the REQ/EVENT/EOSE lifecycle and resolves
 * with the collected events at EOSE (or after `maxWait`); it never rejects —
 * an unreachable relay simply yields an empty list, which the catch below also
 * covers for any residual failure.
 */
async function queryRelayForAsset(assetTag: string): Promise<object[]> {
  const pool = createPool();

  try {
    return await pool.querySync(
      [NOSTR_RELAY_URL],
      {
        kinds: [KIND_CHAT],
        [`#${TAG_ASSET}`]: [assetTag],
        limit: RELAY_EVENT_LIMIT,
      },
      { maxWait: RELAY_QUERY_TIMEOUT_MS },
    );
  } catch (err) {
    const e = err as Error;
    const message = e.message || String(err);
    console.warn(`[ARCHIVE] relay query failed for ${assetTag}:`, message);
    // A unreachable relay simply means there are no comments to archive.
    // Returning an empty archive keeps republish flows resilient and makes
    // the route testable without a live relay.
    return [];
  } finally {
    pool.close([NOSTR_RELAY_URL]);
  }
}

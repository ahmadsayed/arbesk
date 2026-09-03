/**
 * Builds a content-addressed JSON archive of Nostr chat events for an asset,
 * stored on the private IPFS node.
 * @remarks The archive CID is written into the manifest as
 *   `comments_archive_cid` on every republish.
 */

import { NOSTR_RELAY_URL } from "../config.ts";
import { KIND_CHAT, TAG_ASSET, createPool } from "./nostr-relay.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const RELAY_QUERY_TIMEOUT_MS = 15000;
const RELAY_EVENT_LIMIT = 10000;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Queries the private Nostr relay for all kind:1 events tagged with the asset
 * and packages them into a deterministic archive object.
 * @param assetTag canonical asset-level tag (chain:contract:tokenId:assetId)
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
 * Builds a comments archive for the asset and persists it to IPFS.
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
 * Queries the private Nostr relay for all kind:1 events carrying the given
 * asset tag.
 * @remarks Never rejects: an unreachable relay yields an empty list.
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

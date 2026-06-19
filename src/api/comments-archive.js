/**
 * Arbesk Comments Archive Service
 *
 * Builds a content-addressed JSON archive of Nostr chat events for a given
 * asset and stores it on the private IPFS node. The archive CID is written
 * into the manifest as `comments_archive_cid` on every republish.
 *
 * Archive format:
 *   {
 *     "assetId": "<chainId>:<contract>:<tokenId>",
 *     "generatedAt": 1718803200000,
 *     "eventCount": 3,
 *     "events": [ Nostr kind:1 events signed by the service key ]
 *   }
 */

import { NOSTR_RELAY_URL } from "../config.js";
import { KIND_CHAT, TAG_ASSET, createRelay } from "./nostr-relay.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const RELAY_QUERY_TIMEOUT_MS = 15000;
const RELAY_EVENT_LIMIT = 10000;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Query the private Nostr relay for all kind:1 events tagged with the asset,
 * package them into a deterministic archive object, and return it.
 *
 * @param {string} assetId - Canonical asset identifier (chain:contract:tokenId)
 * @returns {Promise<object>} Archive object
 */
export async function fetchCommentsArchive(assetId) {
  const events = await queryRelayForAsset(assetId);
  return {
    assetId,
    generatedAt: Date.now(),
    eventCount: events.length,
    events,
  };
}

/**
 * Build a comments archive for the asset and persist it to IPFS.
 *
 * @param {string} assetId - Canonical asset identifier
 * @param {{ add: (payload: string) => Promise<string> }} storage - Storage adapter (Kubo or Pinata)
 * @returns {Promise<{cid: string, eventCount: number}>}
 */
export async function archiveCommentsForAsset(assetId, storage) {
  const archive = await fetchCommentsArchive(assetId);
  const payload = JSON.stringify(archive);

  const archiveCid = await storage.add(payload);

  console.log(
    `[ARCHIVE] archived ${archive.eventCount} comment(s) for ${assetId} → ${archiveCid}`,
  );
  return { cid: archiveCid, eventCount: archive.eventCount };
}

// ─── Relay Query ────────────────────────────────────────────────────────────

/**
 * Query the private Nostr relay for all kind:1 events carrying the given asset
 * tag. Uses nostr-tools SimplePool to handle the REQ/EVENT/EOSE lifecycle.
 *
 * @param {string} assetId
 * @returns {Promise<Array<object>>}
 */
async function queryRelayForAsset(assetId) {
  const relay = createRelay(NOSTR_RELAY_URL);
  const filter = {
    kinds: [KIND_CHAT],
    [`#${TAG_ASSET}`]: [assetId],
    limit: RELAY_EVENT_LIMIT,
  };

  try {
    await relay.connect();
    const events = await new Promise((resolve, reject) => {
      const collected = [];
      let finished = false;
      const sub = relay.subscribe([filter], {
        onevent(event) {
          collected.push(event);
        },
        oneose() {
          if (finished) return;
          finished = true;
          sub.close();
          resolve(collected);
        },
        onclose() {
          if (finished) return;
          finished = true;
          resolve(collected);
        },
        eoseTimeout: RELAY_QUERY_TIMEOUT_MS,
      });
    });
    return events;
  } catch (err) {
    const message = err?.message || String(err);
    console.warn(`[ARCHIVE] relay query failed for ${assetId}:`, message);
    throw new Error(message);
  } finally {
    relay.close();
  }
}

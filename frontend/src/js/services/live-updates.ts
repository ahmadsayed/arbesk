import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { KIND_ASSET_UPDATE, TAG_TOKEN, tokenTag } from "@arbesk/nostr";
import { getNostrFacade, getOrCreateBinding } from "./nostr-browser.ts";
import { getContractAddress } from "../blockchain/network-config.ts";
import { NOSTR_RELAY_URL } from "./nostr-config.ts";
import { invalidateResolution, readTokenURI, normalizeTokenURI } from "../blockchain/token-resolver.ts";
import { collectSceneChildRefs, childRefCollection } from "../engine/child-refs.ts";

const pool = new SimplePool();
let started = false;
const seen = new Set<string>();

/**
 * Tokens referenced by the open scene at any nesting depth, keyed by tag so
 * a relay notice for a grandchild (a child_ref inside a referenced child's
 * manifest, invisible in the root manifest) still matches.
 */
export function collectTokens(): { chainId: number; contractAddress: string; tokenId: string }[] {
  const set = new Map<string, { chainId: number; contractAddress: string; tokenId: string }>();
  for (const { ref } of collectSceneChildRefs()) {
    const col = childRefCollection(ref);
    if (!col) continue;
    set.set(tokenTag(col.chainId, col.contractAddress, col.tokenId), col);
  }
  return [...set.values()];
}

/**
 * The publisher's tx confirms on the wallet's RPC while the read RPC (e.g.
 * sepolia.base.org) can lag a few blocks behind. Reloading right away would
 * re-resolve the OLD CID and re-cache it (30s TTL), and no second notice ever
 * arrives — so wait until the chain reports the noticed URI before reloading.
 */
async function waitForOnChainUri(
  chainId: number,
  contract: string,
  tokenId: string,
  expectedUri: string | null,
  timeoutMs = 20000
): Promise<void> {
  if (!expectedUri) return;
  const expected = normalizeTokenURI(expectedUri);
  if (!expected) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const current = normalizeTokenURI(await readTokenURI(chainId, contract, tokenId));
      if (current === expected) return;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`[LIVE] token ${tokenId} URI not visible on-chain after ${timeoutMs / 1000}s — reloading anyway`);
}

// On a local publish, reload the local scene once the new URI is readable,
// then best-effort broadcast "asset updated" so other viewers re-fetch too.
async function onLocalUriChanged(payload: any) {
  // The publish tx went to walletState's contract, which may be the paid
  // contract — prefer it over the network default when present.
  const contract = payload.contractAddress || getContractAddress(payload.chainId);
  await waitForOnChainUri(payload.chainId, contract!, payload.tokenId, payload.newAssetURI);
  invalidateResolution(payload.chainId, contract!, payload.tokenId);
  emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "local" });
  try {
    const binding = await getOrCreateBinding();
    if (binding) {
      await getNostrFacade().publishAssetUpdate(binding, {
        chainId: payload.chainId, tokenId: payload.tokenId, newAssetURI: payload.newAssetURI,
        assetId: payload.assetId ?? undefined,
      }, contract!);
      console.log(`[LIVE] update notice broadcast | token=${payload.tokenId} chain=${payload.chainId}`);
    } else {
      console.warn("[LIVE] update notice NOT broadcast — no wallet binding (other windows will not reload)");
    }
  } catch (err) {
    console.warn("[LIVE] update notice broadcast failed (other windows will not reload):", (err as Error).message);
  }
}

export function startLiveUpdates(): void {
  if (started) return;
  started = true;
  on(EVENTS.ASSET_URI_CHANGED, (p) => { onLocalUriChanged(p).catch(() => {}); });
  pool.subscribeMany([NOSTR_RELAY_URL], {
    kinds: [KIND_ASSET_UPDATE],
  }, {
    onevent: async (event: NostrEvent) => {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      try {
        const payload = JSON.parse(event.content);
        const eventTag = event.tags.find((t) => t[0] === TAG_TOKEN)?.[1] || "";
        // The notice is just "asset updated"; the signer is irrelevant — the
        // chain is the source of truth, so re-fetch the asset and reload.
        const tokens = collectTokens();
        if (!tokens.some((t) => tokenTag(t.chainId, t.contractAddress, t.tokenId) === eventTag)) return;
        console.log(`[LIVE] update notice received | token=${payload.tokenId} chain=${payload.chainId}`);
        // The event content carries the publisher's actual contract (the paid
        // tier is not the network default), so prefer it over the default.
        const contract = payload.contractAddress || getContractAddress(payload.chainId);
        await waitForOnChainUri(payload.chainId, contract!, payload.tokenId, payload.newAssetURI);
        invalidateResolution(payload.chainId, contract!, payload.tokenId);
        emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "remote" });
      } catch { /* ignore malformed */ }
    },
  });
}

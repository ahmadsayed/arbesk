import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { KIND_ASSET_UPDATE, TAG_TOKEN, tokenTag } from "@arbesk/nostr";
import { getNostrFacade, getOrCreateBinding } from "./nostr-browser.ts";
import { getContractAddress } from "../blockchain/network-config.ts";
import { getManifestNodes } from "../engine/transforms.ts";
import { NOSTR_RELAY_URL } from "./nostr-config.ts";
import { invalidateResolution } from "../blockchain/token-resolver.ts";

const pool = new SimplePool();
let started = false;
let unsub: (() => void) | null = null;
let relaySub: { close: () => void } | null = null;
const seen = new Set<string>();

export function collectTokens(): { chainId: number; contractAddress: string; tokenId: string }[] {
  // child_ref nodes carry collection.chainId/contractAddress/tokenId (new) or flat (legacy).
  const nodes = getManifestNodes(getCurrentManifest());
  const set = new Map<string, { chainId: number; contractAddress: string; tokenId: string }>();
  for (const n of nodes) {
    const ref = n?.child_ref;
    if (!ref) continue;
    const chainId = Number(ref.collection?.chainId ?? ref.chainId ?? 0);
    const contractAddress = ref.collection?.contractAddress ?? ref.contractAddress ?? "";
    const tokenId = String(ref.collection?.tokenId ?? ref.tokenId ?? "");
    if (chainId && contractAddress && tokenId) set.set(tokenTag(chainId, contractAddress, tokenId), { chainId, contractAddress, tokenId });
  }
  return [...set.values()];
}

// On a local publish, reload the local scene immediately, then best-effort
// broadcast "asset updated" so other viewers re-fetch too.
async function onLocalUriChanged(payload: any) {
  const contract = getContractAddress(payload.chainId);
  invalidateResolution(payload.chainId, contract!, payload.tokenId);
  emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "local" });
  try {
    const binding = await getOrCreateBinding();
    if (binding) {
      await getNostrFacade().publishAssetUpdate(binding, {
        chainId: payload.chainId, tokenId: payload.tokenId, newAssetURI: payload.newAssetURI,
      }, contract!);
    }
  } catch { /* broadcast is best-effort */ }
}

export function startLiveUpdates(): void {
  if (started) return;
  started = true;
  unsub = on(EVENTS.ASSET_URI_CHANGED, (p) => { onLocalUriChanged(p).catch(() => {}); });
  relaySub = pool.subscribeMany([NOSTR_RELAY_URL], {
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
        invalidateResolution(payload.chainId, getContractAddress(payload.chainId)!, payload.tokenId);
        emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "remote" });
      } catch { /* ignore malformed */ }
    },
  });
}

export function stopLiveUpdates(): void {
  started = false;
  unsub?.(); unsub = null;
  relaySub?.close(); relaySub = null;
}

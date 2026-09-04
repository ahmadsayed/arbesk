import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { KIND_ASSET_UPDATE, KIND_BINDING, TAG_TOKEN, TAG_ADDRESS, tokenTag } from "@arbesk/nostr";
import { getNostrFacade, getOrCreateBinding, getTokenOwner } from "./nostr-browser.ts";
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
  // child_ref nodes carry collection.chainId/contractAddress/tokenId (new) or flat chainId/contractAddress/tokenId (legacy).
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

async function onLocalUriChanged(payload: any) {
  const binding = await getOrCreateBinding();
  if (!binding) return;
  const contract = getContractAddress(payload.chainId);
  await getNostrFacade().publishAssetUpdate(binding, {
    chainId: payload.chainId, tokenId: payload.tokenId, newAssetURI: payload.newAssetURI,
  }, contract!);
  // Invalidate the resolution cache so the in-place reload re-fetches the new
  // CID instead of a stale 30s-cached value.
  invalidateResolution(payload.chainId, contract!, payload.tokenId);
  emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "local" });
}

async function resolveBindingFor(address: string): Promise<any | null> {
  const events = await pool.querySync([NOSTR_RELAY_URL], {
    kinds: [KIND_BINDING], "#address": [address.toLowerCase()],
  });
  if (!events.length) return null;
  const ev = events[events.length - 1];
  try { return JSON.parse(ev.content); } catch { return null; }
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
        // Only react to tokens this scene references.
        const tokens = collectTokens();
        if (!tokens.some((t) => tokenTag(t.chainId, t.contractAddress, t.tokenId) === eventTag)) return;
        const owner = await getTokenOwner(payload.chainId, payload.tokenId);
        if (!owner) return;
        const binding = await resolveBindingFor(owner);
        if (!binding) return;
        const ok = await getNostrFacade().verifyAssetUpdate(event, binding, payload);
        if (!ok) return;
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

/**
 * Domain: Asset — the one open asset. Facade over the domain asset-store:
 * this module is the ONLY writer of the asset name and the
 * CID/tokenId/currentManifest identity fields, and the single subscription
 * point for chrome rendering.
 */
import { on, emit, EVENTS } from "../events/bus.ts";
import { assetStore, tagManifestCid } from "./asset-store.ts";
import { getStateForNewAsset } from "../../utils/new-asset.ts";
import { deriveDefaultAssetId } from "../../utils/collections.ts";
import { log } from "../../utils/log.ts";

export interface AssetSnapshot {
  name: string | null;
  assetId: string | null;
  tokenId: string | null;
  activeCid: string | null;
  latestCid: string | null;
}

const _listeners = new Set<(snapshot: Readonly<AssetSnapshot>) => void>();

/**
 * Frozen point-in-time view of the active asset for renderers.
 */
export function getAssetSnapshot(): Readonly<AssetSnapshot> {
  const s = assetStore.get();
  return Object.freeze({
    name: s.activeAssetName,
    assetId: s.activeAssetId,
    tokenId: s.activeAssetTokenId,
    activeCid: s.activeAssetManifestCid,
    latestCid: s.latestAssetManifestCid,
  });
}

/**
 * Subscribe to asset changes. Fires immediately with the current snapshot,
 * then on every ASSET_STATE_CHANGED.
 * @returns unsubscribe
 */
export function subscribeAsset(
  fn: (snapshot: Readonly<AssetSnapshot>) => void
): () => void {
  _listeners.add(fn);
  fn(getAssetSnapshot());
  return () => _listeners.delete(fn);
}

on(EVENTS.ASSET_STATE_CHANGED, () => {
  const snapshot = getAssetSnapshot();
  for (const fn of _listeners) fn(snapshot);
});

export function getActiveAssetManifestCid(): string | null {
  return assetStore.get().activeAssetManifestCid;
}

export function getLatestAssetManifestCid(): string | null {
  return assetStore.get().latestAssetManifestCid;
}

export function getActiveAssetTokenId(): string | null {
  return assetStore.get().activeAssetTokenId;
}

export function getActiveAssetId(): string | null {
  return assetStore.get().activeAssetId;
}

export function getActiveAssetName(): string | null {
  return assetStore.get().activeAssetName;
}

export function getCurrentManifest(): object | null {
  return assetStore.get().currentManifest;
}

/**
 * Full read-only snapshot of the asset domain state. For consumers that need
 * several fields at once; prefer individual getters when possible.
 */
export function getAssetState(): Readonly<{
  activeAssetManifestCid: string | null;
  activeAssetTokenId: string | null;
  activeAssetName: string | null;
  latestAssetManifestCid: string | null;
  currentManifest: object | null;
  activeAssetId: string | null;
}> {
  const s = assetStore.get();
  return Object.freeze({
    activeAssetManifestCid: s.activeAssetManifestCid,
    activeAssetTokenId: s.activeAssetTokenId,
    activeAssetName: s.activeAssetName,
    latestAssetManifestCid: s.latestAssetManifestCid,
    currentManifest: s.currentManifest,
    activeAssetId: s.activeAssetId,
  });
}

const DEFAULT_NAMES = new Set([
  "untitled asset",
  "my asset",
  "no asset open",
  "",
]);

export function isDefaultAssetName(name: string | null | undefined): boolean {
  return DEFAULT_NAMES.has((name || "").toLowerCase().trim());
}

/**
 * Rename the active asset. The only writer of activeAssetName.
 */
export function renameAsset(name: string): void {
  assetStore.set({ activeAssetName: name });
}

/**
 * Naming rule for a freshly loaded manifest (SCENE_READY): the manifest's
 * name wins; with no manifest name keep the session name; with neither,
 * fall back to "Untitled Asset".
 */
export function adoptLoadedManifestName(manifest: any): void {
  const current = assetStore.get().activeAssetName;
  const name = manifest?.name || current || "Untitled Asset";
  if (manifest?.name || !current) {
    assetStore.set({ activeAssetName: name });
  }
}

/**
 * Naming rule for chat-driven auto-saves: adopt the manifest's name only
 * when it is a real name — a default/absent name must not clobber a good
 * session name. (Moved verbatim from ui/asset-save.js.)
 */
export function adoptManifestName(manifest: any): void {
  const name = manifest?.name?.trim();
  if (name && !isDefaultAssetName(name)) {
    assetStore.set({ activeAssetName: name });
  }
}

/**
 * Clear the active asset for a fresh draft: name, CIDs, token identity go;
 * the open collection context survives (getStateForNewAsset semantics).
 */
export function resetForNewAsset(): void {
  assetStore.set({
    ...getStateForNewAsset(assetStore.get()),
    activeAssetName: null,
  });
}

/**
 * Close the active asset entirely (library close-out).
 */
export function closeAsset(): void {
  assetStore.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetId: null,
    activeAssetName: null,
    currentManifest: null,
  });
}

// ─── Identity / CID commands ───────────────────────────────────────
// The ONLY writers of activeAssetManifestCid, latestAssetManifestCid,
// activeAssetTokenId, activeAssetId, currentManifest.

/**
 * Adopt a freshly opened/loaded asset: active + latest CIDs point at `cid`.
 * Identity keys are written only when present (`in` semantics).
 */
export function adoptOpenedAsset(
  cid: string,
  identity: { tokenId?: string | null; assetId?: string | null } = {}
): void {
  const patch: Record<string, any> = {
    activeAssetManifestCid: cid,
    latestAssetManifestCid: cid,
  };
  if ("tokenId" in identity) patch.activeAssetTokenId = identity.tokenId;
  if ("assetId" in identity) patch.activeAssetId = identity.assetId;
  assetStore.set(patch);
}

/**
 * Root-load tail (scene-loader): the loaded manifest becomes active and is
 * cached as currentManifest. Does NOT touch latestAssetManifestCid — the
 * version-history store's SCENE_READY listener owns the chain tip.
 */
export function activateAssetManifest(cid: string, manifest: any): void {
  assetStore.set({
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(manifest, cid),
  });
}

export function setActiveManifestCid(cid: string | null): void {
  assetStore.set({ activeAssetManifestCid: cid });
}

export function setLatestManifestCid(cid: string | null): void {
  assetStore.set({ latestAssetManifestCid: cid });
}

/**
 * Scene cleared: both CIDs go. Token identity and currentManifest survive
 * (clearScene semantics — preserved verbatim from engine/cleanup.js).
 */
export function clearAssetManifestCids(): void {
  assetStore.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
  });
}

/**
 * Cache a fetched manifest against its CID without changing active/latest
 * (outliner cache fill, no-changes save path).
 */
export function cacheCurrentManifest(manifest: any, cid: string | null): void {
  assetStore.set({ currentManifest: tagManifestCid(manifest, cid) });
}

/**
 * A new version was written to IPFS: it becomes the active + latest tip and
 * the cached current manifest.
 */
export function recordSavedVersion(cid: string, manifest: any): void {
  assetStore.set({
    latestAssetManifestCid: cid,
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(manifest, cid),
  });
}

/**
 * Publish succeeded: the token is now the asset's on-chain identity.
 */
export function adoptPublishedIdentity(
  tokenId: string | number,
  assetId: string
): void {
  assetStore.set({
    activeAssetTokenId: String(tokenId),
    activeAssetId: assetId,
  });
}

// ─── Save/publish commands (Phase 2) ───────────────────────────────
// IO stays in injected deps so the domain module never imports
// services/asset-save/* (which imports this module for the state commands).

/**
 * Name resolution for saves (verbatim from ui/asset-save.js): the in-session
 * rename wins; a tokenized asset falls back to its on-chain name; drafts fall
 * back to "My Asset".
 */
async function _resolveAssetName(
  fetchTokenName: (tokenId: string) => Promise<string | null>
): Promise<string> {
  const current = assetStore.get().activeAssetName;
  if (current) return current;
  const tokenId = assetStore.get().activeAssetTokenId;
  if (tokenId) return (await fetchTokenName(tokenId)) || "My Asset";
  return "My Asset";
}

/**
 * Save the current draft. Builds and uploads the manifest via the injected
 * serializer, updates the URL for non-tokenized drafts, and emits
 * ASSET_DRAFT_SAVED. Returns the serializer's result verbatim; failures
 * propagate to the caller (the UI owns toasts/progress).
 */
export async function saveDraftAsset(deps: {
  saveDraft: (assetName: string, options?: any) => Promise<any>;
  fetchTokenName: (tokenId: string) => Promise<string | null>;
  updateUrlManifest: (cid: string) => void;
}): Promise<any> {
  const assetName = await _resolveAssetName(deps.fetchTokenName);
  const result = await deps.saveDraft(assetName);
  if (!result.ok) return result;

  // Only rewrite the URL for non-tokenized drafts. For tokenized assets, the
  // ?asset=<tokenId> URL already anchors to the blockchain; avoid stashing a
  // draft manifest in query params.
  if (!assetStore.get().activeAssetTokenId) {
    deps.updateUrlManifest(result.cid);
  }
  emit(EVENTS.ASSET_DRAFT_SAVED, { cid: result.cid });
  return result;
}

/**
 * Publish the active asset: save a new version, then anchor it in the
 * collection directory on-chain. All IO is injected; the UI owns dialogs,
 * toasts, and button state. Progress/status hooks fire at the exact legacy
 * points. Collection coordination goes through the injected
 * `publishCollection` dep (services/asset-save/collection-publish.js today;
 * the Collection module in Phase 3).
 * @param assetName - already explicit (UI ran ensureExplicitName)
 */
export async function publishAsset(
  assetName: string,
  wallet: { address: string; chainId: number; contractAddress: string },
  deps: {
    verifyCanEdit: Function;
    saveDraft: Function;
    publishCollection: Function;
    updateUrlAsset: Function;
    onNewCollection?: Function;
    onStatus: Function;
    onProgress: Function;
  }
): Promise<{
  outcome: string;
  tokenId?: string;
  cid?: string;
  isNew?: boolean;
  reason?: string;
}> {
  // Republishes (existing tokenId) snapshot the live comment thread into the
  // manifest via publishContext. First-time publishes have no prior comments.
  const existingTokenId = assetStore.get().activeAssetTokenId;

  // Fail fast on unauthorized republish attempts so the user gets immediate
  // feedback instead of paying for gas on a transaction that will revert.
  if (existingTokenId) {
    await deps.verifyCanEdit(existingTokenId, wallet.address);
  }

  const publishContext = existingTokenId
    ? {
        tokenId: existingTokenId,
        chainId: wallet.chainId,
        contractAddress: wallet.contractAddress,
      }
    : null;

  // Save first: every Besk creates a new draft version, then publishes it.
  deps.onProgress(0.3, "Besking — saving new version to IPFS…");
  const result = await deps.saveDraft(assetName, {
    captureThumbnail: true,
    publishContext,
  });

  if (!result.ok) {
    if (result.reason === "empty") return { outcome: "empty" };
    // A publish request should always anchor the current asset to the
    // collection, even when the asset manifest itself has not changed
    // semantically (e.g. the user already saved the color edit as a draft).
    // The collection manifest still gets a version bump + new prev link.
    if (result.reason !== "no-changes")
      return { outcome: "aborted", reason: result.reason };
  }

  const { cid: assetCid, manifest: publishedManifest } = result;

  // Use the manifest's own asset_id as the collection key for new assets;
  // it is generated from Date.now() at creation time and is unique per draft.
  // For updates to an existing asset, activeAssetId is already set and reused.
  const assetID = deriveDefaultAssetId(
    assetStore.get().activeAssetId,
    publishedManifest?.asset_id || `asset_${Date.now()}`
  );
  log(
    `[PUBLISH] assetID derived | activeAssetId=${
      assetStore.get().activeAssetId
    } manifestAssetId=${publishedManifest?.asset_id} chosen=${assetID}`
  );

  deps.onStatus("Confirm transaction in MetaMask…");
  deps.onProgress(0.6, "Besking — confirm the transaction in your wallet…");

  const { tokenId, isNew } = await deps.publishCollection(
    assetCid,
    assetID,
    wallet.address
  );

  deps.onProgress(0.9, "Besking — finalizing…");
  deps.updateUrlAsset(tokenId);

  if (isNew) {
    // Fire-and-forget: the UI shows success feedback immediately; the panel
    // refresh is a side effect and must not block the published outcome.
    const maybePromise = deps.onNewCollection?.();
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  }

  emit(EVENTS.ASSET_PUBLISHED, {
    tokenId: String(tokenId),
    cid: assetCid,
  });
  return { outcome: "published", tokenId: String(tokenId), cid: assetCid, isNew };
}

/**
 * "Does the open asset have a saved draft that is not published yet?"
 * @remarks Derived, not tracked: true when the latest saved manifest CID
 *   (the chain tip, which survives version-history navigation) differs from
 *   the CID anchored on-chain. A never-published asset with a saved manifest
 *   counts as unpublished. For a tokenized asset whose on-chain CID has not
 *   been fetched yet the answer is false rather than a spurious "Draft".
 *   Deliberately NOT a pending-edit source: it is not "unsaved", so the header
 *   marker and Save dot ignore it. Leave/open guards OR it in explicitly via
 *   hasUnsavedOrUnpublished(). The chrome re-renders on the asset and
 *   version-history store changes that move either CID.
 */
import { getState } from "@arbesk/asset-core/domain/version-history-store.js";
import {
  getActiveAssetTokenId,
  getLatestAssetManifestCid,
} from "@arbesk/asset-core/domain/asset.js";
import { hasUnsavedChanges } from "./unsaved-changes.ts";

export function hasUnpublishedDraft(): boolean {
  const latest = getLatestAssetManifestCid();
  if (!latest) return false;
  const published = getState().publishedCid;
  if (getActiveAssetTokenId() && !published) return false;
  return latest !== published;
}

/** Leave/open guards: edits not yet saved, or a saved draft not yet published. */
export function hasUnsavedOrUnpublished(): boolean {
  return hasUnsavedChanges() || hasUnpublishedDraft();
}

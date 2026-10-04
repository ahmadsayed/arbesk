/**
 * Bottom-bar asset facts: unit-aware dimensions + triangle count.
 * @remarks Renders from the baked `metadata.computed` (no recompute); the
 *   units annotation (pending edits win) drives display. Hidden for drafts
 *   that have never been saved.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState, getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { getPendingAnnotations } from "../services/asset-save/annotations.ts";
import { formatCountCompact, formatDimensions, readUnits } from "../utils/units.ts";

/** Baked `metadata.computed` for the open asset, or null when not showable. */
function currentComputed(): any | null {
  if (!getAssetState().activeAssetManifestCid) return null;
  const computed = (getCurrentManifest() as any)?.metadata?.computed;
  if (!computed?.dimensions) return null;
  if (typeof computed.triangle_count !== "number") return null;
  return computed;
}

/** Pending annotation edits win over the manifest's baked ones. */
function currentAnnotations(): Record<string, unknown> {
  const pending = getPendingAnnotations();
  if (pending) return pending;
  return (getCurrentManifest() as any)?.metadata?.annotations ?? {};
}

function render(): void {
  const el = document.getElementById("bottomBarAssetInfo");
  if (!el) return;
  const computed = currentComputed();
  if (!computed) {
    el.hidden = true;
    return;
  }
  el.textContent =
    `${formatDimensions(computed.dimensions, readUnits(currentAnnotations()))} · ` +
    `${formatCountCompact(computed.triangle_count)} tris`;
  el.hidden = false;
}

export function initBottombarInfo(): void {
  on(EVENTS.ASSET_STATE_CHANGED, render);
  on(EVENTS.SCENE_CLEARED, render);
  render();
}

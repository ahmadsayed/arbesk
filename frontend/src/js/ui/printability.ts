/**
 * On-demand printability check in Properties → Metadata.
 * @remarks Runs the pure edge analysis over the scene's renderable meshes
 *   (in-memory Babylon vertex data — no IPFS reads). The verdict is cached
 *   per manifest CID for the session only; nothing enters the manifest.
 *   In-scene edits never change topology (colour/scale/placement only), so a
 *   cached verdict stays true for its CID.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getAssetState } from "@arbesk/asset-core/domain/asset.js";
import { analyzePrintability } from "../utils/printability.ts";
import type { MeshGeometry, PrintabilityReport } from "../utils/printability.ts";
import { getRenderableMeshes } from "../engine/transforms.ts";
import { state as engineState } from "../engine/state.ts";
import { showToast } from "./toasts.ts";

const cache = new Map<string, PrintabilityReport>();

function btn(): HTMLButtonElement | null {
  return document.getElementById("printCheckBtn") as HTMLButtonElement | null;
}
function badge(): HTMLElement | null {
  return document.getElementById("printBadge");
}

/**
 * Pull positions/indices from the live scene.
 * @remarks The only Babylon-touching function in the module: `state.scene`
 *   is null until the engine boots. `"position"` is the literal value of
 *   Babylon's `VertexBuffer.PositionKind`, so the CDN global is never named.
 */
function collectGeometry(): MeshGeometry[] {
  const scene = engineState.scene;
  if (!scene) return [];
  return getRenderableMeshes(scene.meshes)
    .filter((m: any) => !m.metadata?.isViewportChrome)
    .map((m: any) => ({
      positions: m.getVerticesData("position"),
      indices: m.getIndices() ?? [],
    }))
    .filter((g: MeshGeometry) => g.positions && g.indices.length > 0);
}

function renderBadge(report: PrintabilityReport | null): void {
  const b = badge();
  if (!b) return;
  if (!report) {
    b.hidden = true;
    b.textContent = "";
    return;
  }
  b.hidden = false;
  b.classList.toggle("print-badge-ok", report.manifold);
  b.classList.toggle("print-badge-warn", !report.manifold);
  b.textContent = report.manifold
    ? "Print-ready"
    : `Not watertight · ${report.openEdges} open edges`;
}

function syncVisibility(): void {
  const cid = getAssetState().activeAssetManifestCid;
  const b = btn();
  if (b) b.hidden = !cid;
  renderBadge((cid && cache.get(cid)) || null);
}

function runCheck(): void {
  const cid = getAssetState().activeAssetManifestCid;
  if (!cid) return;
  const report = analyzePrintability(collectGeometry());
  cache.set(cid, report);
  renderBadge(report);
  showToast({
    type: report.manifold ? "success" : "warning",
    title: report.manifold ? "Print-ready" : "Not watertight",
    message: report.manifold
      ? `${report.triangleCount.toLocaleString("en-US")} triangles, fully closed.`
      : `${report.openEdges} open edges across ${report.triangleCount.toLocaleString("en-US")} triangles.`,
  });
}

export function initPrintability(): void {
  btn()?.addEventListener("click", runCheck);
  on(EVENTS.ASSET_STATE_CHANGED, syncVisibility);
  on(EVENTS.SCENE_CLEARED, () => {
    cache.clear();
    renderBadge(null);
    syncVisibility();
  });
  syncVisibility();
}

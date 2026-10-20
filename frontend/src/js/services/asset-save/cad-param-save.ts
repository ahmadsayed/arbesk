/**
 * Save step for CAD parameter edits: the previewed 3MF becomes the node's new
 * source, with the edited values in its design sidecar.
 * @remarks Runs before the source-colour bake (manifest-builder), so a pending
 *   Studio colour edit lands on the new source. Colours an earlier Studio bake
 *   put on the old source are re-applied by part name; a part the script
 *   colours with color() keeps the script's colour. No kernel run happens
 *   here: the bytes are the last successful preview render.
 */
import type { CadDesign } from "@arbesk/cad-gen";
import { resolveFormatHandler } from "../../formats/index.ts";
import type { FormatSaveContext } from "../../formats/registry.ts";
import { writeToIPFS } from "../../ipfs/write-to-ipfs.ts";
import { showToast } from "../../ui/toasts.ts";
import { cadPartIndex, clearCadParamEdits, getPendingCadParamEdits } from "../../state/cad-param-edits.ts";
import type { CadParamEdit } from "../../state/cad-param-edits.ts";
import { setCadParamBase, whenCadPreviewsSettled } from "../cad-param-preview.ts";

/** Runs any queued preview render, then snapshots the pending edits. */
export async function settledCadParamEdits(): Promise<Map<string, CadParamEdit>> {
  await whenCadPreviewsSettled();
  return new Map(getPendingCadParamEdits());
}

/** "Parameters: width 60→80 mm, lid #d33a2c→#2c7ad3" — the version's change note. */
function changeSummary(saved: CadDesign, design: CadDesign): string {
  const changes = Object.entries(design.parameters).flatMap(([name, p]) => {
    const before = saved.parameters[name]?.value;
    if (before === p.value) return [];
    return [name + " " + before + "→" + p.value + (p.type === "color" ? "" : " mm")];
  });
  return "Parameters: " + changes.join(", ");
}

/**
 * Splits the old source's baked colours into those to re-apply and the part
 * names the new model no longer has.
 */
function carriedColors(baked: Record<string, string>, edit: CadParamEdit) {
  const partColors = edit.partColors ?? [];
  const keep: Record<string, string> = {};
  const reset: string[] = [];
  for (const [name, hex] of Object.entries(baked)) {
    const index = cadPartIndex(name);
    if (index === null || index >= partColors.length) reset.push(name);
    else if (!partColors[index]) keep[name] = hex;
  }
  return { keep, reset };
}

async function reapplyBakedColors(
  node: any,
  baked: Record<string, string>,
  edit: CadParamEdit,
  ctx: FormatSaveContext,
): Promise<void> {
  const { keep, reset } = carriedColors(baked, edit);
  if (Object.keys(keep).length > 0) {
    const result = await resolveFormatHandler(node.source).editSourceColors!(node, keep, ctx);
    node.source = { cid: result.sourceCid, path: result.path ?? node.source.path, format: result.format ?? "3mf" };
  }
  if (reset.length > 0) {
    showToast({
      type: "warning",
      title: "Colours reset",
      message: `Colours reset on ${reset.join(", ")} (the part count changed).`,
    });
  }
}

/** Uploads one node's previewed 3MF and points the node at it. */
async function saveOne(manifest: any, node: any, edit: CadParamEdit, ctx: FormatSaveContext): Promise<CadDesign> {
  const { withDesign } = await import("@arbesk/cad-gen");
  const { readSourceColors } = await import("@arbesk/asset-core/formats/3mf/color-editor.js");
  const baked = await readSourceColors(node.source.cid).catch(() => ({}));
  const design = { ...edit.design, summary: changeSummary(edit.savedDesign, edit.design) };
  const rawCid = await writeToIPFS(withDesign(edit.bytes!, design), "asset.3mf");
  const raw = { cid: rawCid, path: "asset.3mf", format: "3mf" };
  const stored = await resolveFormatHandler(raw).decomposeForSave!({ ...node, source: raw }, ctx);
  if (!stored) throw new Error(`[CAD-SAVE] 3MF decomposition produced no CID | node=${node.node_id}`);
  node.source = { cid: stored.cid, path: stored.path, format: stored.format ?? "3mf" };
  await reapplyBakedColors(node, baked, edit, ctx);
  if (edit.stats?.bboxMm && manifest.metadata?.cad) {
    manifest.metadata.cad.stats = { triangles: edit.stats.triangles ?? 0, bboxMm: edit.stats.bboxMm };
  }
  return design;
}

/**
 * Writes every pending parameter edit into its node's source.
 * @returns the saved design per node (for finishCadParameterSave).
 * @throws Error when an edit has no successful preview; nothing is written.
 */
export async function applyCadParameterEdits(
  manifest: any,
  pending: Map<string, CadParamEdit>,
  ctx: FormatSaveContext,
): Promise<Map<string, CadDesign>> {
  for (const edit of pending.values()) {
    if (edit.status !== "ok" || !edit.bytes) throw new Error("CAD parameters have no successful preview");
  }
  const saved = new Map<string, CadDesign>();
  for (const [nodeId, edit] of pending) {
    const node = manifest.scene.nodes.find((n: any) => n.node_id === nodeId);
    if (node?.source?.cid) saved.set(nodeId, await saveOne(manifest, node, edit, ctx));
  }
  return saved;
}

/** After the manifest is written: the saved designs become the new base. */
export function finishCadParameterSave(saved: Map<string, CadDesign>): void {
  if (saved.size === 0) return;
  for (const [nodeId, design] of saved) setCadParamBase(nodeId, design);
  clearCadParamEdits([...saved.keys()]);
}

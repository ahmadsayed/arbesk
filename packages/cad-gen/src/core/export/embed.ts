/**
 * The design sidecar inside an exported part. It makes a stateless sourceRef
 * lossless and lets attribution be recomputed from the code at any time.
 */
import type { CadDesign } from "../../types.ts";
import { parseDesign } from "../document.ts";

export const SIDECAR_PART_PATH = "Metadata/arbesk_cad.json";

export const SIDECAR_REL_TYPE = "https://arbesk.io/3mf/cad-design";

export function serializeDesign(design: CadDesign): string {
  return JSON.stringify({
    arbesk_cad: 1,
    code: design.code,
    parameters: design.parameters,
    summary: design.summary,
    ...(design.turn ? { turn: design.turn } : {}),
  }, null, 2);
}

/** null when absent or unusable (SOURCE_ASSET_UNSUPPORTED_FORMAT). */
export function parseEmbeddedDesign(json: unknown): CadDesign | null {
  try {
    return parseDesign(json);
  } catch {
    return null;
  }
}

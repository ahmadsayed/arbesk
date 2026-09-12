/**
 * Design-document sidecar: read and write the design inside the artifact.
 * @remarks This is what makes a stateless sourceRef lossless (spec section 7):
 *   any CID of a generated part round-trips the whole design document, so the
 *   server needs no design-session storage.
 *
 *   It is also what makes the LICENCE credit survive. Attribution is computed
 *   from the code by core/attribution.ts, and the code travels here, so a part
 *   opened a year later is credited by the same pure function the server used -
 *   there is no stored copy to go stale, and no way for the two to disagree.
 */
import type { CadDesign } from "../../types.ts";
import { parseDesign } from "../document.ts";

/** OPC part path carrying the design inside a .3mf package. */
export const SIDECAR_PART_PATH = "Metadata/arbesk_cad.json";

/** Relationship type for that part. */
export const SIDECAR_REL_TYPE = "https://arbesk.io/3mf/cad-design";

/** Serialises a design for embedding. */
export function serializeDesign(design: CadDesign): string {
  return JSON.stringify({
    arbesk_cad: 1,
    code: design.code,
    parameters: design.parameters,
    summary: design.summary,
    ...(design.turn ? { turn: design.turn } : {}),
  }, null, 2);
}

/**
 * Parses an embedded design.
 * @returns null when the payload is absent or unusable, which callers translate
 *   into SOURCE_ASSET_UNSUPPORTED_FORMAT.
 */
export function parseEmbeddedDesign(json: unknown): CadDesign | null {
  try {
    return parseDesign(json);
  } catch {
    return null;
  }
}

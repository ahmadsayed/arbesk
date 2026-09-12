/** CAD exporters - environment-agnostic; the browser uses these too. */
export { meshToGlb } from "./glb.ts";
export { meshTo3mf, readDesignFrom3mf } from "./three-mf.ts";
export {
  SIDECAR_PART_PATH, SIDECAR_REL_TYPE, serializeDesign, parseEmbeddedDesign,
} from "./embed.ts";

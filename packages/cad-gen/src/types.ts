/** Port + shared types for @arbesk/cad-gen. No runtime code here. */

/** One named, user-editable dimension baked into the design's PARAMETERS block. */
export interface CadParameter {
  value: number;
  unit: "mm";
  min?: number;
  max?: number;
  label?: string;
}

export type CadParameterMap = Record<string, CadParameter>;

/** The design document: the artifact the model returns and the client executes. */
export interface CadDesign {
  /** Body of a function taking (PARAMETERS, ...preludeHelpers, M) that returns a Manifold. */
  code: string;
  parameters: CadParameterMap;
  /** Human-readable change note for provenance. */
  summary: string;
  /** 1-based turn index in the conversation. */
  turn?: number;
}

/** Geometry facts computed from a validated mesh. */
export interface CadStats {
  triangles: number;
  vertices: number;
  volumeMm3: number;
  bboxMm: {
    min: [number, number, number];
    max: [number, number, number];
  };
  /** Which fillet strategy actually ran (see the spec's fidelity table). */
  filletMode?: "exact" | "minkowski" | "smooth";
}

/** Renderer-neutral mesh in Manifold coordinates (millimetres, Z-up). */
export interface CadMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Token accounting for one LLM call. */
export interface TokenUsage {
  prompt: number;
  completion: number;
}

/**
 * The Manifold module the kernel needs, injected by the host.
 * @remarks Deliberately untyped past this boundary: the module is Emscripten
 *   WASM output whose API is described by manifold.d.ts, and mirroring it here
 *   would mean maintaining a second, drifting copy of an external surface.
 *   Verified against manifold-3d 3.5.3.
 */
export interface ManifoldModule {
  Manifold: any;
  CrossSection: any;
}

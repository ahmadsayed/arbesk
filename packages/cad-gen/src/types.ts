/** Port + shared types for @arbesk/cad-gen. No runtime code here. */

/** One named, user-editable dimension baked into the design's PARAMETERS block. */
export interface CadLengthParameter {
  /** Absent on designs written before colour parameters. */
  type?: "length";
  value: number;
  unit: "mm";
  min?: number;
  max?: number;
  label?: string;
}

/** One named, user-editable colour; the script passes it to color(). */
export interface CadColorParameter {
  type: "color";
  /** Lowercase "#rrggbb" once parsed. */
  value: string;
  label?: string;
}

export type CadParameter = CadLengthParameter | CadColorParameter;

export type CadParameterMap = Record<string, CadParameter>;

/** The design document: the artifact the model returns and the client executes. */
export interface CadDesign {
  /** Body of a function taking (PARAMETERS, ...preludeHelpers, M) that returns a Manifold. */
  code: string;
  parameters: CadParameterMap;
  summary: string;
  /** 1-based. */
  turn?: number;
}

export interface CadStats {
  triangles: number;
  vertices: number;
  volumeMm3: number;
  bboxMm: {
    min: [number, number, number];
    max: [number, number, number];
  };
  filletMode?: "exact" | "minkowski" | "smooth";
  filletQuality?: "draft" | "high";
  /** Separate bodies with their bounds (largest first, capped), so a repair can name the loose one. */
  bodies?: {
    count: number;
    /** `part` is the 1-based part a body belongs to; set for array returns only. */
    boxes: { min: [number, number, number]; max: [number, number, number]; part?: number }[];
  };
  /** Sealed cavities: negative-volume components, failed by the sealed gate, never counted as bodies. */
  voids?: {
    count: number;
    boxes: { min: [number, number, number]; max: [number, number, number]; part?: number }[];
  };
  /** See DEGENERATE_BODY_MM3. */
  degenerateBodiesDropped?: number;
  /** Array returns are never unioned; overlaps between parts are recorded, never failed. */
  parts?: {
    count: number;
    array: boolean;
    boxes: { min: [number, number, number]; max: [number, number, number] }[];
    bodyCounts: number[];
    overlaps?: { a: number; b: number; volumeMm3: number }[];
    overlapCount?: number;
  };
}

/** Renderer-neutral mesh in Manifold coordinates (millimetres, Z-up). */
export interface CadMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** Lowercase "#rrggbb" when the script tagged this part with color(). */
  color?: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}

/** Untyped past this boundary: manifold.d.ts describes it, so there is no second copy here. */
export interface ManifoldModule {
  Manifold: any;
  CrossSection: any;
  /** Module-level, not static on Manifold as manifold.d.ts implies; optional for bare modules. */
  setMinCircularAngle?: (angle: number) => void;
  setMinCircularEdgeLength?: (length: number) => void;
  setCircularSegments?: (segments: number) => void;
}

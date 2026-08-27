/** Port + config types for @arbesk/ai-asset-gen. No runtime code here. */

export type GenerationCapability =
  | "text-to-3d"
  | "image-to-3d"
  | "multiview-to-3d"
  | "retexture"
  | "retopo"
  | "rig-check"
  | "rig"
  | "animate"
  | "balance";

/** A source model/image for a follow-up op. Tripo wants a file_token; mock
 *  reads local files; the caller only hands the facade one of these. */
export type SourceRef =
  | { kind: "fileToken"; fileToken: string }
  | { kind: "buffer"; buffer: Uint8Array; mime: string }
  | { kind: "cid"; cid: string };

export type MultiviewView = "front" | "left" | "back" | "right";

export interface MultiviewImage {
  view: MultiviewView;
  image: Uint8Array;
  mime: string;
}

export type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled";

export interface GenerationStatus {
  status: TaskStatus;
  progress?: number;
  /** Signed model URL on success — hand to download(). */
  glbUrl?: string;
  /** Output format, e.g. "glb" | "gltf" | "3mf". */
  format?: string;
  /** Provider-specific payload (e.g. rig-check {riggable, rig_type}). */
  output?: unknown;
  error?: string;
}

export interface GenerationBalance {
  balance: number;
  frozen: number;
}

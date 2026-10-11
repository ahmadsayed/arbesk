/**
 * @arbesk/ai-asset-gen facade — createGenerationProvider: a capability-gated
 *   facade over the mock and Tripo3D providers.
 * @remarks Every method checks the provider's declared capability set first, so
 *   callers branch on capability rather than provider kind.
 */
import type {
  GenerationBalance,
  GenerationCapability,
  GenerationStatus,
  MultiviewImage,
  SourceRef,
} from "./types.ts";
import type { CadDesign } from "@arbesk/cad-gen";
import { createMockProvider } from "./providers/mock-provider.ts";
import { createTripoProvider } from "./providers/tripo-provider.ts";
import { createProviderRegistry } from "./registry.ts";

/**
 * Per-request generation options forwarded to providers that honor them
 * (Tripo3D). Mock/CAD providers ignore the extras.
 */
export interface GenerationTaskOptions {
  /** One of the provider's texture quality levels ("fast" needs the v3.5
   *  texture model). */
  textureQuality?: string;
  /** Geometry model override (e.g. a P-series id); provider default when
   *  omitted. */
  model?: string;
  /** Texture model line; "v3.5-20260815" enables texture_quality "fast" and
   *  the delight flag. */
  textureVersion?: string;
  /** Strip baked-in lighting (only meaningful with the v3.5 texture model). */
  delight?: boolean;
  /** Target face budget for the generated mesh (generation calls only). */
  faceLimit?: number;
}

/** Retexture takes the texture-side options only — geometry stays untouched. */
export type RetextureTaskOptions = Pick<
  GenerationTaskOptions,
  "textureQuality" | "textureVersion" | "delight"
>;

export interface GenerationProvider {
  readonly id: string;
  /** Declared capabilities — the single source of truth. */
  readonly capabilities: ReadonlySet<GenerationCapability>;
  /** Pre-check helper — cleaner than try/catch for a 400. */
  can(capability: GenerationCapability): boolean;

  // ── fresh generation → provider taskId ──────────────────────────────────
  textToModel(input: { prompt: string; priorDesign?: CadDesign } & GenerationTaskOptions): Promise<string>;
  imageToModel(input: { image: Uint8Array; mime: string } & GenerationTaskOptions): Promise<string>;
  multiviewToModel(input: { views: MultiviewImage[] } & GenerationTaskOptions): Promise<string>;

  // ── follow-ups (source-based) → provider taskId ─────────────────────────
  /**
   * Uploads a model SourceRef, returning a provider source handle.
   * @remarks A multi-step chain (rig-check → rig) uploads once and reuses.
   */
  uploadSource(source: SourceRef): Promise<string>;
  retexture(input: { prompt: string; source: SourceRef } & RetextureTaskOptions): Promise<string>;
  retopo(input: { source: SourceRef; faceLimit?: number; quad?: boolean }): Promise<string>;
  rigCheck(input: { source: SourceRef }): Promise<string>;
  rig(input: { source: SourceRef; rigType?: string; model?: string }): Promise<{ taskId: string; model: string }>;
  animate(input: { rigTaskId: string; animations: string[]; animateInPlace?: boolean; rigModel?: string }): Promise<string>;

  // ── uniform lifecycle ───────────────────────────────────────────────────
  poll(taskId: string): Promise<GenerationStatus>;
  /** Download by taskId OR signed URL (auto-detected). */
  download(taskIdOrUrl: string): Promise<Uint8Array>;
  cancel(taskId: string): Promise<boolean>;

  // ── optional meta ───────────────────────────────────────────────────────
  getBalance(): Promise<GenerationBalance>;
}

export interface GenerationConfig {
  id: string;
  /** BYOK key — Tripo3D; undefined for mock (no key, no credits). */
  apiKey?: string;
  /** Resolves a SourceRef {cid} to raw model bytes (asset-core + storage). */
  sourceResolver?: (cid: string) => Promise<Uint8Array>;
  capabilities: GenerationCapability[];
}

const defaultRegistry = createProviderRegistry({
  mock: (config) => createMockProvider(config),
  tripo3d: (config) => createTripoProvider(config),
});

export function createGenerationProvider(config: GenerationConfig): GenerationProvider {
  return defaultRegistry.resolve(config.id, config);
}

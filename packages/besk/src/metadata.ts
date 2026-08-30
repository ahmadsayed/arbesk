/**
 * Shared CLI/MCP metadata operations. Pure helpers (no imports) + read/write
 * ops that reach catalog lazily so tests can import the pure half in isolation.
 */
import type { Session } from "./session.ts";

/* ---- pure helpers ---- */

export function parseJsonValue(raw: string): unknown {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export function patchFromPairs(keys: string[], values: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const n = Math.min(keys.length, values.length);
  for (let i = 0; i < n; i++) patch[keys[i]] = parseJsonValue(values[i]);
  return patch;
}

export function getComputed(manifest: any): Record<string, unknown> | null {
  return (manifest?.metadata?.computed ?? null) as Record<string, unknown> | null;
}

export function getAnnotations(manifest: any): Record<string, unknown> {
  return (manifest?.metadata?.annotations ?? {}) as Record<string, unknown>;
}

export function setAnnotations(manifest: any, patch: Record<string, unknown>): void {
  manifest.metadata ??= {};
  manifest.metadata.annotations = { ...(manifest.metadata.annotations ?? {}), ...patch };
}

export function unsetAnnotations(manifest: any, keys: string[]): void {
  if (!manifest?.metadata?.annotations) return;
  for (const k of keys) delete manifest.metadata.annotations[k];
}

/* ---- read/write ops (lazy catalog import) ---- */

export async function getAssetMetadata(session: Session, cid: string) {
  const { getManifest } = await import("./catalog.ts");
  const m = (await getManifest(cid)) as Record<string, any>;
  return { computed: getComputed(m), annotations: getAnnotations(m) };
}

export async function getCollectionMetadata(session: Session, tokenId: string) {
  const { getCollectionManifest } = await import("./catalog.ts");
  const { manifest } = await getCollectionManifest(tokenId);
  return { annotations: getAnnotations(manifest) };
}

// Write ops are wired by the Task 5 set/unset dispatchers (CLI + MCP); shipped
// now so the shared module covers both read and write sides.
export async function setAssetMetadata(
  session: Session,
  tokenId: string,
  assetID: string,
  cid: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const { getManifest, writeManifest, updateCollection } = await import("./catalog.ts");
  const m = (await getManifest(cid)) as Record<string, any>;
  setAnnotations(m, patch);
  m.prev_asset_manifest_cid = cid;
  m.version = (m.version || 0) + 1;
  m.timestamp = Date.now();
  const newCid = await writeManifest(m);
  await updateCollection(session, tokenId, (draft: Record<string, any>) => {
    draft.assets[assetID] = newCid;
  });
  return newCid;
}

export async function unsetAssetMetadata(
  session: Session,
  tokenId: string,
  assetID: string,
  cid: string,
  keys: string[],
): Promise<string> {
  const { getManifest, writeManifest, updateCollection } = await import("./catalog.ts");
  const m = (await getManifest(cid)) as Record<string, any>;
  unsetAnnotations(m, keys);
  m.prev_asset_manifest_cid = cid;
  m.version = (m.version || 0) + 1;
  m.timestamp = Date.now();
  const newCid = await writeManifest(m);
  await updateCollection(session, tokenId, (draft: Record<string, any>) => {
    draft.assets[assetID] = newCid;
  });
  return newCid;
}

export async function setCollectionMetadata(
  session: Session,
  tokenId: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const { updateCollection } = await import("./catalog.ts");
  return updateCollection(session, tokenId, (draft: Record<string, any>) =>
    setAnnotations(draft, patch),
  );
}

export async function unsetCollectionMetadata(
  session: Session,
  tokenId: string,
  keys: string[],
): Promise<string> {
  const { updateCollection } = await import("./catalog.ts");
  return updateCollection(session, tokenId, (draft: Record<string, any>) =>
    unsetAnnotations(draft, keys),
  );
}

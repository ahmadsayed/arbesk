/**
 * Unpublished drafts for the IPFS GC.
 * @remarks A Studio draft (Save draft, Show in Studio, a CAD or Tripo
 *   generation) is an asset manifest written to IPFS from the browser; only
 *   Publish puts it on-chain, and the server never learns its CID. So the GC
 *   treats every pinned asset manifest that no live token reaches as a draft
 *   root and keeps it - with everything it refers to - for a retention period
 *   counted from the run that first saw it. Each save writes a new manifest
 *   with its own clock, so a draft lives that long past its last save. An
 *   asset deleted from its collection is kept the same way, as an undo window.
 */

import type { DraftKind } from "./ipfs-gc-ref-cache.ts";
import { maybeDecompress } from "./ipfs-utils.ts";
import { isCompressedHead, sniffSourceKind } from "./source-sniff.ts";
import type { StorageAdapter } from "./storage/index.ts";

/** Default retention: drafts are kept 90 days after their last save. */
const DEFAULT_DRAFT_RETENTION_DAYS = 90;

const DAY_MS = 24 * 3600000;
const SNIFF_BYTES = 1024;
/** Unreferenced files checked at once (each is a gateway round trip). */
const CHECK_CONCURRENCY = 5;

/**
 * Retention from `options` (ms), else IPFS_GC_DRAFT_RETENTION_DAYS, else
 * 90 days. 0 turns draft protection off.
 */
export function resolveDraftRetentionMs(retentionMs: number | undefined): number {
  if (retentionMs !== undefined) return Number(retentionMs);
  // A blank line (`IPFS_GC_DRAFT_RETENTION_DAYS=`, as in .env.example) is
  // unset - Number("") would be 0 and silently turn draft protection off.
  const raw = process.env.IPFS_GC_DRAFT_RETENTION_DAYS?.trim();
  const days = raw ? Number(raw) : DEFAULT_DRAFT_RETENTION_DAYS;
  return (Number.isFinite(days) && days >= 0 ? days : DEFAULT_DRAFT_RETENTION_DAYS) * DAY_MS;
}

/**
 * True for an asset manifest: a scene with a node list, and not a collection.
 * @remarks A composite glTF has a numeric `scene` (and `scenes`), a 3MF
 *   composite or CAD design has no scene, so neither counts.
 */
export function isAssetManifest(json: any): boolean {
  if (!json || typeof json !== "object" || json.type === "collection") return false;
  return Array.isArray(json.scene?.nodes);
}

/** A parsed draft root: its CID and the manifest it continues, if any. */
export interface DraftRoot {
  cid: string;
  prev: string | null;
}

/** Where the draft check of each CID is remembered (the GC's ref cache). */
export interface DraftKindCache {
  getKind(cid: string): DraftKind | undefined;
  setKind(cid: string, kind: DraftKind): void;
}

const NOT_A_DRAFT: DraftKind = { draft: false };

/** What a file's parsed text says: an asset manifest is a draft root. */
function kindOf(text: string): DraftKind {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return NOT_A_DRAFT;
  }
  if (!isAssetManifest(json)) return NOT_A_DRAFT;
  const prev = json.prev_asset_manifest_cid;
  return { draft: true, prev: typeof prev === "string" && prev ? prev : null };
}

/**
 * Checks one unreferenced file: is it a draft root?
 * @returns its kind and whether that answer may be remembered, or null when
 *   the file could not be read
 * @remarks Downloads it in full only when its first bytes are JSON (or the
 *   peek fails, or the backend cannot peek). A compressed file whose prefix
 *   is not recognisably JSON is not a draft this run but is checked again.
 */
async function checkOrphan(
  cid: string,
  storage: StorageAdapter,
): Promise<{ kind: DraftKind; remember: boolean } | null> {
  if (storage.catHead) {
    try {
      const head = await storage.catHead(cid, SNIFF_BYTES);
      const sniffed = sniffSourceKind(head);
      if (sniffed === "binary") return { kind: NOT_A_DRAFT, remember: true };
      if (sniffed === "unknown") return { kind: NOT_A_DRAFT, remember: !isCompressedHead(head) };
    } catch {
      // Fall through to a full read.
    }
  }
  try {
    return { kind: kindOf(await maybeDecompress(await storage.catBytes(cid))), remember: true };
  } catch {
    return null;
  }
}

/**
 * The asset manifests among `orphans` (pinned CIDs no live token reaches).
 * @returns the draft roots, and the files that could not be read (which may
 *   be drafts: the caller must not unpin anything young enough to be one)
 * @remarks Answers are remembered in `cache` by CID - content-addressed, so
 *   each file is checked once, ever.
 */
export async function findDraftRoots(
  orphans: string[],
  storage: StorageAdapter,
  cache: DraftKindCache,
): Promise<{ roots: DraftRoot[]; unreadable: string[] }> {
  const roots: DraftRoot[] = [];
  const unreadable: string[] = [];
  const toCheck: string[] = [];
  for (const cid of orphans) {
    const known = cache.getKind(cid);
    if (!known) toCheck.push(cid);
    else if (known.draft) roots.push({ cid, prev: known.prev });
  }
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < toCheck.length) {
      const cid = toCheck[next++];
      const checked = await checkOrphan(cid, storage);
      if (!checked) {
        unreadable.push(cid);
        continue;
      }
      if (checked.remember) cache.setKind(cid, checked.kind);
      if (checked.kind.draft) roots.push({ cid, prev: checked.kind.prev });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, toCheck.length) }, worker));
  return { roots, unreadable };
}

/**
 * Starts or keeps each draft root's clock and splits the roots by it.
 * @param previous draftSince from the last recorded run
 * @returns draftSince for the current roots only (a published or unpinned
 *   draft drops out), the roots still within retention, and the draft tips
 *   among those (roots no other kept root continues) for reporting
 * @remarks The clock is kept apart from orphanSince: a kept draft is
 *   reachable, which would restart its orphan clock on every run.
 */
export function trackDrafts(
  roots: DraftRoot[],
  previous: Record<string, number>,
  now: number,
  retentionMs: number,
): { draftSince: Record<string, number>; kept: string[]; tips: string[] } {
  const draftSince: Record<string, number> = {};
  for (const { cid } of roots) draftSince[cid] = previous[cid] ?? now;
  const keptRoots = roots.filter(({ cid }) => now - draftSince[cid] < retentionMs);
  const continued = new Set(keptRoots.map((root) => root.prev).filter(Boolean));
  return {
    draftSince,
    kept: keptRoots.map((root) => root.cid),
    tips: keptRoots.filter((root) => !continued.has(root.cid)).map((root) => root.cid),
  };
}

/**
 * The IPFS GC's persistent source reference cache (.data/ipfs-gc-ref-cache.json).
 * @remarks Maps a source CID to the IPFS CIDs it references, as the manifest
 *   walk learned them. IPFS content is immutable, so an entry never goes
 *   stale; keeping them across runs saves re-downloading every source each
 *   night (~1 GB on promptscad.com, mostly binary GLB/3MF files read only to
 *   find they reference nothing).
 */

import fs from "fs";
import path from "path";
import type { SourceRefCache } from "./manifest-chain-walker.ts";

/** Whether a pinned file no live token reaches is an unpublished draft root
 * (an asset manifest, with the version it continues) - see ipfs-gc-drafts.ts. */
export type DraftKind = { draft: false } | { draft: true; prev: string | null };

export interface GCRefCache extends SourceRefCache {
  /** Sources answered from the cache this run. */
  readonly hits: number;
  /** Sources read from storage (and learned) this run. */
  readonly learned: number;
  getKind(cid: string): DraftKind | undefined;
  setKind(cid: string, kind: DraftKind): void;
  /** Writes the references of `keepRefs` (the reachable set) and the draft
   * kinds of `keepKinds` (the pinned set), and drops the rest. */
  save(keepRefs: Set<string>, keepKinds: Set<string>): void;
}

/**
 * Bumped whenever what counts as a reference changes, so entries learned by
 * an older walk are dropped. v2: bare CIDs too - v1 (unversioned) recorded []
 * for every 3MF composite, whose parts are bare CIDs.
 */
const CACHE_VERSION = 2;

function readEntries(saved: unknown, into: Map<string, string[]>): void {
  for (const [cid, refs] of Object.entries(saved || {})) {
    if (Array.isArray(refs)) into.set(cid, refs.map(String));
  }
}

function readKinds(saved: unknown, into: Map<string, DraftKind>): void {
  for (const [cid, kind] of Object.entries(saved || {})) {
    if (typeof (kind as DraftKind)?.draft === "boolean") into.set(cid, kind as DraftKind);
  }
}

/** The saved references and draft kinds; empty when missing, corrupt or older. */
function readCacheFile(file: string): { entries: Map<string, string[]>; kinds: Map<string, DraftKind> } {
  const entries = new Map<string, string[]>();
  const kinds = new Map<string, DraftKind>();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (parsed?.version === CACHE_VERSION) {
        readEntries(parsed.entries, entries);
        readKinds(parsed.kinds, kinds);
      }
    }
  } catch {
    console.warn("[GC] source ref cache unreadable - every source is read again");
  }
  return { entries, kinds };
}

/** Loads the cache at `file`; a missing, corrupt or older file starts empty. */
export function loadRefCache(file: string): GCRefCache {
  const { entries, kinds } = readCacheFile(file);

  let hits = 0;
  let learned = 0;
  return {
    get hits() {
      return hits;
    },
    get learned() {
      return learned;
    },
    get(cid) {
      const refs = entries.get(cid);
      if (refs) hits++;
      return refs;
    },
    set(cid, refs) {
      entries.set(cid, refs);
      learned++;
    },
    getKind(cid) {
      return kinds.get(cid);
    },
    setKind(cid, kind) {
      kinds.set(cid, kind);
    },
    save(keepRefs, keepKinds) {
      const keptRefs: Record<string, string[]> = {};
      for (const [cid, refs] of entries) if (keepRefs.has(cid)) keptRefs[cid] = refs;
      const keptKinds: Record<string, DraftKind> = {};
      for (const [cid, kind] of kinds) if (keepKinds.has(cid)) keptKinds[cid] = kind;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, entries: keptRefs, kinds: keptKinds }));
      fs.renameSync(tmp, file);
    },
  };
}

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

export interface GCRefCache extends SourceRefCache {
  /** Sources answered from the cache this run. */
  readonly hits: number;
  /** Sources read from storage (and learned) this run. */
  readonly learned: number;
  /** Writes the entries for `keep` (the reachable set) and drops the rest. */
  save(keep: Set<string>): void;
}

/** Loads the cache at `file`; a missing or corrupt file starts empty. */
export function loadRefCache(file: string): GCRefCache {
  const entries = new Map<string, string[]>();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      for (const [cid, refs] of Object.entries(parsed ?? {})) {
        if (Array.isArray(refs)) entries.set(cid, refs.map(String));
      }
    }
  } catch {
    console.warn("[GC] source ref cache unreadable - every source is read again");
  }

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
    save(keep) {
      const kept: Record<string, string[]> = {};
      for (const [cid, refs] of entries) if (keep.has(cid)) kept[cid] = refs;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(kept));
      fs.renameSync(tmp, file);
    },
  };
}

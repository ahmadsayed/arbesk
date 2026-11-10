/**
 * Where the next Studio save of an asset appends: the real chain tip.
 * @remarks The in-memory tip (`latestAssetManifestCid`) is set when the asset
 *   is opened and on every Studio save, but nothing moves it when another
 *   client writes the asset meanwhile (a `besk attach`, a `besk rename`). A
 *   save that appended to the stale tip would fork the chain and drop what
 *   the other client wrote (its representations, spec R3). So the save also
 *   reads the asset's collection entry and takes it when it descends from the
 *   in-memory tip. An entry that is older (a published version a Studio draft
 *   follows) or on another branch leaves the in-memory tip in place.
 */

/** Reads the chain needs; injected so the walk is testable without IPFS. */
export interface ChainTipDeps {
  /** The asset's current collection entry CID, or null (none, or unreadable). */
  readEntryCid: () => Promise<string | null>;
  /** One manifest by CID; may throw. */
  readManifest: (cid: string) => Promise<any>;
}

/** How many versions back an entry may sit above the in-memory tip. */
const MAX_STEPS = 16;

function versionNumber(manifest: any): number | null {
  const version = Number(manifest?.version);
  return Number.isFinite(version) ? version : null;
}

/** The previous version's CID, or null at the start of the chain. */
function prevOf(manifest: any): string | null {
  const prev: unknown = manifest?.prev_asset_manifest_cid;
  return typeof prev === "string" && prev ? prev : null;
}

/** Whether a version is no newer than the ancestor (the walk can stop). */
function notNewer(manifest: any, ancestorVersion: number | null): boolean {
  const version = versionNumber(manifest);
  return ancestorVersion !== null && version !== null && version <= ancestorVersion;
}

/**
 * Whether `cid` reaches `ancestor` through `prev_asset_manifest_cid`.
 * @remarks Stops early once the walk reaches a version no newer than the
 *   ancestor's, so an entry older than the tip costs one read.
 */
async function descendsFrom(cid: string, ancestor: string, ancestorVersion: number | null, deps: ChainTipDeps): Promise<boolean> {
  let current: string | null = cid;
  for (let step = 0; current !== null && current !== ancestor && step < MAX_STEPS; step++) {
    const manifest = await deps.readManifest(current);
    current = notNewer(manifest, ancestorVersion) ? null : prevOf(manifest);
  }
  return current === ancestor;
}

/**
 * The CID the next save should follow.
 * @param knownTip - the in-memory chain tip (may be null).
 * @returns the collection entry when it is newer than `knownTip` (or there is
 *   no known tip), else `knownTip`. Any read failure keeps `knownTip`.
 */
export async function resolveChainTip(knownTip: string | null, deps: ChainTipDeps): Promise<string | null> {
  let entry: string | null;
  try {
    entry = await deps.readEntryCid();
  } catch {
    return knownTip;
  }
  if (!entry || entry === knownTip) return knownTip ?? entry;
  if (!knownTip) return entry;
  try {
    const tipVersion = versionNumber(await deps.readManifest(knownTip));
    return (await descendsFrom(entry, knownTip, tipVersion, deps)) ? entry : knownTip;
  } catch {
    return knownTip;
  }
}

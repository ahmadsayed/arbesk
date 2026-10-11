/**
 * Walks the blockchain for live tokens, builds the reachable CID set, and
 * identifies pinned CIDs outside it as orphaned (unpinnable).
 * @remarks Companion to the conservative POST /api/v1/ipfs/unpin: shared
 *   source CIDs are reclaimed here once no live token can reach them.
 *   Mark-and-sweep with a grace period: content is pinned before its mint
 *   (or Publish) lands, so a CID is unpinned only once it has stayed orphaned
 *   for `graceMs`. First-seen times persist under .data/.
 */

import fs from "fs";
import path from "path";
import { getPublicClient, getContractAddress } from "../config.ts";
import { PROJECT_ROOT } from "./project-root.ts";
import type { StorageAdapter } from "./storage/index.ts";
import { walkManifestChain } from "./manifest-chain-walker.ts";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  type Abi,
  type PublicClient,
} from "viem";

/**
 * Per-chain manifest budget for GC walks.
 * @remarks Far above the unpin route's default of 100: a truncated walk
 *   blocks the unpin step, so the cap only guards against runaway chains.
 */
const GC_MAX_CHAIN_DEPTH = 10000;

const HOUR_MS = 3600000;
/** Default grace: covers in-flight publishes and recently saved drafts. */
const DEFAULT_GRACE_HOURS = 168;
const DEFAULT_STATE_PATH = path.join(
  path.resolve(PROJECT_ROOT, ".data"),
  "ipfs-gc-state.json",
);

/**
 * Persisted orphan first-seen times, per scan scope.
 * @remarks Scope = storage backend + chain, so a mark made while scanning
 *   one chain never satisfies the grace period of another.
 */
type GCState = Record<string, { orphanSince: Record<string, number> }>;

/** A missing or corrupt file starts empty: every orphan restarts its grace. */
function loadGCState(file: string): GCState {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.warn("[GC] state unreadable - all orphans restart their grace period");
    return {};
  }
}

function saveGCState(file: string, state: GCState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function resolveGraceMs(graceMs: number | undefined): number {
  if (graceMs !== undefined) return Number(graceMs);
  const hours = Number(process.env.IPFS_GC_GRACE_HOURS ?? DEFAULT_GRACE_HOURS);
  return (Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_GRACE_HOURS) * HOUR_MS;
}

const ZERO_ADDRESS: `0x${string}` =
  "0x0000000000000000000000000000000000000000";

/**
 * Standard ERC-721 Transfer event ABI item, used for mint (from zero
 * address) log scans.
 */
const TRANSFER_EVENT_ABI_ITEM = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
} as const;

function loadAbi(name: string): any[] {
  const abiPath = path.resolve(
    PROJECT_ROOT,
    `blockchain/artifacts/contracts/${name}.sol/${name}.json`,
  );
  if (!fs.existsSync(abiPath)) {
    throw new Error(`ABI not found: ${abiPath}`);
  }
  const artifact = JSON.parse(fs.readFileSync(abiPath, "utf-8"));
  return artifact.abi;
}

/**
 * Everything the GC needs to read from one contract: address, ABI, and the
 * viem client for its chain.
 * @remarks Keeps block-number reads and log scans on the contract's own chain.
 */
interface ContractRef {
  address: `0x${string}`;
  abi: Abi;
  client: PublicClient;
}

function getContractInstance(
  name: string,
  address: string,
  chainId?: number | string | null,
): ContractRef {
  const abi = loadAbi(name) as Abi;
  const client = getPublicClient(chainId ? Number(chainId) : undefined);
  return { address: address as `0x${string}`, abi, client };
}

/**
 * True when the contract itself answered with a revert (or no data), as
 * opposed to the RPC call failing.
 * @remarks Only a revert proves a token is burned or a function missing;
 *   a timeout proves nothing.
 */
function isContractRevert(e: unknown): boolean {
  return (
    e instanceof BaseError &&
    !!e.walk(
      (err) =>
        err instanceof ContractFunctionRevertedError ||
        err instanceof ContractFunctionZeroDataError,
    )
  );
}

/** Token IDs minted (Transfer from the zero address) since `deployBlock`. */
async function scanMintedTokenIds(
  contract: ContractRef,
  deployBlock: number,
  batchSize: number,
): Promise<Set<string>> {
  const { client } = contract;
  const endBlock = Number(await client.getBlockNumber());

  const minted = new Set<string>();

  for (let fromBlock = deployBlock; fromBlock <= endBlock; fromBlock += batchSize) {
    const toBlock = Math.min(fromBlock + batchSize - 1, endBlock);
    const logs = await client.getLogs({
      address: contract.address,
      event: TRANSFER_EVENT_ABI_ITEM,
      args: { from: ZERO_ADDRESS },
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    for (const log of logs) {
      const tokenId = (log as any).args?.tokenId;
      if (tokenId !== undefined && tokenId !== null) {
        minted.add(String(tokenId));
      }
    }
  }
  return minted;
}

/**
 * Discovers token IDs that have been minted (Transfer from zero address) and
 * are still alive.
 * @returns live token IDs as decimal strings, plus `ownerOf` failures that
 *   were not reverts (liveness unknown)
 */
async function discoverLiveTokenIds(
  contract: ContractRef,
  deployBlock: number,
  batchSize = 10000,
): Promise<{ live: string[]; errors: string[] }> {
  const minted = await scanMintedTokenIds(contract, deployBlock, batchSize);
  const { client } = contract;

  const live: string[] = [];
  const errors: string[] = [];
  for (const tokenId of minted) {
    try {
      const owner = (await client.readContract({
        address: contract.address,
        abi: contract.abi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
      })) as string;
      if (owner && owner !== ZERO_ADDRESS) {
        live.push(tokenId);
      }
    } catch (e) {
      // A revert means the token does not exist (burned). Anything else
      // leaves liveness unknown.
      if (!isContractRevert(e)) {
        errors.push(`ownerOf(${tokenId}): ${(e as Error).message}`);
      }
    }
  }

  return { live, errors };
}

interface GCContractEntry {
  contract: ContractRef;
  name: string;
  deployBlock: number;
}

/**
 * Builds the set of CIDs reachable from each contract's live tokens.
 * @remarks Also protects the current editor list URI.
 */
async function buildReachableSet(
  liveByContract: { entry: GCContractEntry; tokenIds: string[] }[],
  storage: StorageAdapter,
): Promise<{ reachable: Set<string>; errors: string[]; tokensProcessed: number }> {
  const reachable = new Set<string>();
  const errors: string[] = [];
  let tokensProcessed = 0;

  for (const { entry, tokenIds } of liveByContract) {
    const { contract, name } = entry;
    for (const tokenId of tokenIds) {
      let manifestCid: string;
      try {
        manifestCid = (await contract.client.readContract({
          address: contract.address,
          abi: contract.abi,
          functionName: "tokenURI",
          args: [BigInt(tokenId)],
        })) as string;
      } catch (e) {
        // The token is live here, so a failed read means unknown content.
        errors.push(`${name}#${tokenId} tokenURI: ${(e as Error).message}`);
        continue;
      }
      if (!manifestCid) continue;

      tokensProcessed++;

      try {
        const { allReachable, errors: walkErrors } = await walkManifestChain(
          manifestCid,
          {
            recurseIntoSources: true,
            recurseIntoCollectionAssets: true,
            maxDepth: GC_MAX_CHAIN_DEPTH,
          },
          storage,
        );
        for (const cid of allReachable) reachable.add(cid);
        if (walkErrors?.length) errors.push(...walkErrors);
      } catch (e) {
        errors.push(`${name}#${tokenId} walk ${manifestCid}: ${(e as Error).message}`);
      }

      // Editor list URI is stored on-chain and must stay pinned.
      try {
        const editorListUri = (await contract.client.readContract({
          address: contract.address,
          abi: contract.abi,
          functionName: "editorListURI",
          args: [BigInt(tokenId)],
        })) as string;
        if (editorListUri && typeof editorListUri === "string") {
          const cid = editorListUri.replace(/^ipfs:\/\//, "");
          if (cid) reachable.add(cid);
        }
      } catch (e) {
        // Older contracts may not expose editorListURI (revert); an RPC
        // failure leaves the list's pin unprotected.
        if (!isContractRevert(e)) {
          errors.push(`${name}#${tokenId} editorListURI: ${(e as Error).message}`);
        }
      }
    }
  }

  return { reachable, errors, tokensProcessed };
}

export interface IpfsGCOptions {
  /** If true, only report orphans; do not unpin. */
  dryRun?: boolean;
  /** Maximum CIDs to unpin in one run. */
  maxUnpin?: number;
  /** Chain to scan. */
  chainId?: number | string | null;
  /** Free tier contract. */
  freeContractAddress?: string;
  /** Paid tier contract. */
  paidContractAddress?: string;
  freeDeployBlock?: number;
  paidDeployBlock?: number;
  /** Block range chunk size for event scans. */
  eventBatchSize?: number;
  /** How long a CID must stay orphaned before it is unpinned (default:
   * IPFS_GC_GRACE_HOURS, else 7 days). */
  graceMs?: number;
  /** Orphan first-seen state file (default: .data/ipfs-gc-state.json). */
  statePath?: string;
  /** Clock, for tests. */
  now?: () => number;
}

export interface IpfsGCResult {
  dryRun: boolean;
  /** True when a live run skipped unpinning because `errors` is non-empty. */
  aborted: boolean;
  liveTokens: number;
  reachable: number;
  pinned: number;
  orphans: number;
  /** Orphans whose grace period has elapsed (what a live run unpins). */
  eligible: number;
  unpinned: number;
  errors: string[];
}

/**
 * Carries first-seen times forward for current orphans and picks those
 * past the grace period.
 * @remarks Only current orphans keep a time: a CID that became reachable
 *   (or was unpinned elsewhere) drops out and restarts its clock if it is
 *   orphaned again.
 */
function markOrphans(
  orphans: string[],
  previous: Record<string, number>,
  now: number,
  graceMs: number,
): { orphanSince: Record<string, number>; eligible: string[] } {
  const orphanSince: Record<string, number> = {};
  for (const cid of orphans) orphanSince[cid] = previous[cid] ?? now;
  const eligible = orphans.filter((cid) => now - orphanSince[cid] >= graceMs);
  return { orphanSince, eligible };
}

/**
 * The unpin step of a run.
 * @remarks Any error so far means the reachable set may be missing live
 *   content, so a live run refuses to unpin - and records no marks, since
 *   its orphan list is unreliable. Dry runs never unpin or record.
 */
async function sweep(args: {
  dryRun: boolean;
  toUnpin: string[];
  orphanSince: Record<string, number>;
  commitState: () => void;
  storage: StorageAdapter;
  errors: string[];
}): Promise<{ aborted: boolean; unpinned: number }> {
  const { dryRun, toUnpin, orphanSince, commitState, storage, errors } = args;
  const aborted = !dryRun && errors.length > 0;
  if (aborted) {
    console.warn(
      `[GC] unpin skipped | ${errors.length} errors make the reachable set unreliable`,
    );
  }
  let unpinned = 0;
  if (!dryRun && !aborted) {
    unpinned = await unpinEligible(toUnpin, orphanSince, storage, errors);
    try {
      commitState();
    } catch (e) {
      // Next run restarts every unmarked orphan's grace: safe, just slower.
      const msg = `save state: ${(e as Error).message}`;
      console.warn(`[GC] ${msg}`);
      errors.push(msg);
    }
  }
  return { aborted, unpinned };
}

/**
 * Unpins `toUnpin`, dropping each success from `orphanSince`.
 * @returns how many were unpinned; failures are appended to `errors`
 */
async function unpinEligible(
  toUnpin: string[],
  orphanSince: Record<string, number>,
  storage: StorageAdapter,
  errors: string[],
): Promise<number> {
  let unpinned = 0;
  for (const cid of toUnpin) {
    try {
      await storage.unpin(cid);
      unpinned++;
      delete orphanSince[cid];
      console.log(`[GC] unpinned orphan → ${cid}`);
    } catch (e) {
      const msg = `unpin ${cid}: ${(e as Error).message}`;
      console.warn(`[GC] ${msg}`);
      errors.push(msg);
    }
  }
  return unpinned;
}

/**
 * Live token IDs per contract (IDs overlap across contracts).
 * @remarks Appends discovery failures to `errors`.
 */
async function discoverAllLiveTokens(
  contracts: GCContractEntry[],
  eventBatchSize: number,
  errors: string[],
): Promise<{ entry: GCContractEntry; tokenIds: string[] }[]> {
  const liveByContract: { entry: GCContractEntry; tokenIds: string[] }[] = [];
  for (const entry of contracts) {
    const { name, contract, deployBlock } = entry;
    try {
      const { live, errors: ownerErrors } = await discoverLiveTokenIds(
        contract,
        deployBlock,
        eventBatchSize,
      );
      liveByContract.push({ entry, tokenIds: live });
      for (const msg of ownerErrors) errors.push(`${name} ${msg}`);
      console.log(`[GC] ${name} live tokens: ${live.length}`);
    } catch (e) {
      const msg = `discover ${name}: ${(e as Error).message}`;
      console.error(`[GC] ${msg}`);
      errors.push(msg);
    }
  }
  return liveByContract;
}

/**
 * Where each contract's address and deploy block come from: options first,
 * then the chain config (free tier only), then env.
 */
function gcContractSpecs(options: IpfsGCOptions, chainId: number | string | null) {
  return [
    {
      name: "ArbeskAssetFree",
      address:
        options.freeContractAddress ??
        getContractAddress(chainId) ??
        process.env.CONTRACT_ADDRESS,
      deployBlock: options.freeDeployBlock ?? process.env.CONTRACT_DEPLOY_BLOCK,
    },
    {
      name: "ArbeskAsset",
      address: options.paidContractAddress ?? process.env.PAID_CONTRACT_ADDRESS,
      deployBlock: options.paidDeployBlock ?? process.env.PAID_CONTRACT_DEPLOY_BLOCK,
    },
  ];
}

/** The configured contracts to scan (a missing address skips that tier). */
function resolveGCContracts(
  options: IpfsGCOptions,
  chainId: number | string | null,
): GCContractEntry[] {
  const contracts: GCContractEntry[] = [];
  for (const { name, address, deployBlock } of gcContractSpecs(options, chainId)) {
    if (!address) continue;
    contracts.push({
      name,
      contract: getContractInstance(name, address, chainId),
      deployBlock: Number(deployBlock ?? 0),
    });
  }
  return contracts;
}

/**
 * Run the IPFS reachability garbage collector.
 */
export async function runIpfsGC(options: IpfsGCOptions = {}, storage: StorageAdapter): Promise<IpfsGCResult> {
  const dryRun = options.dryRun !== false;
  const maxUnpin =
    options.maxUnpin === undefined ? Infinity : Number(options.maxUnpin);
  const chainId = options.chainId ?? null;
  const eventBatchSize = Number(options.eventBatchSize ?? 10000);
  const graceMs = resolveGraceMs(options.graceMs);
  const statePath = options.statePath ?? DEFAULT_STATE_PATH;
  const now = options.now ? options.now() : Date.now();

  const contracts = resolveGCContracts(options, chainId);

  if (contracts.length === 0) {
    throw new Error("No contract address configured for GC scan");
  }

  console.log(
    `[GC] starting scan | contracts=${contracts.map((c) => c.name).join(",")} dryRun=${dryRun}`,
  );

  // 1. Discover live tokens per contract (IDs overlap across contracts).
  const errors: string[] = [];
  const liveByContract = await discoverAllLiveTokens(contracts, eventBatchSize, errors);

  // 2. Build reachable CID set.
  const { reachable, errors: walkErrors, tokensProcessed } = await buildReachableSet(
    liveByContract,
    storage,
  );
  if (walkErrors?.length) errors.push(...walkErrors);

  console.log(
    `[GC] reachable set built | tokens=${tokensProcessed} cids=${reachable.size}`,
  );

  // 3. List currently pinned CIDs.
  let pinned: string[] = [];
  try {
    pinned = await storage.listPinned();
    console.log(`[GC] pinned CIDs listed | count=${pinned.length}`);
  } catch (e) {
    const msg = `list pinned: ${(e as Error).message}`;
    console.error(`[GC] ${msg}`);
    errors.push(msg);
    return {
      dryRun,
      aborted: !dryRun,
      liveTokens: tokensProcessed,
      reachable: reachable.size,
      pinned: 0,
      orphans: 0,
      eligible: 0,
      unpinned: 0,
      errors,
    };
  }

  // 4. Compute orphans.
  const orphans = pinned.filter((cid) => !reachable.has(cid));
  console.log(`[GC] orphans found | count=${orphans.length}`);

  // 5. Grace period.
  const scope = `${storage.backend}:${chainId ?? "default"}`;
  const state = loadGCState(statePath);
  const { orphanSince, eligible } = markOrphans(
    orphans,
    state[scope]?.orphanSince ?? {},
    now,
    graceMs,
  );
  console.log(
    `[GC] past grace | eligible=${eligible.length} graceHours=${graceMs / HOUR_MS}`,
  );

  // 6. Unpin eligible orphans (unless dry run).
  const { aborted, unpinned } = await sweep({
    dryRun,
    toUnpin: eligible.slice(0, maxUnpin),
    orphanSince,
    commitState: () => saveGCState(statePath, { ...state, [scope]: { orphanSince } }),
    storage,
    errors,
  });

  console.log(
    `[GC] done | dryRun=${dryRun} aborted=${aborted} liveTokens=${tokensProcessed} reachable=${reachable.size} pinned=${pinned.length} orphans=${orphans.length} eligible=${eligible.length} unpinned=${unpinned} errors=${errors.length}`,
  );

  return {
    dryRun,
    aborted,
    liveTokens: tokensProcessed,
    reachable: reachable.size,
    pinned: pinned.length,
    orphans: orphans.length,
    eligible: eligible.length,
    unpinned,
    errors: errors.length > 0 ? errors : [],
  };
}

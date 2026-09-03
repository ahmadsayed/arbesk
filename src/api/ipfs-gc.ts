/**
 * Walks the blockchain for live tokens, builds the reachable CID set, and
 * identifies pinned CIDs outside it as orphaned (unpinnable).
 * @remarks Companion to the conservative POST /api/v1/ipfs/unpin: shared
 *   source CIDs are reclaimed here once no live token can reach them.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPublicClient, getContractAddress } from "../config.ts";
import type { StorageAdapter } from "./storage/index.ts";
import { walkManifestChain } from "./manifest-chain-walker.ts";
import type { Abi, PublicClient } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    __dirname,
    `../../blockchain/artifacts/contracts/${name}.sol/${name}.json`,
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
 * Discovers token IDs that have been minted (Transfer from zero address) and
 * are still alive.
 * @returns live token IDs as decimal strings
 */
async function discoverLiveTokenIds(
  contract: ContractRef,
  deployBlock: number,
  batchSize = 10000,
): Promise<string[]> {
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

  const live: string[] = [];
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
    } catch {
      // Token does not exist (burned).
    }
  }

  return live;
}

interface GCContractEntry {
  contract: ContractRef;
  name: string;
  deployBlock: number;
}

/**
 * Builds the set of CIDs reachable from a list of live tokens.
 * @remarks Also protects the current editor list URI.
 */
async function buildReachableSet(
  tokenIds: string[],
  contracts: GCContractEntry[],
  storage: StorageAdapter,
): Promise<{ reachable: Set<string>; errors: string[]; tokensProcessed: number }> {
  const reachable = new Set<string>();
  const errors: string[] = [];
  let tokensProcessed = 0;

  for (const tokenId of tokenIds) {
    let tokenReachable = false;

    for (const { contract, name } of contracts) {
      let manifestCid: string;
      try {
        manifestCid = (await contract.client.readContract({
          address: contract.address,
          abi: contract.abi,
          functionName: "tokenURI",
          args: [BigInt(tokenId)],
        })) as string;
      } catch {
        // Token likely does not exist on this contract.
        continue;
      }
      if (!manifestCid) continue;

      tokenReachable = true;

      try {
        const { allReachable, errors: walkErrors } = await walkManifestChain(
          manifestCid,
          {
            recurseIntoSources: true,
            recurseIntoCollectionAssets: true,
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
      } catch {
        // Older contracts may not expose editorListURI; ignore.
      }
    }

    if (tokenReachable) tokensProcessed++;
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
}

export interface IpfsGCResult {
  dryRun: boolean;
  liveTokens: number;
  reachable: number;
  pinned: number;
  orphans: number;
  unpinned: number;
  errors: string[];
}

/**
 * Run the IPFS reachability garbage collector.
 */
export async function runIpfsGC(options: IpfsGCOptions = {}, storage: StorageAdapter): Promise<IpfsGCResult> {
  const dryRun = options.dryRun !== false;
  const maxUnpin =
    options.maxUnpin === undefined ? Infinity : Number(options.maxUnpin);
  const chainId = options.chainId ?? null;
  const freeContractAddress =
    options.freeContractAddress ??
    getContractAddress(chainId) ??
    process.env.CONTRACT_ADDRESS;
  const paidContractAddress =
    options.paidContractAddress ?? process.env.PAID_CONTRACT_ADDRESS;
  const freeDeployBlock = Number(
    options.freeDeployBlock ?? process.env.CONTRACT_DEPLOY_BLOCK ?? 0,
  );
  const paidDeployBlock = Number(
    options.paidDeployBlock ?? process.env.PAID_CONTRACT_DEPLOY_BLOCK ?? 0,
  );
  const eventBatchSize = Number(options.eventBatchSize ?? 10000);

  const contracts: GCContractEntry[] = [];
  if (freeContractAddress) {
    contracts.push({
      name: "ArbeskAssetFree",
      contract: getContractInstance(
        "ArbeskAssetFree",
        freeContractAddress,
        chainId,
      ),
      deployBlock: freeDeployBlock,
    });
  }
  if (paidContractAddress) {
    contracts.push({
      name: "ArbeskAsset",
      contract: getContractInstance(
        "ArbeskAsset",
        paidContractAddress,
        chainId,
      ),
      deployBlock: paidDeployBlock,
    });
  }

  if (contracts.length === 0) {
    throw new Error("No contract address configured for GC scan");
  }

  console.log(
    `[GC] starting scan | contracts=${contracts.map((c) => c.name).join(",")} dryRun=${dryRun}`,
  );

  // 1. Discover live tokens across both contracts.
  const allLiveTokenIds = new Set<string>();
  const errors: string[] = [];
  for (const { name, contract, deployBlock } of contracts) {
    try {
      const live = await discoverLiveTokenIds(
        contract,
        deployBlock,
        eventBatchSize,
      );
      for (const id of live) allLiveTokenIds.add(id);
      console.log(`[GC] ${name} live tokens: ${live.length}`);
    } catch (e) {
      const msg = `discover ${name}: ${(e as Error).message}`;
      console.error(`[GC] ${msg}`);
      errors.push(msg);
    }
  }

  // 2. Build reachable CID set.
  const { reachable, errors: walkErrors, tokensProcessed } = await buildReachableSet(
    Array.from(allLiveTokenIds),
    contracts,
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
      liveTokens: tokensProcessed,
      reachable: reachable.size,
      pinned: 0,
      orphans: 0,
      unpinned: 0,
      errors,
    };
  }

  // 4. Compute orphans.
  const orphans = pinned.filter((cid) => !reachable.has(cid));
  console.log(`[GC] orphans found | count=${orphans.length}`);

  // 5. Unpin orphans (unless dry run).
  let unpinned = 0;
  if (!dryRun) {
    const toUnpin = orphans.slice(0, maxUnpin);
    for (const cid of toUnpin) {
      try {
        await storage.unpin(cid);
        unpinned++;
        console.log(`[GC] unpinned orphan → ${cid}`);
      } catch (e) {
        const msg = `unpin ${cid}: ${(e as Error).message}`;
        console.warn(`[GC] ${msg}`);
        errors.push(msg);
      }
    }
  }

  console.log(
    `[GC] done | dryRun=${dryRun} liveTokens=${tokensProcessed} reachable=${reachable.size} pinned=${pinned.length} orphans=${orphans.length} unpinned=${unpinned} errors=${errors.length}`,
  );

  return {
    dryRun,
    liveTokens: tokensProcessed,
    reachable: reachable.size,
    pinned: pinned.length,
    orphans: orphans.length,
    unpinned,
    errors: errors.length > 0 ? errors : [],
  };
}

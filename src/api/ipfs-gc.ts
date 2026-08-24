/**
 * Arbesk IPFS Reachability Garbage Collector
 *
 * Walks the blockchain for live Arbesk tokens, resolves each tokenURI, walks
 * the manifest chains (collection + asset + source + embedded buffers/images),
 * and builds the set of CIDs that are still reachable. Any pinned CID that is
 * not in the reachable set is considered orphaned and can be unpinned.
 *
 * This is the companion to the conservative `POST /api/v1/ipfs/unpin` endpoint:
 * unpin no longer removes shared source CIDs, and this job reclaims them once
 * no live token can reach them anymore.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { web3, getWeb3, getContractAddress } from "../config.ts";
import type { StorageAdapter } from "./storage/index.ts";
import { walkManifestChain } from "./manifest-chain-walker.ts";
import type { Contract } from "web3";
import type { EventLog } from "web3-eth-contract";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function getContractInstance(
  name: string,
  address: string,
  chainId?: number | string | null,
): Contract<any> {
  const abi = loadAbi(name);
  const w3 = chainId ? getWeb3(chainId) : web3;
  return new w3.eth.Contract(abi, address) as Contract<any>;
}

/**
 * Discover token IDs that have been minted (Transfer from zero address) and
 * are still alive (ownerOf does not revert and is not zero address).
 *
 * @param contract - web3.eth.Contract instance
 * @param deployBlock - block to start scanning from
 * @param batchSize - RPC log query chunk size
 * @param w3 - web3 instance for the chain the contract lives on;
 *   must match the contract's chain or the block range is nonsense
 * @returns live token IDs as decimal strings
 */
async function discoverLiveTokenIds(
  contract: Contract<any>,
  deployBlock: number,
  batchSize = 10000,
  w3: typeof web3 = web3,
): Promise<string[]> {
  const endBlock = Number(await w3.eth.getBlockNumber());

  const minted = new Set<string>();

  for (let fromBlock = deployBlock; fromBlock <= endBlock; fromBlock += batchSize) {
    const toBlock = Math.min(fromBlock + batchSize - 1, endBlock);
    const events = await contract.getPastEvents("Transfer", {
      filter: { from: ZERO_ADDRESS },
      fromBlock,
      toBlock,
    });
    for (const e of events) {
      const event = e as EventLog;
      minted.add(String(event.returnValues.tokenId));
    }
  }

  const live: string[] = [];
  for (const tokenId of minted) {
    try {
      const owner = (await contract.methods.ownerOf(tokenId).call()) as string;
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
  contract: Contract<any>;
  name: string;
  deployBlock: number;
}

/**
 * Build the set of CIDs reachable from a list of live tokens.
 *
 * For each token, resolves tokenURI (collection manifest CID), walks the
 * collection chain and every asset manifest chain, and also protects the
 * current editor list URI.
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
        manifestCid = (await contract.methods.tokenURI(tokenId).call()) as string;
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
        const editorListUri = (await contract.methods
          .editorListURI(tokenId)
          .call()) as string;
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
        // The block-number read must come from the same chain as the contract
        // (getWeb3 falls back to the default instance when chainId is null).
        getWeb3(chainId),
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

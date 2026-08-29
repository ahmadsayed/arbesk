import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { PublicClient } from "viem";
import { DEPLOYMENT_BLOCKS, LOG_CHUNK_SIZES } from "../../constants/chains.js";
import { getPublicClient, getContractAddress, NETWORK_CONFIGS } from "../config.ts";
import type { StorageAdapter } from "./storage/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../.data");

function ts(): string {
  return new Date().toLocaleTimeString();
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000".toLowerCase();

/**
 * Event ABIs the indexer subscribes to: ERC-721 Transfer mints/burns and
 * EditorSetChanged. Passed to viem getLogs, which decodes each log's args —
 * no manual topic slicing.
 */
const INDEXER_EVENTS = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
      { internalType: "bytes32", name: "newRoot", type: "bytes32" },
      { internalType: "uint256", name: "newVersion", type: "uint256" },
    ],
    name: "EditorSetChanged",
    type: "event",
  },
] as const;

/** ABI for the editorListURI view function, read via readContract. */
const EDITOR_LIST_URI_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "editorListURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface IndexerState {
  lastScannedBlock: number;
  /** tokenId (decimal string) -> owner address (lowercase) */
  ownership: Record<string, string>;
  /** tokenId -> lowercase editor addresses */
  tokenEditors: Record<string, string[]>;
  /** lowercase editor address -> tokenIds */
  editorTokens: Record<string, string[]>;
}

class TokenIndexer {
  chainId: number;
  contractAddress: string | null;
  client: PublicClient;
  deploymentBlock: number;
  stateFile: string;
  ownership: Map<string, string>;
  /** tokenId -> lowercase editor addresses */
  tokenEditors: Map<string, string[]>;
  /** lowercase editor address -> tokenIds */
  editorTokens: Map<string, string[]>;
  lastScannedBlock: number;
  pollIntervalMs: number;
  pollTimer: NodeJS.Timeout | null;
  initialized: boolean;
  lastCatchUpAt: number;
  _catchUpPromise: Promise<void> | null;
  storage: StorageAdapter;

  constructor(chainId: number, storage: StorageAdapter) {
    this.chainId = chainId;
    this.contractAddress = getContractAddress(chainId);
    this.client = getPublicClient(chainId);
    this.deploymentBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
    this.stateFile = path.join(DATA_DIR, `token-indexer-${chainId}.json`);
    this.storage = storage;

    this.ownership = new Map();
    this.tokenEditors = new Map();
    this.editorTokens = new Map();
    this.lastScannedBlock = this.deploymentBlock;
    this.pollIntervalMs = 15000;
    this.pollTimer = null;
    this.initialized = false;
    this.lastCatchUpAt = 0;
    this._catchUpPromise = null;
  }

  _loadState(): void {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = fs.readFileSync(this.stateFile, "utf8");
      const parsed = JSON.parse(raw) as IndexerState;
      if (
        typeof parsed.lastScannedBlock === "number" &&
        parsed.ownership &&
        typeof parsed.ownership === "object"
      ) {
        this.lastScannedBlock = Math.max(parsed.lastScannedBlock, this.deploymentBlock);
        this.ownership = new Map(Object.entries(parsed.ownership));
        this.tokenEditors = new Map(
          Object.entries(parsed.tokenEditors || {}).map(([k, v]) => [
            k,
            Array.isArray(v) ? v : [],
          ])
        );
        this.editorTokens = new Map(
          Object.entries(parsed.editorTokens || {}).map(([k, v]) => [
            k,
            Array.isArray(v) ? v : [],
          ])
        );
        console.log(
          `[${ts()}] [INDEXER] loaded state for chain ${this.chainId}: ` +
            `${this.ownership.size} tokens, ${this.editorTokens.size} editors, ` +
            `lastScannedBlock=${this.lastScannedBlock}`
        );
      }
    } catch (err) {
      console.warn(
        `[${ts()}] [INDEXER] failed to load state for chain ${this.chainId}:`,
        String((err as Error).message)
      );
    }
  }

  _saveState(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const state: IndexerState = {
        lastScannedBlock: this.lastScannedBlock,
        ownership: Object.fromEntries(this.ownership),
        tokenEditors: Object.fromEntries(this.tokenEditors),
        editorTokens: Object.fromEntries(this.editorTokens),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(
        `[${ts()}] [INDEXER] failed to save state for chain ${this.chainId}:`,
        String((err as Error).message)
      );
    }
  }

  /**
   * Fetch Transfer and EditorSetChanged logs for a single block range.
   * Returns viem-decoded logs (eventName + args).
   */
  async _fetchLogs(fromBlock: number, toBlock: number): Promise<any[]> {
    const start = Date.now();
    const logs = await this.client.getLogs({
      address: this.contractAddress as `0x${string}`,
      events: INDEXER_EVENTS,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    console.log(
      `[${ts()}] [INDEXER] getLogs ${fromBlock}..${toBlock} returned ${logs.length} logs ` +
        `in ${Date.now() - start}ms`
    );
    return logs;
  }

  /**
   * Remove a token from the editor reverse maps.
   */
  _removeTokenEditors(tokenId: string): void {
    const editors = this.tokenEditors.get(tokenId);
    if (!editors) return;
    for (const addr of editors) {
      const list = this.editorTokens.get(addr);
      if (list) {
        const filtered = list.filter((id) => id !== tokenId);
        if (filtered.length === 0) {
          this.editorTokens.delete(addr);
        } else {
          this.editorTokens.set(addr, filtered);
        }
      }
    }
    this.tokenEditors.delete(tokenId);
  }

  /**
   * Fetch the current editor list for a token from chain/IPFS and update maps.
   * Only entries with role === Editor (2) are indexed.
   */
  async _refreshTokenEditors(tokenId: string): Promise<void> {
    try {
      const cid = await this.client.readContract({
        address: this.contractAddress as `0x${string}`,
        abi: EDITOR_LIST_URI_ABI,
        functionName: "editorListURI",
        args: [BigInt(tokenId)],
      });
      if (!cid) {
        this._removeTokenEditors(tokenId);
        return;
      }
      const raw = await this.storage.cat(cid);
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) {
        this._removeTokenEditors(tokenId);
        return;
      }
      const editors = list
        .filter((entry: any) => entry && entry.address && Number(entry.role) === 2)
        .map((entry: any) => entry.address.toLowerCase());

      this._removeTokenEditors(tokenId);
      if (editors.length === 0) return;

      this.tokenEditors.set(tokenId, editors);
      for (const addr of editors) {
        const existing = this.editorTokens.get(addr) || [];
        if (!existing.includes(tokenId)) {
          existing.push(tokenId);
          this.editorTokens.set(addr, existing);
        }
      }
    } catch (err) {
      console.warn(
        `[${ts()}] [INDEXER] failed to refresh editors for token ${tokenId}:`,
        String((err as Error).message)
      );
    }
  }

  /**
   * Apply Transfer and EditorSetChanged logs to the index.
   * Logs are pre-decoded by viem: eventName + args (args.tokenId is bigint,
   * args.to a checksummed address — lowered to match the legacy topic slice).
   */
  _applyLogs(logs: any[]): { maxBlock: number; editorTokensToRefresh: Set<string> } {
    let maxBlock = this.lastScannedBlock;
    const editorTokensToRefresh = new Set<string>();

    for (const log of logs) {
      const blockNumber = Number(log.blockNumber);
      if (blockNumber > maxBlock) maxBlock = blockNumber;

      if (log.eventName === "Transfer") {
        const tokenId = String(log.args.tokenId);
        const to = log.args.to.toLowerCase();
        this.ownership.set(tokenId, to);
        if (to === ZERO_ADDRESS) {
          this._removeTokenEditors(tokenId);
        }
      } else if (log.eventName === "EditorSetChanged") {
        const tokenId = String(log.args.tokenId);
        editorTokensToRefresh.add(tokenId);
      }
    }

    return { maxBlock, editorTokensToRefresh };
  }

  /**
   * Index a range of blocks. Safe to call repeatedly.
   * Processes logs in chain-specific chunks and saves state after each chunk
   * so a restart can resume from the last completed chunk instead of starting
   * the whole backfill over.
   */
  async _indexRange(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) return;
    const start = Date.now();
    const chunkSize = LOG_CHUNK_SIZES[this.chainId] || 100;
    let totalLogs = 0;

    for (let from = fromBlock; from <= toBlock; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, toBlock);
      const logs = await this._fetchLogs(from, to);
      const { maxBlock, editorTokensToRefresh } = this._applyLogs(logs);
      this.lastScannedBlock = Math.max(maxBlock, to);

      for (const tokenId of editorTokensToRefresh) {
        await this._refreshTokenEditors(tokenId);
      }

      this._saveState();
      totalLogs += logs.length;
    }

    console.log(
      `[${ts()}] [INDEXER] _indexRange ${fromBlock}..${toBlock} total ` +
        `${totalLogs} logs in ${Date.now() - start}ms`
    );
  }

  /**
   * Catch up to the current chain tip.
   * Concurrent callers share the same in-flight catch-up promise so forced
   * API requests don't race with the background poll.
   */
  async catchUp(): Promise<void> {
    if (this._catchUpPromise) {
      return this._catchUpPromise;
    }

    const run = async (): Promise<void> => {
      const start = Date.now();
      this.lastCatchUpAt = start;
      const latest = Number(await this.client.getBlockNumber());
      if (this.lastScannedBlock >= latest) {
        console.log(
          `[${ts()}] [INDEXER] catchUp chain ${this.chainId} already at tip ` +
            `${this.lastScannedBlock} in ${Date.now() - start}ms`
        );
        return;
      }
      console.log(
        `[${ts()}] [INDEXER] catching up chain ${this.chainId} ` +
          `from block ${this.lastScannedBlock} to ${latest}`
      );
      await this._indexRange(this.lastScannedBlock, latest);
      console.log(
        `[${ts()}] [INDEXER] chain ${this.chainId} caught up ` +
          `to ${this.lastScannedBlock} (${this.ownership.size} tokens, ${this.editorTokens.size} editors) ` +
          `in ${Date.now() - start}ms`
      );
    };

    this._catchUpPromise = run().finally(() => {
      this._catchUpPromise = null;
    });
    return this._catchUpPromise;
  }

  /**
   * Start background polling for new blocks.
   */
  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      try {
        await this.catchUp();
      } catch (err) {
        console.error(
          `[${ts()}] [INDEXER] poll failed for chain ${this.chainId}:`,
          String((err as Error).message)
        );
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop background polling.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Initialize the indexer: load state, backfill, start polling.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this._loadState();
    try {
      await this.catchUp();
    } finally {
      // Start polling even when the boot-time catch-up fails (e.g. a
      // transient RPC outage): each poll tick retries catchUp, so the
      // indexer self-heals instead of staying dead until a restart.
      this.start();
    }
  }

  /**
   * Get all token IDs currently owned by the given address.
   */
  getOwnedTokens(address: string): string[] {
    const lower = address.toLowerCase();
    const owned: string[] = [];
    for (const [tokenId, owner] of this.ownership) {
      if (owner === lower) owned.push(tokenId);
    }
    return owned;
  }

  /**
   * Get token IDs where the address is an editor but not the current owner.
   */
  getSharedTokens(address: string): string[] {
    const lower = address.toLowerCase();
    const shared: string[] = [];
    const candidates = this.editorTokens.get(lower) || [];
    for (const tokenId of candidates) {
      const owner = this.ownership.get(tokenId);
      if (owner && owner !== lower) {
        shared.push(tokenId);
      }
    }
    return shared;
  }
}

const indexers = new Map<number, TokenIndexer>();

/**
 * Get or create a TokenIndexer for a chain.
 */
export function getIndexer(chainId: number, storage: StorageAdapter): TokenIndexer {
  const id = Number(chainId);
  if (!indexers.has(id)) {
    indexers.set(id, new TokenIndexer(id, storage));
  }
  return indexers.get(id) as TokenIndexer;
}

/**
 * Initialize indexers for all configured networks.
 */
export async function initIndexers(storage: StorageAdapter): Promise<void> {
  const chainIds = Object.keys(NETWORK_CONFIGS).map(Number);
  await Promise.all(
    chainIds.map(async (chainId) => {
      const deploymentBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
      if (deploymentBlock <= 0) {
        console.log(
          `[${ts()}] [INDEXER] skipping chain ${chainId}: no deployment block configured`
        );
        return;
      }
      try {
        await getIndexer(chainId, storage).init();
      } catch (err) {
        console.warn(
          `[${ts()}] [INDEXER] initial catch-up failed for chain ${chainId} ` +
            `(background poll retries every 15s):`,
          String((err as Error).message)
        );
      }
    })
  );
}

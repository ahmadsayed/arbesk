import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEPLOYMENT_BLOCKS, LOG_CHUNK_SIZES } from "../../constants/chains.js";
import { getWeb3, getContractAddress, NETWORK_CONFIGS } from "../config.js";
import { getStorage } from "./storage/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../.data");

function ts() {
  return new Date().toLocaleTimeString();
}

const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const EDITOR_SET_CHANGED_TOPIC0 =
  "0xe04346630a2a402b40ab5f6918205fee5369cca36e2e6c2eebc4188b5f10c8c3";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000".toLowerCase();

/**
 * Combined ABI for the indexer: ERC-721 Transfer events, EditorSetChanged
 * events, and the editorListURI view function.
 * @type {any}
 */
const INDEXER_ABI = [
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
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "editorListURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

/**
 * @typedef {Object} IndexerState
 * @property {number} lastScannedBlock
 * @property {Record<string, string>} ownership - tokenId (decimal string) -> owner address (lowercase)
 * @property {Record<string, string[]>} tokenEditors - tokenId -> lowercase editor addresses
 * @property {Record<string, string[]>} editorTokens - lowercase editor address -> tokenIds
 */

class TokenIndexer {
  /**
   * @param {number} chainId
   */
  constructor(chainId) {
    this.chainId = chainId;
    this.contractAddress = getContractAddress(chainId);
    this.web3 = getWeb3(chainId);
    this.contract = new this.web3.eth.Contract(INDEXER_ABI, this.contractAddress);
    this.deploymentBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
    this.stateFile = path.join(DATA_DIR, `token-indexer-${chainId}.json`);

    /** @type {Map<string, string>} */
    this.ownership = new Map();
    /** @type {Map<string, string[]>} tokenId -> lowercase editor addresses */
    this.tokenEditors = new Map();
    /** @type {Map<string, string[]>} lowercase editor address -> tokenIds */
    this.editorTokens = new Map();
    this.lastScannedBlock = this.deploymentBlock;
    this.pollIntervalMs = 15000;
    /** @type {NodeJS.Timeout|null} */
    this.pollTimer = null;
    this.initialized = false;
    /** @type {number} */
    this.lastCatchUpAt = 0;
    /** @type {Promise<void>|null} */
    this._catchUpPromise = null;
  }

  _loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) return;
      const raw = fs.readFileSync(this.stateFile, "utf8");
      /** @type {IndexerState} */
      const parsed = JSON.parse(raw);
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
        String(/** @type {Error} */ (err).message)
      );
    }
  }

  _saveState() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      /** @type {IndexerState} */
      const state = {
        lastScannedBlock: this.lastScannedBlock,
        ownership: Object.fromEntries(this.ownership),
        tokenEditors: Object.fromEntries(this.tokenEditors),
        editorTokens: Object.fromEntries(this.editorTokens),
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(
        `[${ts()}] [INDEXER] failed to save state for chain ${this.chainId}:`,
        String(/** @type {Error} */ (err).message)
      );
    }
  }

  /**
   * Fetch Transfer and EditorSetChanged logs for a single block range.
   * @param {number} fromBlock
   * @param {number} toBlock
   * @returns {Promise<any[]>}
   */
  async _fetchLogs(fromBlock, toBlock) {
    const start = Date.now();
    const logs = await this.web3.eth.getPastLogs({
      address: this.contractAddress,
      topics: [[TRANSFER_TOPIC0, EDITOR_SET_CHANGED_TOPIC0]],
      fromBlock: fromBlock,
      toBlock: toBlock,
    });
    console.log(
      `[${ts()}] [INDEXER] getPastLogs ${fromBlock}..${toBlock} returned ${logs.length} logs ` +
        `in ${Date.now() - start}ms`
    );
    return logs;
  }

  /**
   * Remove a token from the editor reverse maps.
   * @param {string} tokenId
   */
  _removeTokenEditors(tokenId) {
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
   * @param {string} tokenId
   */
  async _refreshTokenEditors(tokenId) {
    try {
      const cid = await this.contract.methods.editorListURI(tokenId).call();
      if (!cid) {
        this._removeTokenEditors(tokenId);
        return;
      }
      const raw = await getStorage().cat(cid);
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) {
        this._removeTokenEditors(tokenId);
        return;
      }
      const editors = list
        .filter((entry) => entry && entry.address && Number(entry.role) === 2)
        .map((entry) => entry.address.toLowerCase());

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
        String(/** @type {Error} */ (err).message)
      );
    }
  }

  /**
   * Apply Transfer and EditorSetChanged logs to the index.
   * @param {any[]} logs
   * @returns {{ maxBlock: number, editorTokensToRefresh: Set<string> }}
   */
  _applyLogs(logs) {
    let maxBlock = this.lastScannedBlock;
    /** @type {Set<string>} */
    const editorTokensToRefresh = new Set();

    for (const log of logs) {
      const topic0 = log.topics[0];
      const blockNumber = Number(log.blockNumber);
      if (blockNumber > maxBlock) maxBlock = blockNumber;

      if (topic0 === TRANSFER_TOPIC0) {
        const tokenId = String(this.web3.utils.toBigInt(log.topics[3]));
        const to = "0x" + log.topics[2].slice(-40).toLowerCase();
        this.ownership.set(tokenId, to);
        if (to === ZERO_ADDRESS) {
          this._removeTokenEditors(tokenId);
        }
      } else if (topic0 === EDITOR_SET_CHANGED_TOPIC0) {
        const tokenId = String(this.web3.utils.toBigInt(log.topics[1]));
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
   * @param {number} fromBlock
   * @param {number} toBlock
   */
  async _indexRange(fromBlock, toBlock) {
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
  async catchUp() {
    if (this._catchUpPromise) {
      return this._catchUpPromise;
    }

    const run = async () => {
      const start = Date.now();
      this.lastCatchUpAt = start;
      const latest = Number(await this.web3.eth.getBlockNumber());
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
  start() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      try {
        await this.catchUp();
      } catch (err) {
        console.error(
          `[${ts()}] [INDEXER] poll failed for chain ${this.chainId}:`,
          String(/** @type {Error} */ (err).message)
        );
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop background polling.
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Initialize the indexer: load state, backfill, start polling.
   */
  async init() {
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
   * @param {string} address
   * @returns {string[]}
   */
  getOwnedTokens(address) {
    const lower = address.toLowerCase();
    const owned = [];
    for (const [tokenId, owner] of this.ownership) {
      if (owner === lower) owned.push(tokenId);
    }
    return owned;
  }

  /**
   * Get token IDs where the address is an editor but not the current owner.
   * @param {string} address
   * @returns {string[]}
   */
  getSharedTokens(address) {
    const lower = address.toLowerCase();
    const shared = [];
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

/** @type {Map<number, TokenIndexer>} */
const indexers = new Map();

/**
 * Get or create a TokenIndexer for a chain.
 * @param {number} chainId
 * @returns {TokenIndexer}
 */
export function getIndexer(chainId) {
  const id = Number(chainId);
  if (!indexers.has(id)) {
    indexers.set(id, new TokenIndexer(id));
  }
  return /** @type {TokenIndexer} */ (indexers.get(id));
}

/**
 * Initialize indexers for all configured networks.
 */
export async function initIndexers() {
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
        await getIndexer(chainId).init();
      } catch (err) {
        console.warn(
          `[${ts()}] [INDEXER] initial catch-up failed for chain ${chainId} ` +
            `(background poll retries every 15s):`,
          String(/** @type {Error} */ (err).message)
        );
      }
    })
  );
}

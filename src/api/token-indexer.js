import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEPLOYMENT_BLOCKS } from "../../constants/chains.js";
import { getWeb3, getContractAddress, NETWORK_CONFIGS } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../.data");

const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Minimal ERC-721 Transfer event ABI used by the indexer.
 * @type {any}
 */
const TRANSFER_ABI = [
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
];

/**
 * @typedef {Object} IndexerState
 * @property {number} lastScannedBlock
 * @property {Record<string, string>} ownership - tokenId (decimal string) -> owner address (lowercase)
 */

class TokenIndexer {
  /**
   * @param {number} chainId
   */
  constructor(chainId) {
    this.chainId = chainId;
    this.contractAddress = getContractAddress(chainId);
    this.web3 = getWeb3(chainId);
    this.contract = new this.web3.eth.Contract(TRANSFER_ABI, this.contractAddress);
    this.deploymentBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
    this.stateFile = path.join(DATA_DIR, `token-indexer-${chainId}.json`);

    /** @type {Map<string, string>} */
    this.ownership = new Map();
    this.lastScannedBlock = this.deploymentBlock;
    this.pollIntervalMs = 15000;
    /** @type {NodeJS.Timeout|null} */
    this.pollTimer = null;
    this.initialized = false;
  }

  _statePath() {
    return this.stateFile;
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
        console.log(
          `[INDEXER] loaded state for chain ${this.chainId}: ` +
            `${this.ownership.size} tokens, lastScannedBlock=${this.lastScannedBlock}`
        );
      }
    } catch (err) {
      console.warn(`[INDEXER] failed to load state for chain ${this.chainId}:`, String(/** @type {Error} */ (err).message));
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
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(`[INDEXER] failed to save state for chain ${this.chainId}:`, String(/** @type {Error} */ (err).message));
    }
  }

  /**
   * Fetch Transfer logs in small chunks to respect RPC limits.
   * @param {number} fromBlock
   * @param {number} toBlock
   * @returns {Promise<any[]>}
   */
  async _fetchTransferLogs(fromBlock, toBlock) {
    const chunkSize = 100;
    const allLogs = [];
    for (let from = fromBlock; from <= toBlock; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, toBlock);
      const logs = await this.web3.eth.getPastLogs({
        address: this.contractAddress,
        topics: [TRANSFER_TOPIC0],
        fromBlock: from,
        toBlock: to,
      });
      allLogs.push(...logs);
    }
    return allLogs;
  }

  /**
   * Apply Transfer logs to the ownership map.
   * @param {any[]} logs
   */
  _applyLogs(logs) {
    let maxBlock = this.lastScannedBlock;
    for (const log of logs) {
      const tokenId = String(this.web3.utils.toBigInt(log.topics[3]));
      const to = "0x" + log.topics[2].slice(-40).toLowerCase();
      this.ownership.set(tokenId, to);
      const blockNumber = Number(log.blockNumber);
      if (blockNumber > maxBlock) maxBlock = blockNumber;
    }
    return maxBlock;
  }

  /**
   * Index a range of blocks. Safe to call repeatedly.
   * @param {number} fromBlock
   * @param {number} toBlock
   */
  async _indexRange(fromBlock, toBlock) {
    if (fromBlock > toBlock) return;
    const logs = await this._fetchTransferLogs(fromBlock, toBlock);
    const maxBlock = this._applyLogs(logs);
    this.lastScannedBlock = Math.max(maxBlock, toBlock);
    this._saveState();
  }

  /**
   * Catch up to the current chain tip.
   */
  async catchUp() {
    const latest = Number(await this.web3.eth.getBlockNumber());
    if (this.lastScannedBlock >= latest) return;
    console.log(
      `[INDEXER] catching up chain ${this.chainId} ` +
        `from block ${this.lastScannedBlock} to ${latest}`
    );
    await this._indexRange(this.lastScannedBlock, latest);
    console.log(
      `[INDEXER] chain ${this.chainId} caught up ` +
        `to ${this.lastScannedBlock} (${this.ownership.size} tokens)`
    );
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
        console.error(`[INDEXER] poll failed for chain ${this.chainId}:`, String(/** @type {Error} */ (err).message));
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
    await this.catchUp();
    this.start();
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
          `[INDEXER] skipping chain ${chainId}: no deployment block configured`
        );
        return;
      }
      try {
        await getIndexer(chainId).init();
      } catch (err) {
        console.error(
          `[INDEXER] failed to initialize chain ${chainId}:`,
          String(/** @type {Error} */ (err).message)
        );
      }
    })
  );
}


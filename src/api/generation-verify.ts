/**
 * On-chain generation verification (#48).
 * @remarks Closes the gap where the free/paid quota was a client-side honor
 *   system: verifies the emitted event's wallet, nodeId, and replay status.
 *   BYOK bypasses this (the user pays the provider directly); the mock adapter
 *   also bypasses it (no real cost).
 */
import {
  getPublicClient,
} from "../config.ts";
import {
  encodeEventTopics,
  stringToHex,
  pad,
} from "viem";
import type { PublicClient } from "viem";

/** Event ABIs (indexed args carry the wallet + nodeId topics). */
const GENERATION_EVENTS = [
  {
    type: "event",
    name: "AssetGenerationRecorded",
    inputs: [
      { name: "userWallet", type: "address", indexed: true },
      { name: "nodeId", type: "bytes32", indexed: true },
      { name: "prompt", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
      { name: "countToday", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AssetGenerationPaidUSDC",
    inputs: [
      { name: "userWallet", type: "address", indexed: true },
      { name: "nodeId", type: "bytes32", indexed: true },
      { name: "prompt", type: "string", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
      { name: "tier", type: "uint8", indexed: false },
    ],
  },
] as const;

/** Event topic0 hashes (keccak256 of the event signature). */
const RECORDED_TOPIC = (
  encodeEventTopics({ abi: GENERATION_EVENTS, eventName: "AssetGenerationRecorded" } as any)[0]
).toLowerCase();
const PAID_TOPIC = (
  encodeEventTopics({ abi: GENERATION_EVENTS, eventName: "AssetGenerationPaidUSDC" } as any)[0]
).toLowerCase();

/** Replay guard: txHash → expiry timestamp (in-memory, process-lifetime). */
const usedTxHashes = new Map<string, number>();
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Reconstructs the on-chain bytes32 `nodeId` exactly as the frontend encodes
 * it.
 */
function nodeIdToBytes32(nodeId: string): `0x${string}` {
  return pad(stringToHex(nodeId), { size: 32 });
}

export interface GenerationVerification {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies that the claimed on-chain generation transaction matches the
 * request (wallet + nodeId) and has not been replayed.
 * @remarks `nodeId` must equal the value passed to recordGeneration /
 *   payForGenerationWithUSDC. When `txHash` is absent the gate is a no-op for
 *   backward compatibility.
 */
export async function verifyOnChainGeneration(opts: {
  chainId: number;
  userAddress: string;
  nodeId: string;
  txHash?: string;
}): Promise<GenerationVerification> {
  const { chainId, userAddress, nodeId, txHash } = opts;
  if (!txHash) {
    return { ok: true };
  }

  const normalized = txHash.toLowerCase();
  const now = Date.now();
  for (const [k, v] of usedTxHashes) {
    if (v < now) usedTxHashes.delete(k);
  }
  if (usedTxHashes.has(normalized)) {
    return { ok: false, reason: "GENERATION_TX_REPLAYED" };
  }

  const client: PublicClient = getPublicClient(chainId);
  let receipt: any;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch {
    return { ok: false, reason: "GENERATION_TX_NOT_FOUND" };
  }
  if (!receipt || receipt.status !== "success") {
    return { ok: false, reason: "GENERATION_TX_REVERTED" };
  }

  const expectedNodeId = nodeIdToBytes32(nodeId).toLowerCase();
  const user = userAddress.toLowerCase();

  for (const log of receipt.logs) {
    const topic0 = (log.topics?.[0] ?? "").toLowerCase();
    const isGenerationEvent = topic0 === RECORDED_TOPIC || topic0 === PAID_TOPIC;
    if (!isGenerationEvent) continue;

    // topic1 = userWallet (address), topic2 = nodeId (bytes32) — both indexed.
    const walletTopic = log.topics?.[1] ?? "0x";
    const nodeIdTopic = log.topics?.[2] ?? "0x";
    const wallet = "0x" + walletTopic.slice(26).toLowerCase();
    if (wallet !== user) {
      return { ok: false, reason: "GENERATION_TX_WRONG_WALLET" };
    }
    if (nodeIdTopic.toLowerCase() !== expectedNodeId) {
      return { ok: false, reason: "GENERATION_TX_WRONG_NODE" };
    }

    usedTxHashes.set(normalized, now + REPLAY_TTL_MS);
    return { ok: true };
  }

  return { ok: false, reason: "GENERATION_EVENT_NOT_FOUND" };
}

/** Test-only: reset the replay guard. */
export function _resetGenerationTxGuardForTesting(): void {
  usedTxHashes.clear();
}

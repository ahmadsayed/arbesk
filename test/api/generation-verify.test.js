/**
 * On-chain generation verification (#48) — event decoding + replay guard.
 */
import { jest } from "@jest/globals";
import { encodeEventTopics, stringToHex, pad } from "viem";

const mockGetReceipt = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  getPublicClient: () => ({
    getTransactionReceipt: mockGetReceipt,
  }),
}));

const { verifyOnChainGeneration, _resetGenerationTxGuardForTesting } =
  await import("../../src/api/generation-verify.ts");

const WALLET = "0x1111111111111111111111111111111111111111";
const NODE_ID = "node-1";

const RECORDED_TOPIC = encodeEventTopics({
  abi: [
    {
      type: "event",
      name: "AssetGenerationRecorded",
      inputs: [
        { name: "userWallet", type: "address", indexed: true },
        { name: "nodeId", type: "bytes32", indexed: true },
        { name: "prompt", type: "string" },
        { name: "timestamp", type: "uint256" },
        { name: "countToday", type: "uint256" },
      ],
    },
  ],
  eventName: "AssetGenerationRecorded",
})[0];

function addrTopic(addr) {
  return "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
}

function generationReceipt({ wallet = WALLET, nodeId = NODE_ID } = {}) {
  return {
    status: "success",
    logs: [
      {
        address: "0xcontract",
        topics: [
          RECORDED_TOPIC,
          addrTopic(wallet),
          pad(stringToHex(nodeId), { size: 32 }).toLowerCase(),
        ],
        data: "0x",
      },
    ],
  };
}

beforeEach(() => {
  _resetGenerationTxGuardForTesting();
  mockGetReceipt.mockReset();
});

test("no txHash is a no-op (backward compatible)", async () => {
  const r = await verifyOnChainGeneration({
    chainId: 84532,
    userAddress: WALLET,
    nodeId: NODE_ID,
  });
  expect(r).toEqual({ ok: true });
});

test("verifies a matching generation event", async () => {
  mockGetReceipt.mockResolvedValue(generationReceipt());
  const r = await verifyOnChainGeneration({
    chainId: 84532,
    userAddress: WALLET,
    nodeId: NODE_ID,
    txHash: "0xabc",
  });
  expect(r).toEqual({ ok: true });
});

test("rejects a replayed txHash", async () => {
  mockGetReceipt.mockResolvedValue(generationReceipt());
  const opts = { chainId: 84532, userAddress: WALLET, nodeId: NODE_ID, txHash: "0xabc" };
  await verifyOnChainGeneration(opts);
  const r = await verifyOnChainGeneration(opts);
  expect(r).toEqual({ ok: false, reason: "GENERATION_TX_REPLAYED" });
});

test("rejects a wrong wallet", async () => {
  mockGetReceipt.mockResolvedValue(
    generationReceipt({ wallet: "0x2222222222222222222222222222222222222222" })
  );
  const r = await verifyOnChainGeneration({
    chainId: 84532,
    userAddress: WALLET,
    nodeId: NODE_ID,
    txHash: "0xabc",
  });
  expect(r).toEqual({ ok: false, reason: "GENERATION_TX_WRONG_WALLET" });
});

test("rejects a receipt with no generation event", async () => {
  mockGetReceipt.mockResolvedValue({ status: "success", logs: [] });
  const r = await verifyOnChainGeneration({
    chainId: 84532,
    userAddress: WALLET,
    nodeId: NODE_ID,
    txHash: "0xabc",
  });
  expect(r).toEqual({ ok: false, reason: "GENERATION_EVENT_NOT_FOUND" });
});

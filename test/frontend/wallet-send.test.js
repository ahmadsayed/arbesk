/**
 * @jest-environment jsdom
 *
 * wallet-send.ts — wallet-agnostic contract sending via the injected Signer,
 * with calldata encoded by viem `encodeFunctionData` and gas resolved through
 * the viem read client (real wallet-gas, mocked viem-clients).
 */
import { jest } from "@jest/globals";
import { encodeFunctionData } from "viem";

const CONTRACT = "0x0000000000000000000000000000000000000001";
const HASH = "0xUserOp";
const FROM = "0x00000000000000000000000000000000000000aa";

const BURN_ABI = [
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
  },
];

// Inherited ERC-721 overload pair — pins full-signature functionName narrowing.
const SAFE_TRANSFER_ABI = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
  },
];

let _signerSend;
let _wait;
let _estimateGas;

async function loadModule() {
  _wait = jest.fn().mockResolvedValue({ transactionHash: "0xTx", status: true });
  _signerSend = jest.fn().mockResolvedValue({ hash: HASH, wait: _wait });
  _estimateGas = jest.fn(async () => 100000n);
  const signer = {
    getAddress: () => FROM,
    getSignerAddress: () => FROM,
    sendTransaction: _signerSend,
  };

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.ts",
    () => ({
      getSigner: () => signer,
      getActiveConnectionSource: () => "injected",
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/viem-clients.ts",
    () => ({
      getReadClient: jest.fn(() => ({ estimateGas: _estimateGas })),
      getWalletClient: jest.fn(),
    })
  );

  const emit = jest.fn();
  await jest.unstable_mockModule(
    "@arbesk/asset-core/events/bus.js",
    () => ({
      emit,
      EVENTS: { ASSET_PUBLISH_PENDING: "assetPublishPending" },
    })
  );

  const mod = await import("../../frontend/src/js/blockchain/wallet-send.ts");
  return { mod, emit };
}

beforeEach(() => {
  jest.resetModules();
});

test("encodes calldata with viem and routes the send through the injected signer", async () => {
  const { mod } = await loadModule();

  const result = await mod.sendContractCall({
    to: CONTRACT,
    abi: BURN_ABI,
    functionName: "burn(uint256,bytes32[])",
    args: [7n, []],
  });

  // Oracle: the exact bytes viem produces (selector included).
  const expectedData = encodeFunctionData({
    abi: BURN_ABI,
    functionName: "burn",
    args: [7n, []],
  });
  const sent = _signerSend.mock.calls[0][0];
  expect(sent.to).toBe(CONTRACT);
  expect(sent.data).toBe(expectedData);
  expect(sent.data.slice(0, 10)).toBe(expectedData.slice(0, 10)); // 4-byte selector
  // Real wallet-gas: 100000n estimate padded by 20%.
  expect(sent.gas).toBe(120000n);
  // Estimation ran as the connected account against the target contract.
  expect(_estimateGas).toHaveBeenCalledWith({
    account: FROM,
    to: CONTRACT,
    data: expectedData,
  });

  // Broadcast resolves immediately; the mined receipt comes from wait().
  expect(result.hash).toBe(HASH);
  const receipt = await result.wait();
  expect(receipt.transactionHash).toBe("0xTx");
  expect(_wait).toHaveBeenCalled();
});

test("narrows a full-signature functionName to the matching overload", async () => {
  const { mod } = await loadModule();
  const from = "0x0000000000000000000000000000000000000001";
  const to = "0x0000000000000000000000000000000000000002";

  await mod.sendContractCall({
    to: CONTRACT,
    abi: SAFE_TRANSFER_ABI,
    functionName: "safeTransferFrom(address,address,uint256)",
    args: [from, to, 1n],
  });

  // Oracle: the 3-arg overload only.
  const expectedData = encodeFunctionData({
    abi: [SAFE_TRANSFER_ABI[0]],
    functionName: "safeTransferFrom",
    args: [from, to, 1n],
  });
  expect(_signerSend.mock.calls[0][0].data).toBe(expectedData);
});

test("emits ASSET_PUBLISH_PENDING with the broadcast hash when pendingPayload is given", async () => {
  const { mod, emit } = await loadModule();

  await mod.sendContractCall({
    to: CONTRACT,
    abi: BURN_ABI,
    functionName: "burn",
    args: [7n, []],
    pendingPayload: { tokenId: "42" },
  });

  expect(emit).toHaveBeenCalledWith("assetPublishPending", {
    tokenId: "42",
    txHash: HASH,
  });
});

test("throws when no signer is connected", async () => {
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.ts",
    () => ({
      getSigner: () => null,
      getActiveConnectionSource: () => "injected",
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/viem-clients.ts",
    () => ({
      getReadClient: jest.fn(() => ({ estimateGas: _estimateGas })),
      getWalletClient: jest.fn(),
    })
  );
  const mod = await import("../../frontend/src/js/blockchain/wallet-send.ts");

  await expect(
    mod.sendContractCall({
      to: CONTRACT,
      abi: BURN_ABI,
      functionName: "burn",
      args: [7n, []],
    })
  ).rejects.toThrow("no signer connected");
});

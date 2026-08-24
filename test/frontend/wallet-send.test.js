/**
 * @jest-environment jsdom
 *
 * wallet-send.js — wallet-agnostic contract sending via the injected Signer.
 */
import { jest } from "@jest/globals";

const CONTRACT = "0xContract";
const HASH = "0xUserOp";

let _signerSend;
let _wait;

async function loadModule() {
  _wait = jest.fn().mockResolvedValue({ transactionHash: "0xTx", status: true });
  _signerSend = jest.fn().mockResolvedValue({ hash: HASH, wait: _wait });
  const signer = {
    getAddress: () => "0xWallet",
    getSignerAddress: () => "0xWallet",
    sendTransaction: _signerSend,
  };

  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.js",
    () => ({ getSigner: () => signer })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-gas.js",
    () => ({ resolveGas: jest.fn().mockResolvedValue(100000) })
  );

  const emit = jest.fn();
  await jest.unstable_mockModule(
    "../../frontend/src/js/asset-core/events/bus.js",
    () => ({
      emit,
      EVENTS: { ASSET_PUBLISH_PENDING: "assetPublishPending" },
    })
  );

  const mod = await import("../../frontend/src/js/blockchain/wallet-send.js");
  return { mod, emit };
}

beforeEach(() => {
  jest.resetModules();
});

test("encodes the method and routes send through the injected signer", async () => {
  const { mod } = await loadModule();
  const method = { encodeABI: jest.fn().mockReturnValue("0xDATA") };

  const receipt = await mod.sendContractMethod(CONTRACT, method, {
    fallbackGas: 120000,
  });

  expect(receipt.transactionHash).toBe("0xTx");
  expect(method.encodeABI).toHaveBeenCalled();
  expect(_signerSend).toHaveBeenCalledWith(
    expect.objectContaining({ to: CONTRACT, data: "0xDATA", gas: 100000 })
  );
  expect(_wait).toHaveBeenCalled();
});

test("emits ASSET_PUBLISH_PENDING with the broadcast hash when pendingPayload is given", async () => {
  const { mod, emit } = await loadModule();
  const method = { encodeABI: jest.fn().mockReturnValue("0xDATA") };

  await mod.sendContractMethod(CONTRACT, method, {
    pendingPayload: { tokenId: "42" },
  });

  expect(emit).toHaveBeenCalledWith("assetPublishPending", {
    tokenId: "42",
    txHash: HASH,
  });
});

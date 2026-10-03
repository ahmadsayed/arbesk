/**
 * CDP server signer tests.
 */
import { describe, expect, jest, test } from "bun:test";
import { createCdpServerSigner } from "../../src/api/cdp-signer.ts";

function makeSigner(statuses) {
  const getOperation = jest.fn(async () => (statuses.length > 1 ? statuses.shift() : statuses[0]));
  const cdp = {
    endUser: { sendUserOperation: jest.fn(async () => ({ userOpHash: "0xop" })) },
  };
  const signer = createCdpServerSigner({ cdp, userId: "u1", address: "0xabc", chainId: 84532, getOperation });
  return { signer, getOperation };
}

describe("cdp server signer wait()", () => {
  test("resolves as soon as the tx hash is set, before status reaches complete", async () => {
    const { signer, getOperation } = makeSigner([{ status: "broadcast", transactionHash: "0xtx" }]);
    const sent = await signer.sendTransaction({ to: "0xcont", data: "0x" });
    const receipt = await sent.wait();
    expect(receipt).toEqual({ transactionHash: "0xtx", status: true });
    expect(getOperation).toHaveBeenCalledTimes(1);
  });

  test("reports failed ops as status false even when a tx hash is set", async () => {
    const { signer } = makeSigner([{ status: "failed", transactionHash: "0xtx" }]);
    const sent = await signer.sendTransaction({ to: "0xcont", data: "0x" });
    expect(await sent.wait()).toEqual({ transactionHash: "0xtx", status: false });
  });
});

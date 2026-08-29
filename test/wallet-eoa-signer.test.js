/**
 * createEoaSigner: EIP-1193 provider in, Signer port out. personal_sign must
 * carry exactly [message, address] (no web3-style empty password param), and
 * sendTransaction resolves the hash at broadcast with wait() polling the
 * receipt.
 */
import { jest } from "@jest/globals";
import { createEoaSigner } from "@arbesk/wallet/adapters/eoa.js";

function fakeProvider(handler) {
  const calls = [];
  return { calls, request: jest.fn(async ({ method, params }) => { calls.push({ method, params }); return handler(method, params); }) };
}

describe("createEoaSigner (EIP-1193)", () => {
  test("signMessage issues personal_sign with [message, address] only", async () => {
    const p = fakeProvider(() => "0xsig");
    const s = createEoaSigner(p, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    await s.signMessage("hello");
    const call = p.calls.find((c) => c.method === "personal_sign");
    expect(call.params).toHaveLength(2);
  });

  test("sendTransaction returns hash and wait() resolves a mined receipt", async () => {
    const p = fakeProvider((method) => {
      if (method === "eth_sendTransaction") return "0xhash";
      if (method === "eth_getTransactionReceipt") return { transactionHash: "0xhash", status: "0x1", blockNumber: "0x7" };
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_blockNumber") return "0x7";
      throw new Error("unexpected " + method);
    });
    const s = createEoaSigner(p, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    const res = await s.sendTransaction({ to: "0x0000000000000000000000000000000000000001", data: "0x" });
    expect(res.hash).toBe("0xhash");
    const receipt = await res.wait();
    expect(receipt.transactionHash).toBe("0xhash");
    expect(receipt.status).toBe(true);
  });
});

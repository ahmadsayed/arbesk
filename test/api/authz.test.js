/**
 * Backend authz wiring tests (P2c).
 */
import { jest } from "@jest/globals";
import { makeChainReadPort } from "../../src/api/authz.ts";

describe("authz wiring", () => {
  test("makeChainReadPort maps readContract calls to ChainReadPort", async () => {
    const calls = [];
    const fakeClient = {
      readContract: jest.fn(async (opts) => {
        calls.push(opts);
        if (opts.functionName === "ownerOf") return "0x0wner000000000000000000000000000000000000";
        if (opts.functionName === "editorRoot") return "0xroot";
        if (opts.functionName === "editorSetVersion") return 3n;
        return "ipfs://cid";
      }),
    };

    const port = makeChainReadPort(84532, "0xcont", fakeClient);
    expect(await port.ownerOf("7")).toBe("0x0wner000000000000000000000000000000000000");
    expect(await port.editorRoot("7")).toBe("0xroot");
    expect(await port.editorSetVersion("7")).toBe("3");
    expect(await port.tokenURI("7")).toBe("ipfs://cid");

    expect(calls.map((c) => c.functionName)).toEqual(["ownerOf", "editorRoot", "editorSetVersion", "tokenURI"]);
    for (const c of calls) {
      expect(c.address).toBe("0xcont");
      expect(c.args).toEqual([7n]);
    }
  });
});

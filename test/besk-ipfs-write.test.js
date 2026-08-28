/**
 * besk IPFS write port: uploads go through a backend-minted upload credential
 * (POST /api/v1/ipfs/upload-url, session-gated) instead of a hard-coded local
 * Kubo — this is what makes the CLI work on testnet (Pinata presigned-put).
 */
import { jest } from "@jest/globals";

const SESSION = {
  token: "tok123",
  expiresAt: Date.now() + 3600_000,
  address: "0xabc",
  email: "a@b.c",
  authMethod: "siwe",
};

jest.unstable_mockModule("../packages/besk/src/session.ts", () => ({
  loadSession: jest.fn(() => SESSION),
}));

const { createIpfsWritePort } = await import("../packages/besk/src/adapters.ts");

describe("besk ipfs write port (credential-based)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("mints a credential with the session token, then uploads via the kubo-api strategy", async () => {
    const calls = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      calls.push({ url: String(url), method: opts?.method, headers: opts?.headers });
      if (String(url).includes("/api/v1/ipfs/upload-url")) {
        return new Response(JSON.stringify({
          strategy: "kubo-api",
          apiUrl: "http://127.0.0.1:5001",
          reusable: true,
        }));
      }
      if (String(url).includes("/api/v0/add")) {
        return new Response(JSON.stringify({ Hash: "bafyX", Size: 10 }));
      }
      return new Response("{}", { status: 200 }); // pin/add
    });

    const port = createIpfsWritePort();
    const cid = await port.writeJSON({ type: "collection", assets: {} });

    expect(cid).toBe("bafyX");
    const mint = calls.find((c) => c.url.includes("/upload-url"));
    expect(mint.headers.Authorization).toBe("Session tok123");
  });

  test("reuses a reusable kubo credential (one mint for two writes)", async () => {
    const calls = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes("/upload-url")) {
        return new Response(JSON.stringify({ strategy: "kubo-api", apiUrl: "http://127.0.0.1:5001", reusable: true }));
      }
      if (String(url).includes("/api/v0/add")) return new Response(JSON.stringify({ Hash: "bafyY" }));
      return new Response("{}");
    });

    const port = createIpfsWritePort();
    await port.writeJSON({ a: 1 });
    await port.writeJSON({ a: 2 });

    expect(calls.filter((u) => u.includes("/upload-url"))).toHaveLength(1);
  });

  test("uploads each write against a fresh presigned-put credential (single-use)", async () => {
    const calls = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes("/upload-url")) {
        return new Response(JSON.stringify({ strategy: "presigned-put", url: "https://pinata.example/signed/" + calls.length }));
      }
      return new Response(JSON.stringify({ data: { cid: "bafyZ" } }));
    });

    const port = createIpfsWritePort();
    await port.writeJSON({ a: 1 });
    await port.writeJSON({ a: 2 });

    expect(calls.filter((u) => u.includes("/upload-url"))).toHaveLength(2);
    expect(calls.filter((u) => u.includes("pinata.example"))).toHaveLength(2);
  });
});

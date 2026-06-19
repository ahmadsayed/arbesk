/** @jest-environment jsdom */
import { jest } from "@jest/globals";

describe("getUploadCredential", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("POSTs to /api/v1/ipfs/upload-url with the session header and returns the credential", async () => {
    const TEST_ADDRESS = "0xTestAddress000000000000000000000000000000";
    const TEST_TOKEN = "test-token";

    const { walletState, _resetForTesting } = await import("../../frontend/src/js/state/wallet-state.js");
    _resetForTesting();
    walletState.set({ walletAddress: TEST_ADDRESS, chainId: 1 });

    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ backend: "pinata", url: "https://signed", gateway: "https://gw/ipfs/" }),
    }));
    global.fetch = fetchMock;

    localStorage.setItem(
      "arbesk_session",
      JSON.stringify({ token: TEST_TOKEN, expiresAt: Date.now() + 60_000, address: TEST_ADDRESS.toLowerCase() })
    );

    const { getUploadCredential } = await import("../../frontend/src/js/services/api.js");
    const cred = await getUploadCredential();

    expect(cred.backend).toBe("pinata");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/ipfs\/upload-url$/);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Session ${TEST_TOKEN}`);
  });
});

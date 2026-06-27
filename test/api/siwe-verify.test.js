import { jest } from "@jest/globals";

const recoverMock = jest.fn();

jest.unstable_mockModule("../../src/config.js", () => ({
  web3: {
    eth: {
      accounts: { recover: recoverMock },
    },
  },
}));

let verifySiwe;
let parseSiweMessage;

beforeAll(async () => {
  const siweModule = await import("../../src/api/siwe-verify.js");
  verifySiwe = siweModule.verifySiwe;
  parseSiweMessage = siweModule.parseSiweMessage;
});

function buildSiweMessage({
  domain = "localhost:9090",
  address = "0x1234567890123456789012345678901234567890",
  nonce = "abcdef1234567890",
  chainId = 31415822,
  issuedAt = new Date().toISOString(),
} = {}) {
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Arbesk Studio\n\nURI: localhost:9090\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

describe("siwe-verify", () => {
  beforeEach(() => {
    recoverMock.mockReset();
    recoverMock.mockResolvedValue(
      "0x1234567890123456789012345678901234567890",
    );
  });

  it("verifies a valid message and signature", async () => {
    const message = buildSiweMessage({ nonce: "nonceValid01" });
    const result = await verifySiwe(message, "0xSignature", {
      expectedDomain: "localhost:9090",
    });
    expect(result.valid).toBe(true);
    expect(result.address).toBe("0x1234567890123456789012345678901234567890");
    expect(result.error).toBeNull();
  });

  it("rejects an invalid message format", async () => {
    const result = await verifySiwe("not a siwe message", "0xSignature");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid SIWE message format/i);
  });

  it("tolerates protocol difference in domain binding", async () => {
    const message = buildSiweMessage({
      domain: "https://localhost:9090",
      nonce: "nonceProto01",
    });
    const result = await verifySiwe(message, "0xSignature", {
      expectedDomain: "localhost:9090",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a real domain mismatch", async () => {
    const message = buildSiweMessage({
      domain: "evil.com",
      nonce: "nonceDomain1",
    });
    const result = await verifySiwe(message, "0xSignature", {
      expectedDomain: "localhost:9090",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Domain mismatch/i);
  });

  it("rejects unsupported chain ID", async () => {
    const message = buildSiweMessage({ nonce: "nonceChain01", chainId: 999 });
    const result = await verifySiwe(message, "0xSignature");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unsupported chain ID/i);
  });

  it("rejects expired messages", async () => {
    const issuedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const message = buildSiweMessage({ nonce: "nonceExpire1", issuedAt });
    const result = await verifySiwe(message, "0xSignature");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too old/i);
  });

  it("rejects future timestamps", async () => {
    const issuedAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const message = buildSiweMessage({ nonce: "nonceFuture1", issuedAt });
    const result = await verifySiwe(message, "0xSignature");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/future/i);
  });

  it("rejects signature mismatch", async () => {
    recoverMock.mockResolvedValue("0x0000000000000000000000000000000000000000");
    const message = buildSiweMessage({ nonce: "nonceMismatch1" });
    const result = await verifySiwe(message, "0xSignature");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Signature does not match/i);
  });

  it("rejects nonce replay", async () => {
    const message = buildSiweMessage({ nonce: "reusedNonce12345" });
    const result1 = await verifySiwe(message, "0xSignature");
    expect(result1.valid).toBe(true);

    const result2 = await verifySiwe(message, "0xSignature");
    expect(result2.valid).toBe(false);
    expect(result2.error).toMatch(/Nonce has already been used/i);
  });

  it("parseSiweMessage returns structured fields", () => {
    const message = buildSiweMessage();
    const parsed = parseSiweMessage(message);
    expect(parsed).toMatchObject({
      domain: "localhost:9090",
      version: "1",
      chainId: 31415822,
      nonce: "abcdef1234567890",
    });
  });
});

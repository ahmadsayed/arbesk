import { jest } from "@jest/globals";

const jwtVerifyMock = jest.fn();
const decodeJwtMock = jest.fn();

jest.unstable_mockModule("jose", () => ({
  jwtVerify: jwtVerifyMock,
  decodeJwt: decodeJwtMock,
  createRemoteJWKSet: jest.fn(() => ({ mock: "jwks" })),
}));

let verifyThirdwebAuthToken;

beforeAll(async () => {
  const mod = await import("../../src/api/thirdweb-auth.js");
  verifyThirdwebAuthToken = mod.verifyThirdwebAuthToken;
});

describe("thirdweb-auth", () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
    decodeJwtMock.mockReset();
    decodeJwtMock.mockReturnValue({
      address: "0x1234567890123456789012345678901234567890",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  it("returns the wallet address from the address claim", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        address: "0x1234567890123456789012345678901234567890",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const result = await verifyThirdwebAuthToken("valid-jwt");

    expect(result.valid).toBe(true);
    expect(result.address).toBe("0x1234567890123456789012345678901234567890");
    expect(result.error).toBeNull();
  });

  it("falls back to walletAddress claim when address is absent", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: {
        walletAddress: "0xABCDEF00112233445566778899aabbccddeeff00",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const result = await verifyThirdwebAuthToken("valid-jwt");

    expect(result.valid).toBe(true);
    expect(result.address).toBe("0xabcdef00112233445566778899aabbccddeeff00");
  });

  it("rejects when no valid Ethereum address claim is present", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "user_123", exp: Math.floor(Date.now() / 1000) + 3600 },
    });

    const result = await verifyThirdwebAuthToken("bad-jwt");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/valid wallet address/i);
  });

  it("rejects when jwtVerify throws", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("invalid signature"));

    const result = await verifyThirdwebAuthToken("bad-jwt");

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid signature/i);
  });

  it("decodes without verification in dev mode", async () => {
    const originalEnv = process.env.THIRDWB_AUTH_DEV_MODE;
    process.env.THIRDWB_AUTH_DEV_MODE = "true";
    try {
      // jwtVerify is not called in dev mode; decodeJwt is used instead.
      jwtVerifyMock.mockRejectedValue(new Error("should not be called"));

      const result = await verifyThirdwebAuthToken("valid-jwt");

      expect(result.valid).toBe(true);
      expect(result.address).toBe("0x1234567890123456789012345678901234567890");
      expect(jwtVerifyMock).not.toHaveBeenCalled();
    } finally {
      process.env.THIRDWB_AUTH_DEV_MODE = originalEnv;
    }
  });
});

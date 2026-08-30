/** @jest-environment jsdom */
import { jest } from "@jest/globals";

function flush(rounds = 12) {
  return Promise.all(
    Array.from({ length: rounds }, () => new Promise((r) => setTimeout(r, 0)))
  );
}

async function load({ config = { cdpProjectId: "proj-1" }, cdp = {} } = {}) {
  jest.resetModules();
  document.body.innerHTML = "";
  global.requestAnimationFrame = (cb) => { cb(0); return 0; };
  // jsdom focus() re-fires focusin synchronously, which the modal's focus trap
  // re-focuses — an infinite recursion in tests. Stub focus to a no-op.
  HTMLElement.prototype.focus = function focus() {};

  const getWallets = jest.fn(() => []);
  const requestWallets = jest.fn();
  const onWalletsUpdated = jest.fn(() => () => {});
  const escapeHtml = jest.fn((s) => s);

  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-discovery.js", () => ({
    requestWallets,
    onWalletsUpdated,
    getWallets,
  }));
  await jest.unstable_mockModule("../../frontend/src/js/utils/html.js", () => ({
    escapeHtml,
  }));

  const getConfig = jest.fn(async () => config);
  await jest.unstable_mockModule("../../frontend/src/js/services/backend-client.js", () => ({
    getConfig,
  }));

  const initCdpClient = jest.fn(async () => {});
  const resetCdpStorage = jest.fn(async () => {});
  const requestEmailOtp = cdp.requestEmailOtp || jest.fn(async () => ({ flowId: "flow-1" }));
  const verifyEmailOtp = cdp.verifyEmailOtp || jest.fn(async () => {});
  const autoConnectCdpWallet = cdp.autoConnectCdpWallet || jest.fn(async () => ({
    smartAccountAddress: "0xSmart",
    eoaAddress: "0xEoa",
  }));
  await jest.unstable_mockModule("../../frontend/src/js/blockchain/wallet-cdp.js", () => ({
    initCdpClient,
    resetCdpStorage,
    requestEmailOtp,
    verifyEmailOtp,
    autoConnectCdpWallet,
  }));

  const mod = await import("../../frontend/src/js/ui/wallet-modal.js");
  return { mod, requestEmailOtp, verifyEmailOtp, autoConnectCdpWallet };
}

function openAndSend(mod, email) {
  const promise = mod.showWalletModal();
  document.getElementById("walletEmailInput").value = email;
  document.getElementById("walletEmailSendBtn").click();
  return promise;
}

describe("selectEmailWallet (CDP email OTP flow)", () => {
  test("rejects an invalid email without calling requestEmailOtp", async () => {
    const { mod, requestEmailOtp } = await load();
    openAndSend(mod, "not-an-email");
    await flush();

    expect(document.getElementById("walletEmailError").textContent).toBe(
      "Please enter a valid email address."
    );
    expect(requestEmailOtp).not.toHaveBeenCalled();
  });

  test("shows a not-configured error when cdpProjectId is missing", async () => {
    const { mod, requestEmailOtp } = await load({ config: {} });
    openAndSend(mod, "user@example.com");
    await flush();

    expect(document.getElementById("walletEmailError").textContent).toBe(
      "Email sign-in is not configured. Contact support."
    );
    expect(requestEmailOtp).not.toHaveBeenCalled();
  });

  test("resolves with the CDP wallet after a successful OTP verify", async () => {
    const { mod, requestEmailOtp, verifyEmailOtp } = await load();
    const promise = openAndSend(mod, "user@example.com");
    await flush();

    expect(document.getElementById("walletEmailStep").style.display).toBe("none");
    expect(document.getElementById("walletOtpStep").style.display).toBe("");
    expect(requestEmailOtp).toHaveBeenCalledWith("user@example.com");

    document.getElementById("walletOtpInput").value = "123456";
    document.getElementById("walletOtpVerifyBtn").click();
    await flush();

    await expect(promise).resolves.toEqual({
      provider: null,
      source: "cdp",
      walletAddress: "0xSmart",
      eoaAddress: "0xEoa",
      email: "user@example.com",
    });
    expect(verifyEmailOtp).toHaveBeenCalledWith("flow-1", "123456");
  });

  test("shows an error when the OTP input is empty", async () => {
    const { mod, verifyEmailOtp } = await load();
    openAndSend(mod, "user@example.com");
    await flush();

    document.getElementById("walletOtpVerifyBtn").click();
    await flush();

    expect(document.getElementById("walletOtpError").textContent).toBe(
      "Please enter the code from your email."
    );
    expect(verifyEmailOtp).not.toHaveBeenCalled();
  });

  test("surfaces the verify error and re-enables the verify button", async () => {
    const verifyEmailOtp = jest.fn(async () => {
      throw new Error("Invalid code");
    });
    const { mod } = await load({ cdp: { verifyEmailOtp } });
    openAndSend(mod, "user@example.com");
    await flush();
    document.getElementById("walletOtpInput").value = "000000";
    document.getElementById("walletOtpVerifyBtn").click();
    await flush();

    expect(document.getElementById("walletOtpError").textContent).toBe("Invalid code");
    expect(verifyEmailOtp).toHaveBeenCalledWith("flow-1", "000000");
    const btn = document.getElementById("walletOtpVerifyBtn");
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Verify");
  });
});

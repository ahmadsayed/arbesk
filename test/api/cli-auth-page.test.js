// @test-env dom
/**
 * Behaviour of the CLI login page (src/api/cli-auth.html, /api/v1/cli-auth).
 *
 * The page is a static HTML file with one inline module script. These tests
 * run that script in jsdom with its dynamic imports, fetch and window.location
 * injected, so the CDP SDK and the wallet package are stubs.
 *
 * #137: the page used to email a code on every load, so a refresh or a second
 * tab made the earlier code useless with no way to recover. It now emails a
 * code only when asked, and offers "Send a new code".
 */

import { describe, expect, jest, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const HTML = fs.readFileSync(
  path.resolve(import.meta.dir, "../../src/api/cli-auth.html"),
  "utf8",
);

const ORIGIN = "https://promptscad.com";
const SMART = "0x1111111111111111111111111111111111111111";
const EOA = "0x2222222222222222222222222222222222222222";

/** @param {string} id */
const $ = (id) => /** @type {any} */ (document.getElementById(id));

/**
 * Polls until `check` returns truthy; the page's handlers are async.
 *
 * @param {() => unknown} check
 * @param {string} what
 */
async function waitFor(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("timed out waiting for " + what);
}

function makeCdp({ flows = ["flow-1", "flow-2", "flow-3"] } = {}) {
  let sent = 0;
  return {
    initialize: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    signInWithEmail: jest.fn(async () => ({ flowId: flows[sent++] })),
    verifyEmailOTP: jest.fn(async () => ({
      user: { evmSmartAccounts: [SMART], evmAccounts: [EOA] },
    })),
    signEvmMessage: jest.fn(async () => ({ signature: "0xsig" })),
    createDelegation: jest.fn(async () => {}),
  };
}

function makeWallet() {
  return {
    buildSiweProof: jest.fn(async ({ signer, address, chainId, domain }) => ({
      kind: "siwe",
      message: `${domain} ${address} ${chainId}`,
      signature: await signer.signMessage("msg"),
      eoaAddress: signer.getSignerAddress(),
    })),
  };
}

/**
 * Renders the page into the jsdom document and runs its module script.
 *
 * @param {{ search?: string, cdp?: any, wallet?: any, config?: any }} [opts]
 */
function loadPage({
  search = "?email=dev%40example.com&port=5123",
  cdp = makeCdp(),
  wallet = makeWallet(),
  config = { cdpProjectId: "test-project" },
} = {}) {
  const page = new DOMParser().parseFromString(HTML, "text/html");
  const script = /** @type {HTMLScriptElement} */ (
    page.querySelector('script[type="module"]')
  );
  const code = script.textContent ?? "";
  script.remove();
  document.body.innerHTML = page.body.innerHTML;

  const location = { search, origin: ORIGIN, href: `${ORIGIN}/api/v1/cli-auth${search}` };
  const fetchMock = jest.fn(async (url, init) => {
    if (url === "/api/v1/config") return Response.json(config);
    if (url === "/api/v1/sessions") {
      return Response.json({ token: "session-token", expiresAt: 1234 });
    }
    throw new Error("unexpected fetch " + url + JSON.stringify(init));
  });
  const importMock = async (/** @type {string} */ specifier) => {
    if (specifier === "@coinbase/cdp-core") return cdp;
    if (specifier === "@arbesk/wallet/facade.js") return wallet;
    throw new Error("unexpected import " + specifier);
  };

  // `import(` is syntax, not a function; rename it so the stub can stand in.
  // "use strict" because a module script is strict.
  const body = '"use strict";\n' + code.replace(/\bimport\(/g, "__import(");
  const run = new Function("__import", "fetch", "window", body);
  run(importMock, fetchMock, { location });
  return { cdp, wallet, fetchMock, location };
}

const visible = (id) => !$(id).hidden;

/**
 * Chromium moves focus to <body> when the focused button is disabled; jsdom
 * keeps it (and ignores blur() on a disabled element). Focusing a throwaway
 * element and removing it leaves focus on <body>, as in the browser. Failing
 * stubs call this so the tests see the browser's state.
 */
function dropFocusLikeChromium() {
  const sink = document.createElement("input");
  document.body.append(sink);
  sink.focus();
  sink.remove();
}

async function sendFirstCode() {
  await waitFor(() => visible("step-send"), "the send step");
  $("send").click();
  await waitFor(() => visible("step-code"), "the code step");
}

/**
 * Submits the code form the way the browser does, and checks the page cancels
 * the native submit: a real GET submit would reload the page without its
 * email and port parameters. (jsdom does not navigate, so clicking Verify
 * cannot catch a missing preventDefault.)
 */
async function submitCode(code) {
  $("code").value = code;
  const submit = new Event("submit", { cancelable: true });
  $("code-form").dispatchEvent(submit);
  expect(submit.defaultPrevented).toBe(true);
}

describe("CLI login page", () => {
  test("does not email a code until asked", async () => {
    const { cdp } = loadPage();

    await waitFor(() => visible("step-send"), "the send step");

    expect(cdp.initialize).toHaveBeenCalledTimes(1);
    expect(cdp.signInWithEmail).not.toHaveBeenCalled();
    expect(visible("step-code")).toBe(false);
    expect($("send-email").textContent).toBe("dev@example.com");
  });

  test("emails one code when asked and shows the code step", async () => {
    const { cdp } = loadPage();

    await sendFirstCode();

    expect(cdp.signInWithEmail).toHaveBeenCalledTimes(1);
    expect(cdp.signInWithEmail).toHaveBeenCalledWith({ email: "dev@example.com" });
    expect(visible("step-send")).toBe(false);
    expect($("email").textContent).toBe("dev@example.com");
  });

  test("a verified code builds the SIWE proof, opens a session and hands the token to the CLI", async () => {
    const { cdp, wallet, fetchMock, location } = loadPage();
    await sendFirstCode();

    await submitCode(" 123456 ");
    await waitFor(() => location.href.startsWith("http://127.0.0.1"), "the CLI redirect");

    expect(cdp.verifyEmailOTP).toHaveBeenCalledWith({ flowId: "flow-1", otp: "123456" });
    expect(wallet.buildSiweProof).toHaveBeenCalledTimes(1);
    const opts = wallet.buildSiweProof.mock.calls[0][0];
    expect(opts).toMatchObject({ address: SMART, chainId: 84532, domain: ORIGIN });
    expect(opts.signer.getSignerAddress()).toBe(EOA);

    const sessionCall = fetchMock.mock.calls.find(([url]) => url === "/api/v1/sessions");
    expect(JSON.parse(sessionCall[1].body).proof).toMatchObject({ kind: "siwe", eoaAddress: EOA });

    const cb = new URL(location.href);
    expect(cb.origin).toBe("http://127.0.0.1:5123");
    expect(cb.searchParams.get("token")).toBe("session-token");
    expect(cb.searchParams.get("expiresAt")).toBe("1234");
    expect(cb.searchParams.get("address")).toBe(SMART);
    expect(cb.searchParams.get("email")).toBe("dev@example.com");
  });

  test("'Send a new code' starts a new flow, and Verify uses the newest one", async () => {
    const { cdp, location } = loadPage();
    await sendFirstCode();

    $("resend").click();
    await waitFor(() => cdp.signInWithEmail.mock.calls.length === 2, "the second code");
    await waitFor(() => !$("resend").disabled, "the resend to finish");
    await submitCode("654321");
    await waitFor(() => location.href.startsWith("http://127.0.0.1"), "the CLI redirect");

    expect(cdp.verifyEmailOTP).toHaveBeenCalledTimes(1);
    expect(cdp.verifyEmailOTP).toHaveBeenCalledWith({ flowId: "flow-2", otp: "654321" });
  });

  test("a rejected code leaves the page usable: the error shows and a new code can be sent", async () => {
    const cdp = makeCdp();
    cdp.verifyEmailOTP.mockImplementationOnce(async () => {
      dropFocusLikeChromium();
      throw new Error("Invalid or expired verification code");
    });
    const { location } = loadPage({ cdp });
    await sendFirstCode();

    await submitCode("000000");
    await waitFor(() => $("error").textContent !== "", "the error");

    expect($("error").textContent).toContain("Invalid or expired verification code");
    expect(visible("step-code")).toBe(true);
    expect(document.activeElement).toBe($("code"));
    expect($("verify").disabled).toBe(false);
    expect($("resend").disabled).toBe(false);

    $("resend").click();
    await waitFor(() => cdp.signInWithEmail.mock.calls.length === 2, "the second code");
    await waitFor(() => $("error").textContent === "", "the error to clear");
    await waitFor(() => !$("verify").disabled, "the resend to finish");
    await submitCode("111111");
    await waitFor(() => location.href.startsWith("http://127.0.0.1"), "the CLI redirect");

    expect(cdp.verifyEmailOTP).toHaveBeenLastCalledWith({ flowId: "flow-2", otp: "111111" });
  });

  test("a failure after the code is accepted shows the error instead of hanging", async () => {
    const wallet = makeWallet();
    wallet.buildSiweProof.mockImplementationOnce(async () => {
      throw new Error("error loading dynamically imported module");
    });
    loadPage({ wallet });
    await sendFirstCode();

    await submitCode("123456");
    await waitFor(() => $("error").textContent !== "", "the error");

    expect($("error").textContent).toContain("error loading dynamically imported module");
    expect($("resend").disabled).toBe(false);
  });

  test("a failed send can be retried", async () => {
    const cdp = makeCdp();
    cdp.signInWithEmail.mockImplementationOnce(async () => {
      dropFocusLikeChromium();
      throw new Error("rate limited");
    });
    loadPage({ cdp });
    await waitFor(() => visible("step-send"), "the send step");

    $("send").focus();
    $("send").click();
    await waitFor(() => $("error").textContent !== "", "the error");
    expect($("error").textContent).toContain("rate limited");
    expect(visible("step-send")).toBe(true);
    expect($("send").disabled).toBe(false);
    expect($("send").textContent).toBe("Email me a code");
    expect(document.activeElement).toBe($("send"));

    $("send").click();
    await waitFor(() => visible("step-code"), "the code step");
    expect($("error").textContent).toBe("");
  });

  for (const [label, search] of [
    ["the port is not a number", "?email=dev%40example.com&port=80%40evil.example%2F"],
    ["the port is out of range", "?email=dev%40example.com&port=70000"],
    ["the port is missing", "?email=dev%40example.com"],
    ["the email is missing", "?port=5123"],
  ]) {
    test(`refuses to start when ${label}`, async () => {
      const { cdp } = loadPage({ search });

      await waitFor(() => visible("step-failed"), "the failure");

      expect($("failed-message").textContent).toContain("besk login");
      expect(cdp.initialize).not.toHaveBeenCalled();
      expect(visible("step-send")).toBe(false);
    });
  }
});

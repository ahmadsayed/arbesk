/**
 * besk login: the browser-assisted callback server must release the browser's
 * keep-alive connection once the session arrives — otherwise the process
 * hangs after "Logged in as …" until the socket times out. And a missing email
 * argument prompts interactively on a TTY instead of just printing usage.
 */
import { jest } from "@jest/globals";
import http from "http";

const openBrowserMock = jest.fn();
jest.unstable_mockModule("../packages/besk/src/helpers.ts", () => ({
  openBrowser: openBrowserMock,
}));

const questionMock = jest.fn(async () => "Prompted@Example.com ");
jest.unstable_mockModule("readline/promises", () => ({
  createInterface: jest.fn(() => ({ question: questionMock, close: jest.fn() })),
}));

const saveSessionMock = jest.fn();
jest.unstable_mockModule("../packages/besk/src/session.ts", () => ({
  saveSession: saveSessionMock,
}));

const { login } = await import("../packages/besk/src/auth.ts");

/** Drive the callback server to a successful login; returns the opened URL. */
async function completeCallback() {
  await new Promise((r) => setImmediate(r));
  expect(openBrowserMock).toHaveBeenCalled();
  const url = openBrowserMock.mock.calls[0][0];
  const port = Number(new URL(url).searchParams.get("port"));
  await new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/?token=tok&address=0xabc" },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
  });
  return url;
}

describe("besk login", () => {
  beforeEach(() => {
    openBrowserMock.mockClear();
    questionMock.mockClear();
    saveSessionMock.mockClear();
  });

  test("saves the session and destroys the callback keep-alive socket", async () => {
    const loginPromise = login("User@Example.com");
    // openBrowser runs inside the async server.listen callback.
    await new Promise((r) => setImmediate(r));
    expect(openBrowserMock).toHaveBeenCalled();
    const url = openBrowserMock.mock.calls[0][0];
    expect(url).toContain("email=user%40example.com");
    const port = Number(new URL(url).searchParams.get("port"));

    // Keep-alive agent reproduces the browser holding the socket open.
    const agent = new http.Agent({ keepAlive: true });
    await new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/?token=tok&address=0xabc&expiresAt=" + (Date.now() + 60_000),
          agent,
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
    });

    await loginPromise;
    expect(saveSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", address: "0xabc", email: "user@example.com" }),
    );

    // The keep-alive socket must end up destroyed (socket teardown settles
    // asynchronously — poll briefly); pre-fix it lingered open for as long as
    // the browser tab held it, hanging the CLI process after "Logged in as…".
    let alive = 1;
    for (let i = 0; i < 50 && alive > 0; i++) {
      await new Promise((r) => setImmediate(r));
      const all = [...Object.values(agent.sockets), ...Object.values(agent.freeSockets)].flat();
      alive = all.filter((s) => !s.destroyed).length;
    }
    expect(alive).toBe(0);
    agent.destroy();
  });

  test("prompts for the email when the argument is missing on a TTY", async () => {
    const wasTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    try {
      const loginPromise = login();
      const url = await completeCallback();
      await loginPromise;
      expect(questionMock).toHaveBeenCalled();
      // Trimmed + lowercased before the browser flow starts.
      expect(url).toContain("email=prompted%40example.com");
      expect(saveSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: "prompted@example.com" }),
      );
    } finally {
      process.stdin.isTTY = wasTTY;
    }
  });

  test("keeps the usage error when the email is missing and stdin is not a TTY", async () => {
    const wasTTY = process.stdin.isTTY;
    process.stdin.isTTY = undefined;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await login();
      expect(process.exitCode).toBe(2);
      expect(openBrowserMock).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.flat().join(" ")).toMatch(/Usage: besk login/);
    } finally {
      process.stdin.isTTY = wasTTY;
      process.exitCode = undefined;
      errorSpy.mockRestore();
    }
  });
});

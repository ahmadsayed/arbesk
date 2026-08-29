/** Browser-assisted login: open a browser, CDP emails the code, session comes back. */
import http from "http";
import { createInterface } from "readline/promises";
import type { AddressInfo } from "net";
import { BACKEND_URL } from "./config.ts";
import { openBrowser } from "./helpers.ts";
import { saveSession } from "./session.ts";

interface CallbackResult {
  token: string;
  expiresAt: number;
  address: string;
  email: string;
}

export async function login(email?: string): Promise<void> {
  if (!email && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      email = (await rl.question("Email: ")).trim();
    } finally {
      rl.close();
    }
  }
  if (!email) {
    console.error("Usage: besk login <email>");
    process.exitCode = 2;
    return;
  }
  const normalized = email.trim().toLowerCase();
  console.log("Opening your browser for login (CDP will email a code)…");

  const result = await new Promise<CallbackResult>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = u.searchParams.get("token");
      const address = u.searchParams.get("address") ?? "";
      const emailParam = u.searchParams.get("email") ?? normalized;
      const expiresAt = Number(u.searchParams.get("expiresAt") ?? 0);
      res.end("Logged in. You can close this window and return to the terminal.");
      clearTimeout(timeout);
      // The browser keeps its connection alive (keep-alive); server.close()
      // alone waits for it and the CLI would hang after a successful login.
      server.closeAllConnections();
      server.close();
      if (token) resolve({ token, address, email: emailParam, expiresAt });
      else reject(new Error("No session token received"));
    });

    const timeout = setTimeout(() => {
      server.closeAllConnections();
      server.close();
      reject(new Error("Timed out waiting for login (5 min)"));
    }, 5 * 60 * 1000);

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      openBrowser(
        BACKEND_URL +
        "/api/v1/cli-auth?email=" +
        encodeURIComponent(normalized) +
        "&port=" +
        addr.port,
      );
    });
  });

  saveSession({
    token: result.token,
    expiresAt: result.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
    address: result.address,
    email: result.email,
    authMethod: "siwe",
  });
  console.log("Logged in as " + result.email);
}

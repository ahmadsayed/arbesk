/**
 * besk session store tests (P4a).
 */
import os from "os";
import path from "path";
import fs from "fs";
import { saveSession, loadSession, clearSession } from "../packages/besk/src/session.ts";

describe("besk session store", () => {
  const p = path.join(os.tmpdir(), "besk-test-" + process.pid + "-" + Date.now() + ".json");

  afterEach(() => clearSession(p));

  test("save/load round-trips a session", () => {
    saveSession({ token: "t1", expiresAt: Date.now() + 60000, address: "0xabc", email: "maya@studio.com", authMethod: "email" }, p);
    const s = loadSession(p);
    expect(s.token).toBe("t1");
    expect(s.email).toBe("maya@studio.com");
    expect(s.authMethod).toBe("email");
  });

  test("loadSession returns null for a missing file", () => {
    expect(loadSession(p)).toBeNull();
  });

  test("loadSession returns null for an expired session", () => {
    saveSession({ token: "t1", expiresAt: Date.now() - 1000, address: "0xabc", email: "maya@studio.com", authMethod: "email" }, p);
    expect(loadSession(p)).toBeNull();
  });

  test("clearSession removes the file", () => {
    saveSession({ token: "t1", expiresAt: Date.now() + 60000, address: "0xabc", email: "maya@studio.com", authMethod: "email" }, p);
    clearSession(p);
    expect(fs.existsSync(p)).toBe(false);
  });
});

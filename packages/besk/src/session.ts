/**
 * Session persistence. MVP: a JSON file under ~/.config/besk. The OS keychain
 * (Keychain / Secret Service / Credential Manager) is the intended backing
 * store and can be swapped in behind this same interface later.
 */
import fs from "fs";
import path from "path";
import { SESSION_PATH } from "./config.ts";
import { debug } from "./debug.ts";

export interface Session {
  token: string;
  expiresAt: number;
  address: string;
  email: string;
  authMethod: "email" | "siwe";
  activeCollectionTokenId?: string | null;
}

export function loadSession(sessionPath: string = SESSION_PATH): Session | null {
  try {
    const raw = fs.readFileSync(sessionPath, "utf8");
    const s = JSON.parse(raw) as Session;
    if (!s?.token) {
      debug("session load: no token in", sessionPath);
      return null;
    }
    if (s.expiresAt && s.expiresAt < Date.now()) {
      debug("session load: expired", new Date(s.expiresAt).toISOString());
      return null;
    }
    debug("session load:", s.email, "from", sessionPath);
    return s;
  } catch {
    debug("session load: no session file at", sessionPath);
    return null;
  }
}

export function saveSession(session: Session, sessionPath: string = SESSION_PATH): void {
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  debug("session saved:", session.email, "→", sessionPath);
}

export function clearSession(sessionPath: string = SESSION_PATH): void {
  try {
    fs.unlinkSync(sessionPath);
    debug("session cleared:", sessionPath);
  } catch {
    /* already gone */
  }
}

export function setActiveCollection(tokenId: string | null): void {
  const s = loadSession();
  if (!s) return;
  debug("active collection →", tokenId);
  s.activeCollectionTokenId = tokenId;
  saveSession(s);
}

export function whoami(): void {
  const s = loadSession();
  if (!s) {
    console.error("Not logged in. Run `besk login <email>`.");
    process.exitCode = 3;
    return;
  }
  console.log("User:    " + s.email);
  console.log("Wallet:  " + s.address);
  console.log("Auth:    " + s.authMethod);
}

export function logout(): void {
  clearSession();
  console.log("Logged out");
}

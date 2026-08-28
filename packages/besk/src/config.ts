/** CLI config: backend URL, chain id, and the persisted-session path. */
import os from "os";
import path from "path";

export const BACKEND_URL = process.env.ARBESK_BACKEND || "http://localhost:9090";
export const CHAIN_ID = Number(process.env.ARBESK_CHAIN_ID || 84532);
export const IPFS_API = process.env.ARBESK_IPFS_API || "http://127.0.0.1:5001";
export const SESSION_PATH =
  process.env.ARBESK_SESSION_PATH ||
  path.join(os.homedir(), ".config", "besk", "session.json");

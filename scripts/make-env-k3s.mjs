// @ts-nocheck — TODO: type properly (implicit any in helpers); scripts/ pattern
// Generates .env.k3s for the promptscad.com k3s deployment by extracting the
// needed secrets from the local .env files, so no manual copy-pasting.
// Run locally (never in CI):  node scripts/make-env-k3s.mjs
// The output file is gitignored (.env*). Values are masked in stdout.
//
// Key mapping notes:
//  - CONTRACT_ADDRESS comes from blockchain/.env's BASE_CONTRACT_ADDRESS (the
//    Base Sepolia free-tier deployment) — the root .env CONTRACT_ADDRESS is the
//    local Hardhat deployment and must NOT be used.
//  - PAID_CONTRACT_ADDRESS / USDC_TOKEN are local-dev only (not deployed on
//    testnet per blockchain/.env.example) and are intentionally omitted.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

/** Minimal .env parser: KEY=VALUE lines, `#` comments, optional quotes. */
function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const rootEnv = parseEnvFile(path.join(root, ".env"));
const chainEnv = parseEnvFile(path.join(root, "blockchain", ".env"));

// key in .env.k3s → where the value comes from
const FROM_ROOT_ENV = [
  "PINATA_JWT",
  "PINATA_GATEWAY",
  "NOSTR_SERVICE_PRIVATE_KEY",
  "CDP_PROJECT_ID",
  "CDP_PAYMASTER_URL",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "CDP_WALLET_SECRET",
  // CAD generation (src/api/routes/cad.ts) authenticates to DeepSeek with this
  // server-side key — it is not BYOK, so an unconfigured deployment answers
  // 503 CAD_NOT_CONFIGURED instead of prompting the user for a key.
  "DEEPSEEK_API_KEY",
];

// Optional: included when present, skipped with a note otherwise.
// RESEND_API_KEY — Resend-based email OTP routes (CDP email login uses CDP's
// own OTP and does not need it). GC_ADMIN_TOKEN — Kubo GC admin endpoint,
// irrelevant in Pinata mode.
const OPTIONAL_FROM_ROOT_ENV = ["RESEND_API_KEY", "GC_ADMIN_TOKEN"];

// Fixed values for the k3s deployment (non-secret).
const FIXED = {
  IPFS_BACKEND: "pinata",
  DEFAULT_CHAIN_ID: "84532",
  API_URL: "https://sepolia.base.org",
  NOSTR_RELAY_URL: "ws://nostr:7777",
  PUBLIC_NOSTR_URL: "wss://promptscad.com/nostr",
  PUBLIC_ORIGIN: "https://promptscad.com",
  MOCK_3D_GENERATION: "false",
};

const result = { ...FIXED };
const missing = [];

for (const key of FROM_ROOT_ENV) {
  if (rootEnv[key]) result[key] = rootEnv[key];
  else missing.push(`${key} (root .env)`);
}
const skipped = [];
for (const key of OPTIONAL_FROM_ROOT_ENV) {
  if (rootEnv[key]) result[key] = rootEnv[key];
  else skipped.push(key);
}
if (chainEnv.BASE_CONTRACT_ADDRESS) {
  result.CONTRACT_ADDRESS = chainEnv.BASE_CONTRACT_ADDRESS;
} else {
  missing.push("BASE_CONTRACT_ADDRESS (blockchain/.env) → CONTRACT_ADDRESS");
}

if (missing.length) {
  console.error("[ENV-K3S] Missing required values:");
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}
for (const k of skipped) console.log(`[ENV-K3S] optional ${k} not in root .env — skipped`);

const ORDER = [
  "IPFS_BACKEND", "PINATA_JWT", "PINATA_GATEWAY",
  "DEFAULT_CHAIN_ID", "API_URL", "CONTRACT_ADDRESS",
  "NOSTR_RELAY_URL", "PUBLIC_NOSTR_URL", "PUBLIC_ORIGIN", "NOSTR_SERVICE_PRIVATE_KEY",
  "CDP_PROJECT_ID", "CDP_PAYMASTER_URL", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET",
  "RESEND_API_KEY", "GC_ADMIN_TOKEN", "DEEPSEEK_API_KEY", "MOCK_3D_GENERATION",
];

const out = ORDER.filter((k) => result[k] !== undefined)
  .map((k) => `${k}=${result[k]}`)
  .join("\n") + "\n";
const outPath = path.join(root, ".env.k3s");
fs.writeFileSync(outPath, out, { mode: 0o600 });

const mask = (v) => (v.length <= 8 ? "****" : `${v.slice(0, 4)}…${v.slice(-4)}`);
console.log(`[ENV-K3S] wrote ${outPath} (chmod 600)`);
for (const k of ORDER) {
  if (result[k] !== undefined) console.log(`  ${k}=${mask(result[k])}`);
}

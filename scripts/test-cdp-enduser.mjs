#!/usr/bin/env node
/**
 * Verify CDP Secret API key credentials and test email → smart account
 * address resolution via the CDP server SDK (end-user management API).
 *
 * Usage:
 *   node scripts/test-cdp-enduser.mjs                 # list end users (read-only)
 *   node scripts/test-cdp-enduser.mjs alice@x.com     # look up one email
 *   node scripts/test-cdp-enduser.mjs alice@x.com --create  # pre-generate if missing
 *
 * Requires CDP_API_KEY_ID and CDP_API_KEY_SECRET in the root .env.
 */
import "dotenv/config";
import { CdpClient } from "@coinbase/cdp-sdk";

const email = process.argv[2]?.toLowerCase();
const allowCreate = process.argv.includes("--create");

if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.error("[ERR] CDP_API_KEY_ID / CDP_API_KEY_SECRET missing from .env");
  process.exit(1);
}

const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID,
  apiKeySecret: process.env.CDP_API_KEY_SECRET,
});

/**
 * @param {{ userId?: string; authenticationMethods?: { type?: string; email?: string }[];
 *   evmAccounts?: string[]; evmSmartAccounts?: string[] }} user
 */
function summarize(user) {
  const emails = (user.authenticationMethods ?? [])
    .filter((m) => m.type === "email")
    .map((m) => m.email);
  return {
    userId: user.userId,
    emails,
    evmAccounts: user.evmAccounts ?? [],
    evmSmartAccounts: user.evmSmartAccounts ?? [],
  };
}

console.log("[CDP] Listing end users (validates Secret API key)...");
const page = await cdp.endUser.listEndUsers({ pageSize: 100 });
const users = page.endUsers ?? [];
console.log(`[CDP] OK — ${users.length} end user(s) in this project`);

if (!email) {
  for (const u of users) console.log(JSON.stringify(summarize(u), null, 2));
  process.exit(0);
}

const match = users.find((u) => summarize(u).emails.includes(email));
if (match) {
  console.log(`[CDP] FOUND ${email}:`);
  console.log(JSON.stringify(summarize(match), null, 2));
  process.exit(0);
}

console.log(`[CDP] ${email} not found among existing end users.`);
if (!allowCreate) {
  console.log("[CDP] Re-run with --create to pre-generate a wallet for this email.");
  process.exit(2);
}

console.log(`[CDP] Pre-generating end user for ${email}...`);
const created = await cdp.endUser.createEndUser({
  authenticationMethods: [{ type: "email", email }],
  evmAccount: { createSmartAccount: true },
});
console.log("[CDP] CREATED:");
console.log(JSON.stringify(summarize(created), null, 2));

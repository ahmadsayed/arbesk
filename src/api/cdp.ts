/**
 * CDP server-wallet service (P0).
 *
 * Shared CDP server-SDK access for email-login identity. The `@coinbase/cdp-sdk`
 * client is loaded lazily (heavy dependency — must not be imported statically)
 * and cached per env credential pair. End-user lookup/creation and
 * server-controlled EVM smart-account provisioning live here so email auth
 * (routes/email-auth.ts) and email→address resolution (routes/users.ts) share
 * one client and one scan.
 *
 * Keys live in CDP's Trusted Execution Environment; this module only issues
 * commands through the project API key (CDP_API_KEY_ID / CDP_API_KEY_SECRET).
 */
import type { CdpClient } from "@coinbase/cdp-sdk";

let _cdpClient: CdpClient | null = null;
let _cdpClientKey = "";

/**
 * Returns null when CDP_API_KEY_ID / CDP_API_KEY_SECRET are not configured
 * (feature unavailable, not an error).
 */
export async function getCdpClient(): Promise<CdpClient | null> {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) return null;
  const walletSecret = process.env.CDP_WALLET_SECRET || undefined;
  const key = `${apiKeyId}:${apiKeySecret}:${walletSecret ?? ""}`;
  if (!_cdpClient || _cdpClientKey !== key) {
    const { CdpClient } = await import("@coinbase/cdp-sdk");
    _cdpClient = new CdpClient({ apiKeyId, apiKeySecret, walletSecret });
    _cdpClientKey = key;
  }
  return _cdpClient;
}

export function _resetCdpClientForTesting(): void {
  _cdpClient = null;
  _cdpClientKey = "";
}

/** Minimal end-user view the auth/catalog code needs (decoupled from SDK types). */
export interface CdpEndUser {
  userId: string;
  authenticationMethods?: { type?: string; email?: string }[];
  evmSmartAccounts?: string[];
  evmSmartAccountObjects?: { address?: string }[];
}

/**
 * Page through listEndUsers and return the first user matching `matches`,
 * mapped to the minimal end-user view, or null.
 */
async function scanEndUsers(
  cdp: CdpClient,
  matches: (user: any) => boolean,
): Promise<CdpEndUser | null> {
  let pageToken: string | undefined = undefined;
  do {
    const page = await cdp.endUser.listEndUsers(
      pageToken ? { pageSize: 100, pageToken } : { pageSize: 100 },
    );
    for (const user of page.endUsers ?? []) {
      if (matches(user)) {
        return {
          userId: user.userId,
          authenticationMethods: (user.authenticationMethods ?? []) as {
            type?: string;
            email?: string;
          }[],
          evmSmartAccounts: user.evmSmartAccounts,
          evmSmartAccountObjects: user.evmSmartAccountObjects?.map((o) => ({
            address: o.address,
          })),
        };
      }
    }
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return null;
}

/**
 * Find an end user by exact email (trimmed/lowercased). Scans listEndUsers;
 * returns a minimal end-user view or null.
 */
export async function findEndUserByEmail(
  cdp: CdpClient,
  email: string,
): Promise<CdpEndUser | null> {
  const target = email.trim().toLowerCase();
  return scanEndUsers(cdp, (user) => {
    const methods = (user.authenticationMethods ?? []) as {
      type?: string;
      email?: string;
    }[];
    return methods.some(
      (m) =>
        m.type === "email" &&
        typeof m.email === "string" &&
        m.email.toLowerCase() === target,
    );
  });
}

/**
 * Find an end user by smart-account address (for browser-assisted sessions,
 * whose session carries the address but not the CDP user id).
 */
export async function findEndUserByAddress(
  cdp: CdpClient,
  address: string,
): Promise<CdpEndUser | null> {
  const target = address.toLowerCase();
  return scanEndUsers(cdp, (user) => {
    const addrs = [
      ...(user.evmSmartAccounts ?? []),
      ...(user.evmSmartAccountObjects ?? []).map((o: any) => o.address),
    ];
    return addrs.some((a) => a.toLowerCase() === target);
  });
}

/**
 * Resolve an end user by email, creating one server-side when absent.
 * The created end user starts with no accounts; ensureSmartAccount() adds one.
 */
export async function resolveOrCreateEndUser(
  cdp: CdpClient,
  email: string,
): Promise<{ user: CdpEndUser; isNew: boolean }> {
  const existing = await findEndUserByEmail(cdp, email);
  if (existing) return { user: existing, isNew: false };
  const normalized = email.trim().toLowerCase();
  const created = await cdp.endUser.createEndUser({
    authenticationMethods: [{ type: "email", email: normalized }],
  });
  const userId = (created as { userId?: string }).userId;
  if (!userId) throw new Error("CDP createEndUser returned no userId");
  return {
    user: {
      userId,
      authenticationMethods: [{ type: "email", email: normalized }],
      evmSmartAccounts: [],
      evmSmartAccountObjects: [],
    },
    isNew: true,
  };
}

/**
 * Ensure the end user has a smart account; use the existing one when present,
 * otherwise create a server-controlled EVM smart account. Returns the address.
 */
export async function ensureSmartAccount(
  cdp: CdpClient,
  user: CdpEndUser,
): Promise<string> {
  const address =
    user.evmSmartAccounts?.[0] ?? user.evmSmartAccountObjects?.[0]?.address;
  if (address) return address;
  const created = await cdp.endUser.addEndUserEvmSmartAccount({
    userId: user.userId,
    enableSpendPermissions: false,
  });
  const addr = created.evmSmartAccount.address;
  if (!addr) {
    throw new Error("CDP addEndUserEvmSmartAccount returned no address");
  }
  return addr;
}

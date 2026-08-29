/** Relay an on-chain write through the backend (no key, no browser). */
import { BACKEND_URL } from "./config.ts";
import { debug, trace } from "./debug.ts";
import type { Session } from "./session.ts";

export async function relay(
  session: Session,
  op: string,
  tokenId: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return trace("relay " + op + " token=" + tokenId, async () => {
    const res = await fetch(BACKEND_URL + "/api/v1/wallet/relay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Session " + session.token,
      },
      body: JSON.stringify({ op, tokenId, params }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg = (body.error as { message?: string })?.message || res.statusText;
      throw new Error(msg);
    }
    const receipt = (body.receipt ?? body) as Record<string, unknown>;
    if (receipt.transactionHash) debug("relay tx:", receipt.transactionHash);
    return receipt;
  });
}

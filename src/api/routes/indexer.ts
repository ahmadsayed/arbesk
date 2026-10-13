import { Hono } from "hono";
import type { Context } from "hono";
import { getIndexer } from "../token-indexer.ts";
import type { StorageAdapter } from "../storage/index.ts";
import { validateQuery } from "../validation.ts";
import { ownedQuerySchema, sharedQuerySchema } from "../schemas.ts";
import { sendError } from "../errors.ts";

function ts(): string {
  return new Date().toLocaleTimeString();
}

const DEFAULT_CATCHUP_WAIT_MS = 5000;

/** Max time a request waits on catch-up (env `INDEXER_CATCHUP_WAIT_MS`). */
function catchUpWaitMs(): number {
  const ms = Number(process.env.INDEXER_CATCHUP_WAIT_MS ?? DEFAULT_CATCHUP_WAIT_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_CATCHUP_WAIT_MS;
}

/**
 * Resolves the indexer for a chain and forces a catch-up before returning so
 * freshly minted tokens show up.
 * @remarks Catch-up is skipped if one ran recently (the 15s background poll
 *   covers the gap); `force=true` bypasses the throttle. The wait is capped:
 *   concurrent callers share one in-flight catch-up, which on a cold public
 *   chain can be a sweep of millions of blocks, so past the cap the request
 *   serves current state and the catch-up keeps running in the background.
 */
async function withFreshIndexer(
  chainId: number,
  force: boolean,
  storage: StorageAdapter,
): Promise<ReturnType<typeof getIndexer>> {
  const indexer = getIndexer(chainId, storage);
  const catchUpStart = Date.now();
  const msSinceCatchUp = Date.now() - indexer.lastCatchUpAt;
  if (force || msSinceCatchUp > 30000) {
    const waitMs = catchUpWaitMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capped = new Promise<"capped">((resolve) => {
      timer = setTimeout(() => resolve("capped"), waitMs);
    });
    let outcome: "done" | "capped" = "done";
    try {
      outcome = await Promise.race([
        indexer.catchUp().then(() => "done" as const),
        capped,
      ]);
    } catch (catchUpErr) {
      console.warn(
        `[${ts()}] [INDEXER-API] catchUp failed for chain`,
        chainId,
        String((catchUpErr as Error).message)
      );
    } finally {
      clearTimeout(timer);
    }
    console.log(
      `[${ts()}] [INDEXER-API] catchUp for chain ${chainId} ` +
        (outcome === "capped"
          ? `still running after ${waitMs}ms cap, serving current state`
          : `took ${Date.now() - catchUpStart}ms`) +
        `, lastScannedBlock=${indexer.lastScannedBlock}` +
        (force ? " (forced)" : "")
    );
  } else {
    console.log(
      `[${ts()}] [INDEXER-API] skipped catchUp for chain ${chainId} ` +
        `(${msSinceCatchUp}ms since last)`
    );
  }
  return indexer;
}

/**
 * Indexer API routes.
 *
 * GET /api/v1/indexer/owned?address=0x...&chainId=10143
 * Returns the token IDs owned by the given address on the given chain.
 *
 * GET /api/v1/indexer/shared?address=0x...&chainId=10143
 * Returns token IDs where the address is an editor but not the current owner.
 */
export default function indexerRoutes(storage: StorageAdapter) {
  const app = new Hono();

  const respond = async (
    c: Context,
    kind: "owned" | "shared",
    query: { address: string; chainId: number; force?: boolean },
  ) => {
    const { address, chainId, force = false } = query;

    try {
      const indexer = await withFreshIndexer(chainId, force, storage);
      return c.json({
        chainId,
        address: address.toLowerCase(),
        [kind]:
          kind === "owned"
            ? indexer.getOwnedTokens(address)
            : indexer.getSharedTokens(address),
        lastScannedBlock: indexer.lastScannedBlock,
      });
    } catch (err) {
      console.error(`[${ts()}] [INDEXER-API] failed to get ${kind} tokens:`, String((err as Error).message));
      return sendError(c, 500, "INDEXER_READ_FAILED", "failed to read indexer state");
    }
  };

  app.get("/owned", validateQuery(ownedQuerySchema), (c) =>
    respond(c, "owned", c.req.valid("query")),
  );
  app.get("/shared", validateQuery(sharedQuerySchema), (c) =>
    respond(c, "shared", c.req.valid("query")),
  );

  return app;
}

/**
 * `besk show` — open an asset in the Studio browser UI via its deep link.
 * Default form opens the asset in collection context
 * (/studio?asset=<tokenId>&assetId=<id>); a pinned version uses the standalone
 * manifest link (/studio?manifest=<cid>). The Studio resolves everything else
 * from the chain — this module only builds the URL and launches the browser.
 */
import { BACKEND_URL } from "./config.ts";
import { getVersionHistory } from "./catalog.ts";
import { openBrowser } from "./helpers.ts";

export interface ShowOptions {
  /** Collection token ID the asset lives in. */
  tokenId: string;
  assetID: string;
  /** Current (tip) manifest CID — the walk starts here for pinned versions. */
  cid: string;
  /** Pin a specific version (uses the manifest deep link). */
  version?: string;
  /** false → just build the URL, don't launch a browser (scripts, MCP, headless). */
  open?: boolean;
}

export async function showAsset(
  opts: ShowOptions,
): Promise<{ url: string; cid: string; opened: boolean }> {
  let url: string;
  let cid = opts.cid;
  if (opts.version !== undefined) {
    const chain = await getVersionHistory(opts.cid);
    const target = chain.find((e) => String(e.version) === String(opts.version));
    if (!target) throw new Error("Version " + opts.version + " not found");
    cid = target.cid;
    url = BACKEND_URL + "/studio?manifest=" + cid;
  } else {
    const params = new URLSearchParams({
      asset: String(opts.tokenId),
      assetId: opts.assetID,
    });
    url = BACKEND_URL + "/studio?" + params.toString();
  }
  const opened = opts.open !== false;
  if (opened) openBrowser(url);
  return { url, cid, opened };
}

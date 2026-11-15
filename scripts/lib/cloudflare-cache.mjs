// @ts-nocheck — TODO: type properly (implicit any in helpers); scripts/ pattern
// Cloudflare cache helpers for scripts/deploy-k3s.mjs.
//
// promptscad.com serves its static files (/js/app.js, /css/styles.css, …) at
// unversioned URLs and Cloudflare keeps each for 4 hours. Without a purge, the
// site answers with the previous build — or new CSS next to old JS — long
// after the rollout finished.

const API = "https://api.cloudflare.com/client/v4";

/** `KEY=value` from .env text; surrounding quotes stripped. */
function readDotenvValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, "m"));
  return match ? match[1].replace(/^["']|["']$/g, "") : "";
}

/**
 * Finds the purge credentials: the environment first, then the .env text.
 * @param {Record<string, string | undefined>} env
 * @param {string} [dotenvText] contents of the root .env
 * @returns {{ token: string, zoneId: string } | null} null unless both are set
 */
export function readCloudflareCredentials(env, dotenvText = "") {
  const read = (key) => env[key] || readDotenvValue(dotenvText, key);
  const token = read("CLOUDFLARE_API_TOKEN");
  const zoneId = read("CLOUDFLARE_ZONE_ID");
  return token && zoneId ? { token, zoneId } : null;
}

/**
 * Drops everything Cloudflare has cached for the zone.
 * @param {{ token: string, zoneId: string }} credentials
 * @param {typeof fetch} [fetchImpl]
 * @throws when Cloudflare refuses; the message carries its errors, never the token
 */
export async function purgeCloudflareCache({ token, zoneId }, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/zones/${zoneId}/purge_cache`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ purge_everything: true }),
  });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.success === true) return;
  const reasons = (body?.errors ?? []).map((e) => e.message).filter(Boolean).join("; ");
  throw new Error(`Cloudflare purge failed: HTTP ${res.status}${reasons ? ` — ${reasons}` : ""}`);
}

/** Status and body of a GET, for comparing two copies of a file. */
async function fetchCopy(url, fetchImpl) {
  const res = await fetchImpl(url, { redirect: "follow" });
  return { ok: res.ok, bytes: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Which files the edge still serves from a previous build.
 * @remarks Compares what visitors get (`path`) with a copy fetched under a
 *   query string unique to this deploy, which the edge cannot have cached.
 * @param {string} origin e.g. `https://promptscad.com`
 * @param {string[]} paths
 * @param {string} tag this deploy's image tag
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string[]>} the stale paths; empty when the edge is fresh
 */
export async function staleAssets(origin, paths, tag, fetchImpl = fetch) {
  const stale = [];
  for (const path of paths) {
    const edge = await fetchCopy(`${origin}${path}`, fetchImpl);
    const fresh = await fetchCopy(`${origin}${path}?deploy=${tag}`, fetchImpl);
    if (!edge.ok || !fresh.ok || !edge.bytes.equals(fresh.bytes)) stale.push(path);
  }
  return stale;
}

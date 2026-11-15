/**
 * Cloudflare cache helpers used by scripts/deploy-k3s.mjs: reading the purge
 * credentials, purging the zone, and telling whether the edge still serves
 * the previous build. Network is a fake `fetch`; nothing leaves the machine.
 */

import { expect, test } from "bun:test";
import {
  purgeCloudflareCache,
  readCloudflareCredentials,
  staleAssets,
} from "../scripts/lib/cloudflare-cache.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("credentials come from the environment", () => {
  expect(
    readCloudflareCredentials({ CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ZONE_ID: "zone" })
  ).toEqual({ token: "tok", zoneId: "zone" });
});

test("credentials fall back to the .env text, quotes stripped", () => {
  const dotenv = `PINATA_JWT=abc\nCLOUDFLARE_API_TOKEN="tok-file"\n# comment\nCLOUDFLARE_ZONE_ID='zone-file'\n`;
  expect(readCloudflareCredentials({}, dotenv)).toEqual({ token: "tok-file", zoneId: "zone-file" });
});

test("the environment wins over the .env text", () => {
  const dotenv = "CLOUDFLARE_API_TOKEN=tok-file\nCLOUDFLARE_ZONE_ID=zone-file\n";
  expect(readCloudflareCredentials({ CLOUDFLARE_API_TOKEN: "tok-env" }, dotenv)).toEqual({
    token: "tok-env",
    zoneId: "zone-file",
  });
});

test("no credentials unless both the token and the zone are set", () => {
  expect(readCloudflareCredentials({ CLOUDFLARE_API_TOKEN: "tok" })).toBeNull();
  expect(readCloudflareCredentials({}, "CLOUDFLARE_ZONE_ID=zone\n")).toBeNull();
  expect(readCloudflareCredentials({ CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ZONE_ID: "zone" })).toBeNull();
});

test("purge asks Cloudflare to drop everything cached for the zone", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return json(200, { success: true, errors: [] });
  };
  await purgeCloudflareCache({ token: "tok", zoneId: "zone123" }, fakeFetch);
  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone123/purge_cache");
  expect(calls[0].init.method).toBe("POST");
  expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(calls[0].init.body)).toEqual({ purge_everything: true });
});

test("purge fails with Cloudflare's own message and never echoes the token", async () => {
  const fakeFetch = async () =>
    json(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  const attempt = purgeCloudflareCache({ token: "secret-token", zoneId: "zone" }, fakeFetch);
  await expect(attempt).rejects.toThrow(/HTTP 403.*Authentication error/);
  await attempt.catch((err) => expect(err.message).not.toContain("secret-token"));
});

test("purge fails when Cloudflare answers 200 but reports no success", async () => {
  const fakeFetch = async () => json(200, { success: false, errors: [{ message: "zone not found" }] });
  await expect(
    purgeCloudflareCache({ token: "tok", zoneId: "zone" }, fakeFetch)
  ).rejects.toThrow(/zone not found/);
});

test("purge fails readably when the answer is not JSON", async () => {
  const fakeFetch = async () => new Response("<html>bad gateway</html>", { status: 502 });
  await expect(
    purgeCloudflareCache({ token: "tok", zoneId: "zone" }, fakeFetch)
  ).rejects.toThrow(/HTTP 502/);
});

test("staleAssets names the files whose edge copy differs from this build", async () => {
  const served = {
    "https://site.test/js/app.js": "old bundle",
    "https://site.test/js/app.js?deploy=11151333": "new bundle",
    "https://site.test/css/styles.css": "new css",
    "https://site.test/css/styles.css?deploy=11151333": "new css",
  };
  const fakeFetch = async (url) => new Response(served[url], { status: 200 });
  expect(
    await staleAssets("https://site.test", ["/js/app.js", "/css/styles.css"], "11151333", fakeFetch)
  ).toEqual(["/js/app.js"]);
});

test("staleAssets counts a file the edge cannot serve as stale", async () => {
  const fakeFetch = async (url) =>
    url.includes("?deploy=") ? new Response("new", { status: 200 }) : new Response("nope", { status: 404 });
  expect(await staleAssets("https://site.test", ["/js/app.js"], "1", fakeFetch)).toEqual(["/js/app.js"]);
});

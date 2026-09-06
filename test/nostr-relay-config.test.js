/**
 * Config guard for GitHub issue #28: the local Nostr relay is exposed
 * directly (no trusted reverse proxy), so it must not derive client IPs
 * from a client-controlled header. If a proxy is ever introduced, revisit
 * that assertion deliberately instead of discovering the spoofing hole in
 * production.
 *
 * Loopback note: the relay port was originally pinned to 127.0.0.1, but
 * commit f886214 ("feat(live): client-reachable Nostr relay") intentionally
 * publishes it on all interfaces so browser clients can reach it through
 * the app's hostname (see `frontend/src/js/services/nostr-config.ts`).
 * The port mapping must stay parameterized on NOSTR_HOST_PORT so a
 * deployment can re-bind it to loopback without editing the compose file.
 */

import fs from "node:fs";

const relayToml = fs.readFileSync("docker/nostr-relay.toml", "utf8");
const composeYaml = fs.readFileSync("docker-compose.yml", "utf8");

/** TOML lines with comments stripped — only active directives remain. */
function activeLines(src) {
  return src
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

describe("nostr relay config (issue #28)", () => {
  it("does not trust a client-controlled remote IP header", () => {
    const directive = activeLines(relayToml).find((line) =>
      /^remote_ip_header\s*=/.test(line),
    );
    expect(directive).toBeUndefined();
  });

  it("publishes the relay port via NOSTR_HOST_PORT (re-bindable to loopback)", () => {
    const nostrPort = composeYaml
      .split("\n")
      .find((line) => /:7777"/.test(line));
    expect(nostrPort).toBeDefined();
    expect(nostrPort).toContain("${NOSTR_HOST_PORT:-7777}");
  });
});

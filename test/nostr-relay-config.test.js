/**
 * Config guard for GitHub issue #28: the local Nostr relay is exposed
 * directly (no trusted reverse proxy), so it must not derive client IPs
 * from a client-controlled header, and its host port must stay
 * loopback-bound. If a proxy is ever introduced, revisit both assertions
 * deliberately instead of discovering the spoofing hole in production.
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

  it("publishes the relay port on loopback only", () => {
    const nostrPort = composeYaml
      .split("\n")
      .find((line) => /"\d+\.\d+\.\d+\.\d+:.*:7777"/.test(line) || /":7777"/.test(line));
    expect(nostrPort).toBeDefined();
    expect(nostrPort).toContain("127.0.0.1:");
  });
});

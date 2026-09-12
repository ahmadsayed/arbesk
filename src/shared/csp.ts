/**
 * The Content-Security-Policy directive map, shared by the Express and Hono
 * servers.
 *
 * @remarks This is configuration, not framework code, and it was copied
 *   verbatim into src/hono/secure-headers.ts when the Hono middleware was
 *   ported. Two copies of a SECURITY POLICY is the worst kind of duplication:
 *   adding an origin to one leaves the other stack still refusing it, and the
 *   failure surfaces as a blocked request in a browser console rather than as
 *   anything a test would catch. The migration is exactly the window in which
 *   that happens, so there is now one copy and both stacks read it.
 *
 *   Delivered via HTTP header because <meta> does not support the
 *   "Report-Only" suffix. Monitor violations in the browser console before
 *   promoting to enforcing mode.
 */

/** Directive name to its source list, in helmet's camelCase form. */
export type CspDirectives = Record<string, string[]>;

/**
 * Builds the CSP directive map, including the deployment-specific extensions.
 *
 * @remarks Reads PINATA_GATEWAY and PUBLIC_ORIGIN, so it must be called after
 *   the environment is loaded — the same constraint the inline version had.
 * @returns The directive map, ready for helmet or for header serialization.
 */
export function buildCspDirectives(): CspDirectives {
  const pinataGateway = process.env.PINATA_GATEWAY;
  const publicOrigin = process.env.PUBLIC_ORIGIN; // e.g. https://promptscad.com
  const connectSrc = [
    "'self'",
    "http://127.0.0.1:5001",
    "http://127.0.0.1:8545",
    "http://127.0.0.1:9090",
    "ws://localhost:9090",
    "wss://localhost:9090",
    "https://*.llamarpc.com",
    "https://*.publicnode.com",
    "https://esm.sh",
    // CDP / Base Sepolia
    "https://api.cdp.coinbase.com",
    "https://*.cdp.coinbase.com",
    "https://sepolia.base.org",
  ];
  const imgSrc = ["'self'", "blob:", "data:", "http://127.0.0.1:8080"];
  if (pinataGateway) {
    connectSrc.push(`https://${pinataGateway}`);
    imgSrc.push(`https://${pinataGateway}`);
  }
  if (publicOrigin) {
    // Same-origin API plus the ingress-proxied Nostr relay (wss://<host>/nostr).
    connectSrc.push(publicOrigin, publicOrigin.replace(/^http/, "ws"));
  }
  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-eval'",
      "'unsafe-inline'",
      "https://cdn.babylonjs.com",
      "https://cdn.jsdelivr.net",
      "https://esm.sh",
    ],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc,
    imgSrc,
    fontSrc: ["'self'"],
    mediaSrc: ["'self'"],
    workerSrc: ["'self'", "blob:"],
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    // upgrade-insecure-requests stays off: browsers ignore it in Report-Only
    // mode and warn on every page load.
  };
}

/** camelCase directive name to its dashed header form (defaultSrc -> default-src). */
function dashify(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase());
}

/**
 * Serializes the CSP directives into a header value.
 *
 * @remarks Only the Hono path needs this: helmet serializes the directive map
 *   itself. Byte-for-byte this matches what helmet emits, which is pinned by
 *   test/api/hono-secure-headers.test.js.
 * @returns The header value in helmet's `name value;name value` form.
 */
export function buildCspHeaderValue(): string {
  return Object.entries(buildCspDirectives())
    .map(([name, values]) => `${dashify(name)} ${values.join(" ")}`)
    .join(";");
}

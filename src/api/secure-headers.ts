/**
 * Security headers: hono/secure-headers configured to match the previous
 * helmet setup — report-only CSP, COOP `same-origin-allow-popups`, no
 * X-Frame-Options (frameguard off), no COEP, and helmet's other defaults
 * (nosniff, HSTS, no-referrer, CORP same-origin, ...).
 *
 * @remarks The CSP is delivered via HTTP header because <meta> does not
 *   support the "Report-Only" suffix. Monitor violations in the browser
 *   console before promoting to enforcing mode.
 */

import { secureHeaders as honoSecureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono";

/** Directive name to its source list, in camelCase form. */
export type CspDirectives = Record<string, string[]>;

/**
 * Builds the CSP directive map, including the deployment-specific extensions.
 *
 * @remarks Reads PINATA_GATEWAY and PUBLIC_ORIGIN, so it must be called after
 *   the environment is loaded — the same constraint the inline version had.
 * @returns The directive map, in hono/secure-headers' camelCase form.
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
    // The two directives helmet used to add by default; kept so the policy
    // did not change when helmet was replaced.
    frameAncestors: ["'self'"],
    scriptSrcAttr: ["'none'"],
    // upgrade-insecure-requests stays off: browsers ignore it in Report-Only
    // mode and warn on every page load.
  };
}

/**
 * Middleware setting the security headers on every response.
 */
export function secureHeaders(): MiddlewareHandler {
  return honoSecureHeaders({
    contentSecurityPolicyReportOnly: buildCspDirectives(),
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: "same-origin-allow-popups",
    // Allow the DeepSeek Harness side-viewer to embed the Studio in an iframe
    // on a different origin (localhost:3080). Local dev only — restore this if
    // you disable the side-viewer or harden a public deployment.
    xFrameOptions: false,
    // helmet's value; hono's default max-age is 180 days.
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
  });
}

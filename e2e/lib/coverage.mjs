// @ts-check
import path from "node:path";

/**
 * Whether E2E coverage collection is enabled for this process.
 */
export const E2E_COVERAGE = process.env.E2E_COVERAGE === "1";

/**
 * Map a script URL served by the backend to the corresponding source file on
 * disk. `/js/*` maps to `frontend/src/js/*`; `/constants/*` maps to the root
 * `constants/*` folder. Returns `null` for URLs that should not be tracked
 * (CDNs, vendors, non-script assets, etc.).
 *
 * @param {string} entryUrl
 * @param {string} [root]
 * @returns {string | null}
 */
export function sourcePathFromUrl(entryUrl, root = process.cwd()) {
  let urlPath;
  try {
    urlPath = new URL(entryUrl).pathname;
  } catch {
    return null;
  }

  if (urlPath.startsWith("/js/vendor/")) return null;
  if (urlPath.startsWith("/js/")) {
    return path.resolve(root, "frontend", "src", urlPath.slice(1));
  }
  if (urlPath.startsWith("/constants/")) {
    return path.resolve(root, urlPath.slice(1));
  }
  return null;
}

/**
 * Keep only local application scripts that are part of the coverage surface.
 *
 * @param {Array<{ url: string }>} entries
 * @param {string} baseUrl
 * @returns {Array<{ url: string }>}
 */
export function filterLocalScriptEntries(entries, baseUrl) {
  let baseOrigin;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    if (!entry.url) return false;
    try {
      const u = new URL(entry.url);
      return (
        u.origin === baseOrigin &&
        (u.pathname.startsWith("/js/") ||
          u.pathname.startsWith("/constants/")) &&
        !u.pathname.startsWith("/js/vendor/")
      );
    } catch {
      return false;
    }
  });
}

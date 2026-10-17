/**
 * Landing "Made in Arbesk" section: real published assets from the curated
 * GET /api/v1/featured list, each card opening the asset read-only in Studio.
 * @remarks The section ships `hidden` and is revealed only once at least one
 *   card renders, so an empty list or a failed request leaves no trace.
 *   Names are user-chosen — they are set as text, never as HTML.
 */
import { addressToBase58 } from "../utils/base58.ts";

interface FeaturedAsset {
  tokenId: string;
  assetId: string;
  name: string;
  creator: string;
  thumbnailUrl: string | null;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<any> }>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Same read-only Studio URL the Library uses for someone else's asset. */
function studioUrl(profileId: string, asset: FeaturedAsset): string {
  const params = new URLSearchParams({ asset: asset.tokenId, assetId: asset.assetId });
  return `/studio/${profileId}?${params}`;
}

function buildCard(asset: FeaturedAsset): HTMLLIElement | null {
  let profileId: string;
  try {
    profileId = addressToBase58(asset.creator);
  } catch {
    return null;
  }
  const link = el("a", "landing-featured-card");
  link.href = studioUrl(profileId, asset);

  const thumb = el("span", "landing-featured-thumb");
  if (asset.thumbnailUrl) {
    const img = document.createElement("img");
    img.src = asset.thumbnailUrl;
    img.alt = "";
    img.setAttribute("loading", "lazy");
    img.width = 512;
    img.height = 288;
    thumb.appendChild(img);
  }
  link.append(
    thumb,
    el("span", "landing-featured-name", asset.name),
    el("span", "landing-featured-creator tabular", `by ${profileId.slice(0, 6)}…`),
  );

  const item = document.createElement("li");
  item.appendChild(link);
  return item;
}

async function fetchFeatured(fetchImpl: FetchLike): Promise<FeaturedAsset[]> {
  try {
    const res = await fetchImpl("/api/v1/featured");
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.assets) ? body.assets : [];
  } catch {
    return [];
  }
}

export async function initFeatured(
  section: HTMLElement,
  fetchImpl: FetchLike = (url) => fetch(url),
): Promise<void> {
  const grid = section.querySelector(".landing-featured-grid");
  if (!grid) return;
  const cards = (await fetchFeatured(fetchImpl))
    .map(buildCard)
    .filter((card): card is HTMLLIElement => card !== null);
  grid.replaceChildren(...cards);
  section.hidden = cards.length === 0;
}

// @test-env dom
/**
 * Landing "Made in Arbesk" section (frontend/src/js/landing/featured.ts):
 * renders /api/v1/featured as cards linking to read-only Studio, stays hidden
 * when there is nothing to show, and never injects user-chosen names as HTML.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { initFeatured } from "../../frontend/src/js/landing/featured.ts";

const CREATOR = "0xccc626354a2ea985d4abdc1173597a46afc63595";
const CREATOR_BASE58 = "3rTyYaQADATmQkvr5vkTteihpSHz";

const CAVE = {
  chainId: 84532,
  tokenId: "3686",
  assetId: "asset_cave",
  name: "cave",
  creator: CREATOR,
  thumbnailUrl: "https://gw.example/ipfs/thumbCave",
};

function respond(body, ok = true) {
  return async () => ({ ok, json: async () => body });
}

let section;
beforeEach(() => {
  document.body.innerHTML = `
    <section id="featured" hidden>
      <ul class="landing-featured-grid"></ul>
    </section>`;
  section = document.getElementById("featured");
});

const cards = () => [...section.querySelectorAll(".landing-featured-card")];

describe("initFeatured", () => {
  test("renders one linked card per asset and shows the section", async () => {
    await initFeatured(section, respond({ assets: [CAVE, { ...CAVE, name: "table", thumbnailUrl: null }] }));
    expect(section.hidden).toBe(false);
    expect(cards()).toHaveLength(2);

    const [cave, table] = cards();
    expect(cave.getAttribute("href")).toBe(
      `/studio/${CREATOR_BASE58}?asset=3686&assetId=asset_cave`,
    );
    expect(cave.querySelector("img").getAttribute("src")).toBe(CAVE.thumbnailUrl);
    expect(cave.querySelector("img").getAttribute("loading")).toBe("lazy");
    expect(cave.textContent).toContain("cave");
    expect(cave.querySelector(".landing-featured-creator").textContent).toContain(
      CREATOR_BASE58.slice(0, 6),
    );
    // No thumbnail: a placeholder instead of a broken image.
    expect(table.querySelector("img")).toBeNull();
    expect(table.querySelector(".landing-featured-thumb")).not.toBeNull();
  });

  test("asset names are text, never markup", async () => {
    await initFeatured(section, respond({ assets: [{ ...CAVE, name: '<img src=x onerror="alert(1)">' }] }));
    const card = cards()[0];
    expect(card.querySelectorAll("img")).toHaveLength(1); // only the thumbnail
    expect(card.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  test("stays hidden when the list is empty", async () => {
    await initFeatured(section, respond({ assets: [] }));
    expect(section.hidden).toBe(true);
    expect(cards()).toHaveLength(0);
  });

  test("stays hidden when the request fails", async () => {
    await initFeatured(section, async () => {
      throw new Error("offline");
    });
    expect(section.hidden).toBe(true);
    await initFeatured(section, respond({}, false));
    expect(section.hidden).toBe(true);
  });

  test("skips entries whose creator isn't a valid address", async () => {
    await initFeatured(section, respond({ assets: [{ ...CAVE, creator: "nope" }, CAVE] }));
    expect(cards()).toHaveLength(1);
  });
});

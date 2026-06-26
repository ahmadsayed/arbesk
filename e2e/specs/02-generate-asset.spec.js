import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  assertGenerationManifest,
} from "../helpers/manifest.mjs";
import { connectStudio, generate } from "../helpers/flows.mjs";

const PROMPT = "cowboy";

test.describe("asset generation", () => {
  test("generates a mock asset and produces a valid manifest", async ({
    page,
  }) => {
    await connectStudio(page);

    const cid = await generate(page, PROMPT);

    const manifest = await fetchManifest(cid);
    assertGenerationManifest(manifest, { prompt: PROMPT, provider: "mock" });
  });
});

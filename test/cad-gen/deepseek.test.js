import {
  createDeepSeekClient, ProviderError,
} from "@arbesk/cad-gen/backend/deepseek.js";

const completion = (content) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
});
const reply = (body, status = 200) =>
  async () => new Response(JSON.stringify(body), { status });

const client = (fetchImpl) => createDeepSeekClient({
  apiKey: "k", baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash", fetchImpl,
});

describe("createDeepSeekClient", () => {
  it("returns text and token usage", async () => {
    const c = client(reply(completion('{"code":"return 1;"}')));
    const r = await c.complete([{ role: "user", content: "hi" }]);
    expect(JSON.parse(r.text).code).toBe("return 1;");
    expect(r.usage).toEqual({ prompt: 100, completion: 20 });
  });

  it("sends the model and JSON response format", async () => {
    let seen;
    const c = client(async (_url, init) => {
      seen = JSON.parse(init.body);
      return new Response(JSON.stringify(completion("{}")), { status: 200 });
    });
    await c.complete([{ role: "user", content: "hi" }]);
    expect(seen.model).toBe("deepseek-flash");
    expect(seen.response_format).toEqual({ type: "json_object" });
    expect(seen.messages[0].content).toBe("hi");
  });

  // Thinking mode is on by default at the provider, at effort "high". Measured
  // on one prompt: default thinking never returned inside 240s, effort "low"
  // took 111s, and disabled answered in 2.0s for 479 tokens and was the only
  // setting that produced the requested fillet. Off is the default here.
  const payload = async (config) => {
    let seen;
    const c = createDeepSeekClient({
      apiKey: "k", baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash", ...config,
      fetchImpl: async (_u, init) => {
        seen = JSON.parse(init.body);
        return new Response(JSON.stringify(completion("{}")), { status: 200 });
      },
    });
    await c.complete([{ role: "user", content: "hi" }]);
    return seen;
  };

  it("disables thinking by default", async () => {
    expect((await payload({})).thinking).toEqual({ type: "disabled" });
  });

  it("enables thinking only when asked", async () => {
    expect((await payload({ thinking: true })).thinking).toEqual({ type: "enabled" });
  });

  it("maps 401 to PROVIDER_AUTH_FAILED", async () => {
    const c = client(reply({ error: "nope" }, 401));
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_AUTH_FAILED", status: 401,
    });
  });

  it("maps 500 to PROVIDER_ERROR", async () => {
    const c = client(reply({ error: "boom" }, 500));
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_ERROR", status: 500,
    });
  });

  it("rejects an empty completion", async () => {
    const c = client(reply({ choices: [{ message: { content: "" } }] }));
    await expect(c.complete([])).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("passes image blocks through as data URLs", async () => {
    let seen;
    const c = client(async (_u, init) => {
      seen = JSON.parse(init.body);
      return new Response(JSON.stringify(completion("{}")), { status: 200 });
    });
    await c.complete([{
      role: "user",
      content: [
        { type: "text", text: "describe this" },
        { type: "image", data: "AAAA", mime: "image/png" },
      ],
    }]);
    const blocks = seen.messages[0].content;
    expect(blocks[1].type).toBe("image_url");
    expect(blocks[1].image_url.url).toBe("data:image/png;base64,AAAA");
  });

  it("maps a transport failure to PROVIDER_ERROR", async () => {
    const c = client(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(c.complete([])).rejects.toBeInstanceOf(ProviderError);
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    await expect(c.complete([])).rejects.toThrow(/fetch failed/);
  });

  it("maps a non-JSON 200 body to PROVIDER_ERROR", async () => {
    const c = client(async () => new Response("<html>bad gateway</html>", { status: 200 }));
    await expect(c.complete([])).rejects.toBeInstanceOf(ProviderError);
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    await expect(c.complete([])).rejects.toThrow(/not valid JSON/);
  });

  it("keeps the timeout armed while the response body is read", async () => {
    // Headers arrive immediately; the body settles only when the client aborts,
    // which is what a real fetch does when its signal fires mid-body. A client
    // that disarms its timeout at the headers never aborts, so this test hangs
    // until the jest timeout instead of failing an assertion.
    const c = createDeepSeekClient({
      apiKey: "k", baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash", timeoutMs: 25,
      fetchImpl: async (_url, init) => new Response(new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () =>
            controller.error(new DOMException("The operation was aborted.", "AbortError")));
        },
      }), { status: 200 }),
    });
    await expect(c.complete([])).rejects.toBeInstanceOf(ProviderError);
    await expect(c.complete([])).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    await expect(c.complete([])).rejects.toThrow(/timed out after 25ms/);
  }, 3000);
});


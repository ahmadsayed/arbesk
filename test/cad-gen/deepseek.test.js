import { createDeepSeekClient } from "@arbesk/cad-gen/backend/deepseek.js";

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
});

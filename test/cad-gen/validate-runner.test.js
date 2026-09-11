import { runValidation } from "@arbesk/cad-gen/backend/validate-runner.js";

const design = (code) => ({
  code,
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "",
});

const OPTS = { timeoutMs: 20000, maxTriangles: 200000 };

describe("runValidation", () => {
  it("kills a runaway script on the timeout", async () => {
    const r = await runValidation(design("while(true){}\nreturn 1;"), {
      ...OPTS, timeoutMs: 3000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  }, 20000);
});

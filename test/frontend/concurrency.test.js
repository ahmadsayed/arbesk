/** @jest-environment jsdom */
import { createConcurrencyLimiter } from "../../frontend/src/js/utils/concurrency.js";

describe("createConcurrencyLimiter", () => {
  it("runs tasks sequentially when limit is 1", async () => {
    const limiter = createConcurrencyLimiter(1);
    const order = [];

    const p1 = limiter.run(async () => {
      order.push("start-1");
      await new Promise((r) => setTimeout(r, 20));
      order.push("end-1");
      return 1;
    });
    const p2 = limiter.run(async () => {
      order.push("start-2");
      await new Promise((r) => setTimeout(r, 10));
      order.push("end-2");
      return 2;
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual(["start-1", "end-1", "start-2", "end-2"]);
  });

  it("allows up to the configured limit in parallel", async () => {
    const limiter = createConcurrencyLimiter(2);
    let active = 0;
    let maxActive = 0;

    async function task() {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return "ok";
    }

    await Promise.all([
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ]);

    expect(maxActive).toBe(2);
    expect(active).toBe(0);
  });

  it("propagates errors without stalling the queue", async () => {
    const limiter = createConcurrencyLimiter(1);

    const p1 = limiter.run(async () => {
      throw new Error("boom");
    });
    const p2 = limiter.run(async () => "ok");

    await expect(p1).rejects.toThrow("boom");
    expect(await p2).toBe("ok");
  });

  it("reports pending and active counts", () => {
    const limiter = createConcurrencyLimiter(1);
    expect(limiter.pending()).toBe(0);
    expect(limiter.active()).toBe(0);

    limiter.run(() => new Promise(() => {}));
    limiter.run(() => new Promise(() => {}));

    expect(limiter.active()).toBe(1);
    expect(limiter.pending()).toBe(1);
  });

  it("treats a limit less than 1 as 1", async () => {
    const limiter = createConcurrencyLimiter(0);
    let active = 0;
    let maxActive = 0;

    async function task() {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    }

    await Promise.all([limiter.run(task), limiter.run(task)]);
    expect(maxActive).toBe(1);
  });
});

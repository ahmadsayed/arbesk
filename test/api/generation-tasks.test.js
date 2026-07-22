import { jest } from "@jest/globals";
import {
  registerTask,
  getTask,
  getCompletedTask,
  markTaskComplete,
  evictTask,
  _resetRegistry,
} from "../../src/api/generation-tasks.js";

jest.useFakeTimers();

describe("generation-tasks registry", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  test("register returns a UUID and stores the entry", () => {
    const id = registerTask({
      tripoTaskId: "tripo_1",
      providerKey: "key_123",
      userAddress: "0xabc",
    });
    expect(typeof id).toBe("string");
    expect(getTask(id, "0xabc")).toMatchObject({
      tripoTaskId: "tripo_1",
      providerKey: "key_123",
      userAddress: "0xabc",
    });
  });

  test("getTask returns undefined for unknown id", () => {
    expect(getTask("nope", "0xabc")).toBeUndefined();
  });

  test("getTask returns undefined for a different wallet", () => {
    const id = registerTask({
      tripoTaskId: "tripo_1",
      providerKey: "k",
      userAddress: "0xabc",
    });
    expect(getTask(id, "0xother")).toBeUndefined();
    expect(getTask(id, "0xabc")).toBeDefined();
  });

  test("entries expire after TTL", () => {
    const id = registerTask({
      tripoTaskId: "tripo_1",
      providerKey: "k",
      userAddress: "0xabc",
    });
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(getTask(id, "0xabc")).toBeUndefined();
  });

  test("evict removes an entry", () => {
    const id = registerTask({ tripoTaskId: "t", providerKey: "k", userAddress: "0xabc" });
    evictTask(id);
    expect(getTask(id, "0xabc")).toBeUndefined();
  });

  test("registry has no persistence imports", async () => {
    const mod = await import("../../src/api/generation-tasks.js");
    // Indirect check: the module should not expose a save/load function.
    expect(mod.save).toBeUndefined();
    expect(mod.load).toBeUndefined();
  });

  test("new tasks are running; completed tasks are hidden from getTask", () => {
    const id = registerTask({
      tripoTaskId: "t",
      providerKey: "k",
      userAddress: "0xabc",
    });
    expect(getTask(id, "0xabc")).toBeDefined();
    markTaskComplete(id, "0xabc");
    expect(getTask(id, "0xabc")).toBeUndefined();
    expect(getCompletedTask(id, "0xabc")).toMatchObject({
      tripoTaskId: "t",
      status: "complete",
    });
  });

  test("getCompletedTask enforces wallet ownership", () => {
    const id = registerTask({
      tripoTaskId: "t",
      providerKey: "k",
      userAddress: "0xabc",
    });
    markTaskComplete(id, "0xabc");
    expect(getCompletedTask(id, "0xother")).toBeUndefined();
  });

  test("markTaskComplete refreshes the TTL window", () => {
    const id = registerTask({
      tripoTaskId: "t",
      providerKey: "k",
      userAddress: "0xabc",
    });
    jest.advanceTimersByTime(50 * 60 * 1000); // 50 min old
    markTaskComplete(id, "0xabc");
    jest.advanceTimersByTime(59 * 60 * 1000); // 109 min since create, 59 since complete
    expect(getCompletedTask(id, "0xabc")).toBeDefined();
    jest.advanceTimersByTime(2 * 60 * 1000); // 61 min since complete
    expect(getCompletedTask(id, "0xabc")).toBeUndefined();
  });
});

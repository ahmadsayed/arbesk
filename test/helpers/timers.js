import { jest } from "bun:test";

/**
 * Async fake-timer advance (Bun's jest object has no advanceTimersByTimeAsync).
 * @remarks Advances the fake clock, then yields so promise callbacks queued by
 *   the timers that fired can run before the caller's next line.
 * @param {number} ms Milliseconds to advance.
 */
export async function advanceTimersByTimeAsync(ms) {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

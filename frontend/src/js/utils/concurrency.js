// @ts-nocheck
/**
 * Tiny promise-based concurrency limiter.
 *
 * Limits the number of concurrently executing async tasks. Additional tasks
 * are queued and started as soon as a slot frees up. This avoids head-of-line
 * blocking and connection-pool exhaustion when the browser fires many
 * concurrent upload/download requests.
 */

/**
 * @typedef {object} Limiter
 * @property {<T>(fn: () => Promise<T>) => Promise<T>} run
 * @property {() => number} pending
 * @property {() => number} active
 */

/**
 * Create a concurrency limiter.
 *
 * @param {number} limit - Maximum number of concurrently executing tasks.
 * @returns {Limiter}
 */
export function createConcurrencyLimiter(limit) {
  const max = Math.max(1, Math.floor(limit));
  /** @type {Array<{fn: () => Promise<any>, resolve: (value: any) => void, reject: (reason?: any) => void}>} */
  const queue = [];
  let running = 0;

  function next() {
    if (running >= max || queue.length === 0) {
      return;
    }
    running++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          running--;
          resolve(value);
          next();
        },
        (reason) => {
          running--;
          reject(reason);
          next();
        }
      );
  }

  return {
    /**
     * Queue a task and return a promise that resolves with its result.
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    },
    pending() {
      return queue.length;
    },
    active() {
      return running;
    },
  };
}

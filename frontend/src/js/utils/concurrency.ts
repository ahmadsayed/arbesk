/**
 * Tiny promise-based concurrency limiter.
 *
 * Limits the number of concurrently executing async tasks. Additional tasks
 * are queued and started as soon as a slot frees up. This avoids head-of-line
 * blocking and connection-pool exhaustion when the browser fires many
 * concurrent upload/download requests.
 */

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  pending(): number;
  active(): number;
}

interface QueuedTask {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

/**
 * Create a concurrency limiter.
 *
 * @param limit - Maximum number of concurrently executing tasks.
 */
export function createConcurrencyLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.floor(limit));
  const queue: QueuedTask[] = [];
  let running = 0;

  function next() {
    if (running >= max || queue.length === 0) {
      return;
    }
    running++;
    const task = queue.shift();
    if (!task) return;
    const { fn, resolve, reject } = task;
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
     */
    run<T>(fn: () => Promise<T>): Promise<T> {
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

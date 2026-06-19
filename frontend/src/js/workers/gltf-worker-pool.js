/**
 * Arbesk glTF Web Worker Pool
 *
 * Manages a small pool of module Web Workers for glTF operations.
 * If module workers are unsupported or fail to load, the pool reports
 * itself as unavailable and callers fall back to main-thread implementations.
 */

const WORKER_SCRIPT = new URL("./gltf-worker.js", import.meta.url);

class GlTFWorkerPool {
  constructor(size = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))) {
    this.size = size;
    this.workers = [];
    this.available = [];
    this.queue = [];
    this.messageId = 0;
    this.pending = new Map();
    this.ready = false;
  }

  async init() {
    if (this.ready) return true;
    if (typeof Worker === "undefined") return false;

    try {
      for (let i = 0; i < this.size; i++) {
        const worker = new Worker(WORKER_SCRIPT, { type: "module" });
        worker.onmessage = (event) => this._handleMessage(event, worker);
        worker.onerror = (error) => this._handleError(error);
        worker.onmessageerror = (error) => this._handleError(error);
        this.workers.push(worker);
        this.available.push(worker);
      }
      this.ready = true;
      return true;
    } catch (error) {
      console.warn("[WORKER-POOL] module workers not available, falling back to main thread:", error.message);
      this.terminate();
      this.ready = false;
      return false;
    }
  }

  async execute(type, payload, transferIn = []) {
    if (!this.ready) {
      await this.init();
    }
    if (!this.ready) {
      throw new Error(`Worker pool unavailable for task ${type}`);
    }

    const id = `${type}-${++this.messageId}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      const worker = this._acquire();
      if (worker) {
        worker.postMessage({ id, type, payload }, transferIn);
      } else {
        this.queue.push({ id, type, payload, transferIn });
      }
    });
  }

  _acquire() {
    return this.available.length > 0 ? this.available.shift() : null;
  }

  _release(worker) {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      worker.postMessage({ id: next.id, type: next.type, payload: next.payload }, next.transferIn);
    } else {
      this.available.push(worker);
    }
  }

  _handleMessage(event, worker) {
    const { id, type, result, error } = event.data;
    const deferred = this.pending.get(id);
    if (!deferred) return;

    this.pending.delete(id);
    this._release(worker);

    if (type === "error") {
      const err = new Error(error?.message || "Worker task failed");
      if (error?.stack) err.stack = error.stack;
      deferred.reject(err);
    } else {
      deferred.resolve(result);
    }
  }

  _handleError(error) {
    console.error("[WORKER-POOL] worker error:", error);
    // Fail all pending jobs; callers will fall back on retry if needed.
    for (const [id, deferred] of this.pending) {
      deferred.reject(new Error("Worker crashed"));
    }
    this.pending.clear();
    this.terminate();
  }

  terminate() {
    for (const worker of this.workers) {
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    }
    this.workers = [];
    this.available = [];
    this.queue = [];
    this.ready = false;
  }
}

let pool = null;

export function getGlTFWorkerPool() {
  if (!pool) {
    pool = new GlTFWorkerPool();
  }
  return pool;
}

export async function isWorkerPoolAvailable() {
  const p = getGlTFWorkerPool();
  return p.init();
}

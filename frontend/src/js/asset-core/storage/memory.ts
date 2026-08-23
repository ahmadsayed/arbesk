import type { StoragePort } from "../types.ts";

/** In-memory StoragePort — backend default and test double. */
export function memoryStorage(): StoragePort {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

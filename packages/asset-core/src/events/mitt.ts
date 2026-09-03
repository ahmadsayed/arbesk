/**
 * Tiny event emitter (vendored mitt).
 * @remarks Typed wrapper so the package has no dependency on the `mitt` npm
 *   package.
 */

export type MittHandler = (...args: any[]) => void;

export interface MittEmitter {
  all: Map<string, Array<MittHandler>>;
  on(type: string, handler: MittHandler): void;
  off(type: string, handler?: MittHandler): void;
  emit(type: string, data?: any): void;
}

export default function mitt(all?: Map<string, Array<MittHandler>>): MittEmitter {
  const map = all || new Map<string, Array<MittHandler>>();
  return {
    all: map,
    on(type: string, handler: MittHandler): void {
      const list = map.get(type);
      if (list) {
        list.push(handler);
      } else {
        map.set(type, [handler]);
      }
    },
    off(type: string, handler?: MittHandler): void {
      const list = map.get(type);
      if (!list) return;
      if (handler) {
        list.splice(list.indexOf(handler) >>> 0, 1);
      } else {
        map.set(type, []);
      }
    },
    emit(type: string, data?: any): void {
      const list = map.get(type);
      if (list) {
        list.slice().forEach((handler) => handler(data));
      }
      const wild = map.get("*");
      if (wild) {
        wild.slice().forEach((handler) => handler(type, data));
      }
    },
  };
}

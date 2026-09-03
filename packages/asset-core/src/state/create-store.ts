import { emit } from "../events/bus.ts";

/**
 * Creates a small event-emitting state store.
 * @remarks Emits `eventName` (full new state) on every set/reset; `reset()`
 *   restores `defaults`.
 */
export function createStore<T extends Record<string, any>>(
  defaults: T,
  eventName: string
): {
  store: {
    get: () => T;
    set: (patch: Partial<T>) => void;
    reset: () => void;
  };
  _resetForTesting: () => void;
} {
  let state = { ...defaults };
  const store = {
    get: () => ({ ...state }),
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      emit(eventName, { ...state });
    },
    reset() {
      state = { ...defaults };
      emit(eventName, { ...state });
    },
  };
  function _resetForTesting() {
    state = { ...defaults };
  }
  return { store, _resetForTesting };
}

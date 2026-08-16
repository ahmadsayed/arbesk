import { emit } from "../events/bus.ts";

/**
 * Create a small event-emitting state store.
 * @param defaults - initial state; `reset()` restores these values
 * @param eventName - bus event emitted on every set/reset, with the full new state
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

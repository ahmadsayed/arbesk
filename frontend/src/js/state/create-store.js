import { emit } from "../events/bus.js";

/**
 * Create a small event-emitting state store.
 * @template {Record<string, any>} T
 * @param {T} defaults - initial state; `reset()` restores these values
 * @param {string} eventName - bus event emitted on every set/reset, with the full new state
 * @returns {{ store: {
 *   get: () => T,
 *   set: (patch: Partial<T>) => void,
 *   reset: () => void,
 * }, _resetForTesting: () => void }}
 */
export function createStore(defaults, eventName) {
  let state = { ...defaults };
  const store = {
    get: () => ({ ...state }),
    /** @param {Partial<T>} patch */
    set(patch) {
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

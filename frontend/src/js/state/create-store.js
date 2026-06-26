// @ts-nocheck
import { emit } from "../events/bus.js";

export function createStore(defaults, eventName) {
  let state = { ...defaults };
  const store = {
    get: () => ({ ...state }),
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

import { flushSync } from "react-dom";
export function createStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    get: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(patch, sync = false) {
      const apply = () => {
        value = { ...value, ...patch };
        for (const fn of listeners) fn();
      };
      if (sync) flushSync(apply);
      else apply();
    },
  };
}

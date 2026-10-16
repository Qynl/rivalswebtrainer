import { flushSync } from "react-dom";
export function createStore(initial, equal = Object.is) {
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
        let next = value;
        for (const key of Object.keys(patch)) {
          if (Object.hasOwn(value, key) && equal(value[key], patch[key]))
            continue;
          if (next === value) next = { ...value };
          next[key] = patch[key];
        }
        if (next === value) return;
        value = next;
        for (const fn of listeners) fn();
      };
      if (sync) flushSync(apply);
      else apply();
    },
  };
}

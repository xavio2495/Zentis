import type { Snapshot, Store } from "@zentis/console-data";

/**
 * A store that answers one snapshot and never polls.
 *
 * Handed to `App` as a prop rather than patched over the module, because ESM exports are read-only
 * and because a prop keeps the component the sandbox drives identical to the one that ships.
 *
 * The state object is built once and returned by identity: `useSyncExternalStore` compares what
 * `getState` returns against the last value it saw, so a fresh object every call is an infinite
 * re-render.
 */
export const fixedStore = (snapshot: Snapshot) => {
  const state = { snapshot, loading: false, error: null, lastPollSeconds: 0 };
  const store: Store = {
    getState: () => state,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    start: () => undefined,
    stop: () => undefined,
  };
  return () => store;
};

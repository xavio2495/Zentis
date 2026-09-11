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
  // The fixed snapshot counts as having just been polled; epoch 0 read as "polled 20,000 days ago".
  const state = { snapshot, loading: false, error: null, lastPollSeconds: Math.floor(Date.now() / 1000) };
  const store: Store = {
    getState: () => state,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
    // The fixed world has one recorded series, so a window change asks it for nothing.
    setMarketHours: () => undefined,
    start: () => undefined,
    stop: () => undefined,
  };
  return () => store;
};

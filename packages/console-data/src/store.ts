import { type Snapshot, QUOTE_SIZE_A, takeSnapshot } from "./snapshot.js";

/**
 * One poll loop, with no view framework in it.
 *
 * The screen subscribes; it does not fetch. That keeps the data layer testable without a terminal,
 * and it means a re-render cannot start a network request — the render is a function of whatever
 * the last completed poll produced.
 */
export interface StoreState {
  readonly snapshot: Snapshot | null;
  /** true while a poll is in flight, so the screen can say it is refreshing rather than stuck */
  readonly loading: boolean;
  /** only set when a poll threw outright; a source being down lands in the snapshot's caveats */
  readonly error: string | null;
  readonly lastPollSeconds: number | null;
}

export interface Store {
  getState(): StoreState;
  subscribe(listener: () => void): () => void;
  /** poll now, e.g. because the operator asked for a re-quote */
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
}

/**
 * Twenty seconds: the fast workflow publishes on a ten-second schedule but lands a write far less
 * often, and each poll is five sources across three chains. Polling faster would show the same
 * numbers at more cost, and the one thing an operator does want immediately — a re-quote — is a key.
 */
export const POLL_INTERVAL_MS = 20_000;

export function createStore(quoteSize = QUOTE_SIZE_A, intervalMs = POLL_INTERVAL_MS): Store {
  let state: StoreState = { snapshot: null, loading: false, error: null, lastPollSeconds: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  const set = (next: Partial<StoreState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const refresh = async (): Promise<void> => {
    // A poll that is already running is the answer to a second request for one. Without this, a key
    // held down would fan out into overlapping snapshots that finish out of order.
    if (inFlight !== null) return inFlight;
    set({ loading: true });
    inFlight = takeSnapshot(quoteSize)
      .then((snapshot) => {
        set({ snapshot, error: null, loading: false, lastPollSeconds: Math.floor(Date.now() / 1000) });
      })
      .catch((cause: unknown) => {
        set({ error: String(cause), loading: false, lastPollSeconds: Math.floor(Date.now() / 1000) });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    start() {
      if (timer !== null) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

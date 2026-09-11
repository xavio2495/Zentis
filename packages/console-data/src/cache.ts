import type { Quota, Read } from "./graphql.js";

/**
 * Per-source cadence, single-flight, and last-good-value on failure.
 *
 * The console used to refetch every source on one twenty-second timer. Six of those are Subgraph
 * Studio queries — three fills, three reference pools — which is 1,080 an hour against an allowance
 * of 3,000, and the reference-pool query asks for a thousand swaps covering a week. That series does
 * not change meaningfully in twenty seconds, and paying for it as though it did is what exhausted
 * the allowance and left every endpoint answering `429`.
 *
 * Two consequences, both handled here:
 *
 * - **Each source declares its own cadence.** A week of swaps is read every ten minutes; the leg's
 *   own state is read every poll.
 * - **A failed read keeps the last good value and lets its age climb.** A console that blanks the
 *   moment an endpoint rate-limits it is a console that dies in the middle of a demo; one that shows
 *   the last thing it knew, and says how old it is, is still telling the truth.
 */
export interface Cached<T> {
  readonly value: T | null;
  /** the most recent failure, whether or not a previous value survived it */
  readonly error: string | null;
  readonly indexingErrors: boolean;
  /** how long ago the value was actually read; zero when it is from this poll */
  readonly ageSeconds: number;
  /** what the endpoint last said about its own allowance, kept with the value it came with */
  readonly quota?: Quota | null;
}

export interface Cache {
  get<T>(key: string, cadenceMs: number, read: () => Promise<Read<T>>): Promise<Cached<T>>;
  /**
   * Marks every source whose key starts with `prefix` as due.
   *
   * A cadence that protects the query allowance would otherwise also hide the write the operator
   * just made, so pressing `q` — or an action finishing — forces the cheap sources and leaves the
   * expensive ones alone.
   */
  invalidate(prefix: string): void;
}

interface Entry {
  value: unknown;
  error: string | null;
  indexingErrors: boolean;
  fetchedAt: number | null;
  inFlight: Promise<unknown> | null;
  quota: Quota | null;
}

export function createCache(now: () => number = Date.now): Cache {
  const entries = new Map<string, Entry>();

  return {
    async get<T>(key: string, cadenceMs: number, read: () => Promise<Read<T>>): Promise<Cached<T>> {
      const entry: Entry = entries.get(key) ?? {
        value: null,
        error: null,
        indexingErrors: false,
        fetchedAt: null,
        inFlight: null,
        quota: null,
      };
      entries.set(key, entry);

      const settled = (): Cached<T> => ({
        value: entry.value as T | null,
        error: entry.error,
        indexingErrors: entry.indexingErrors,
        ageSeconds: entry.fetchedAt === null ? 0 : Math.floor((now() - entry.fetchedAt) / 1000),
        // Kept from the last answer, whichever way it went: an endpoint states its allowance when it
        // refuses and when it does not, and the number is worth as much either way.
        quota: entry.quota ?? null,
      });

      const fresh = entry.fetchedAt !== null && now() - entry.fetchedAt < cadenceMs;
      if (fresh) return settled();

      // Single flight. Without it a slow endpoint's calls overlap and land out of order, and the
      // screen can go backwards in time.
      if (entry.inFlight !== null) {
        await entry.inFlight;
        return settled();
      }

      const request = read()
        .then((result) => {
          // Whatever the endpoint said about its allowance, kept whichever way the read went.
          if (result.quota != null) entry.quota = result.quota;
          if (result.value !== null) {
            entry.value = result.value;
            entry.error = null;
            entry.indexingErrors = result.indexingErrors;
            entry.fetchedAt = now();
            return;
          }
          // Kept, not cleared: the age is what tells the reader how much to trust it.
          entry.error = result.error;
        })
        .catch((cause: unknown) => {
          entry.error = String(cause);
        })
        .finally(() => {
          entry.inFlight = null;
        });

      entry.inFlight = request;
      await request;
      return settled();
    },

    invalidate(prefix: string) {
      for (const [key, entry] of entries) {
        if (key.startsWith(prefix)) entry.fetchedAt = null;
      }
    },
  };
}

/**
 * How often each source is worth reading.
 *
 * Only the two subgraph reads cost anything scarce: Subgraph Studio allows 3,000 queries per three
 * hours, and the console is not the only consumer — both workflows read the same endpoints. The
 * registry and block heights are ordinary RPC and the quotes come from a local service, so those
 * stay on every poll and are what keeps the screen feeling live.
 *
 * The reference pools no longer touch Studio at all — their price and history come from the chain
 * over RPC — so the console's whole Studio cost is the fills read: 180 queries an hour, against
 * about a thousand available. Before per-source cadence it was 1,080, which is what exhausted the
 * allowance and left every endpoint answering 429.
 */
export const CADENCE_MS = {
  fills: 60_000,
  // RPC now, and incremental: after the first backfill a read is one small `eth_getLogs` plus
  // `slot0()`. Thirty seconds keeps the market price live without leaning on the public RPCs.
  pool: 30_000,
  registry: 0,
  finality: 0,
  quotes: 0,
  // The book's market series: hourly points, cached ten minutes at the service, and its gateway call
  // is billed against the maker's own key. Polling it on the console's cadence would spend that
  // allowance on a line that cannot have moved.
  market: 600_000,
} as const;

/** The sources a manual refresh forces: the cheap ones that carry what an action changed. */
export const FORCED_ON_REFRESH = ["fills:", "quotes:", "pool:"] as const;

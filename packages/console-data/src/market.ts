import { QUOTE_API_URL } from "./quotes.js";
import { type Read, failed, json, ok } from "./graphql.js";

/**
 * The one series the whole book prices from.
 *
 * Every leg quotes from a single mid now, and the slow workflow measures the volatility half of its
 * spread on this same mainnet series — the quote service reads it from the workflow's own config
 * rather than restating the pool, so the chart cannot drift from the series the spread came out of.
 * That is why one market chart replaces the three testnet pool charts: those pools were where the
 * legs' trades settled, never what they quoted from, and two of the three have been retired.
 *
 * Hourly points, a week of them. The mainnet pool trades often enough that a thousand swaps cover a
 * few hours, so a per-swap series could not span the window the chart is for.
 */
export interface MarketPoint {
  readonly timestamp: bigint;
  /** raw tokenB per 1e18 raw tokenA, the registry's own units */
  readonly mid: bigint;
}

/** How the service drew the series: from individual swaps, or from hourly closes. */
export type Granularity = "swaps" | "hours";

export interface MarkHistory {
  /** oldest first, so the line reads left to right as time moving forwards */
  readonly points: MarketPoint[];
  /** a sentence for the chart's title: which market this is and who indexed it */
  readonly source: string;
  readonly hours: number;
  /**
   * Short windows come back per swap and long ones hourly, and the chart says which: an hourly
   * series drawn over one hour is two points and a straight line between them, which is not what the
   * market did.
   */
  readonly granularity: Granularity;
  /** set when the series is stale; the points are still the last good ones */
  readonly error: string | null;
}

interface RawHistory {
  points: { t: number; mid: string | null }[] | null;
  source?: string;
  hours?: number;
  granularity?: string;
  error?: string | null;
}

/** The window's own endpoint. The service cuts and caches each window, so switching costs nothing. */
export const markHistoryUrl = (hours: number): string => `${QUOTE_API_URL}/mark/history?hours=${hours}`;

/** One cache entry per window, or flipping back would redraw the window before it. */
export const marketCacheKey = (hours: number): string => `market:${hours}`;

/** The payload as a series, or null when there is no series in it to draw. */
export function parseMarkHistory(raw: RawHistory): MarkHistory | null {
  const points = (raw.points ?? [])
    // A point without a mid is not a price of zero; it is a gap, and a zero would draw as a crash.
    .filter((p) => p.mid != null && p.mid !== "0")
    .map((p) => ({ timestamp: BigInt(p.t), mid: BigInt(p.mid!) }))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  if (points.length === 0) return null;
  return {
    points,
    source: raw.source ?? "the market the book prices from",
    hours: raw.hours ?? 0,
    // An older service that does not say drew the hourly series it always used to return.
    granularity: raw.granularity === "swaps" ? "swaps" : "hours",
    error: raw.error ?? null,
  };
}

export async function fetchMarkHistory(hours: number): Promise<Read<MarkHistory>> {
  const read = await json<RawHistory>(markHistoryUrl(hours));
  if (read.value === null) return failed(read.error ?? "the quote service returned no market history");
  const history = parseMarkHistory(read.value);
  if (history === null) return failed(read.value.error ?? "the market series came back empty");
  // A stale series is shown with its reason beside it, like every other source here.
  return history.error === null ? ok(history) : { value: history, error: history.error, indexingErrors: false };
}
